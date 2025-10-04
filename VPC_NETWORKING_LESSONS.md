# VPC Networking Lessons Learned

## Summary

This document captures critical lessons learned while troubleshooting Google Maps Geocoding API timeouts from Cloud Run services with VPC connectivity in the PropertyVision project.

## The Problem

**Symptom**: Google Maps Geocoding API calls timing out at 5 seconds when called from Cloud Run worker with VPC connectivity.

**Impact**: All property analyses failing with "no-data" errors, making the application unusable.

## Root Cause Analysis

### Network Latency Breakdown

When calling `https://maps.googleapis.com` from Cloud Run with VPC connectivity:

| Layer | Time | Status |
|-------|------|--------|
| DNS resolution | ~2 seconds | ✅ Acceptable |
| TCP handshake | 14-22 seconds | ❌ **CRITICAL** |
| TLS handshake | 17-26 seconds | ❌ **CRITICAL** |
| **Total** | **>20 seconds** | ❌ Exceeds 5s timeout |

The TCP/TLS handshake latency was the blocker, not DNS or API authentication.

### Why VPC Paths Were Slow

**Direct VPC Egress (`private-ranges-only`)**:
- Routes only private IPs (10.x.x.x, 172.x.x.x, 192.168.x.x) through VPC
- Public IPs like `maps.googleapis.com` go through a restrictedVIP path (199.36.153.4/30)
- This path has pathological TCP/TLS performance (15-20s handshakes)

**Direct VPC Egress (`all-traffic`) + Cloud NAT**:
- Routes ALL traffic (including Google Cloud APIs) through VPC → Cloud NAT → Internet
- Fixed Maps API latency ✅
- Broke Vertex AI and Cloud Logging (60+ second timeouts) ❌
- Google client libraries default to gRPC which doesn't work well over NAT

**Serverless VPC Access Connector (`private-ranges-only`)**:
- Should provide fast public egress for non-VPC IPs
- In practice, still exhibited slow paths for Maps API (reason unclear)
- Vertex AI also appeared to hang/timeout

## Key Technical Insights

### 1. Cloud Run VPC Egress Modes

**`private-ranges-only`** (default):
- Only routes RFC1918 private IP ranges through VPC
- Public IPs egress via Cloud Run's default path
- **Problem**: "Default path" can be slow restrictedVIP routing for certain googleapis.com endpoints

**`all-traffic`**:
- Routes ALL egress through VPC network
- Requires Cloud NAT for internet access
- **Problem**: Forces Google Cloud API calls through NAT instead of Private Google Access

### 2. DNS Resolution Order Matters

`dns.setDefaultResultOrder('ipv4first')` is critical:
- IPv6 addresses were being resolved first
- IPv6 paths through VPC had additional latency
- Forcing IPv4-first reduced DNS time from 4-5s to ~2s
- But didn't solve the TCP/TLS bottleneck

### 3. OIDC Token Fetch Latency

When using service-to-service authentication with `GoogleAuth`:
```typescript
const auth = new GoogleAuth();
const idClient = await auth.getIdTokenClient(audience);
const resp = await idClient.request({ ... });
```

The OIDC token fetch itself goes through the network and experiences the same slow VPC path:
- Token fetch: >5 seconds through VPC
- Even if target service (geo-proxy) responds in <100ms, the auth step times out first

**Solution**: Use header-based authentication instead of OIDC to avoid token fetch.

### 4. Private Google Access vs. Cloud NAT

**Private Google Access**:
- Allows VPC resources to reach Google APIs via private IPs (199.36.153.x)
- Works for Vertex AI, Cloud Logging, etc.
- **Not enabled by default on all subnets**
- Requires: `gcloud compute networks subnets update SUBNET --enable-private-ip-google-access`

**Cloud NAT**:
- Provides stable public IP egress for VPC resources
- Does NOT provide special handling for Google APIs
- **All traffic** goes via public internet, not private Google paths
- Can cause issues with gRPC-based Google client libraries

### 5. Google Client Libraries and REST vs. gRPC

**Default behavior**: Google client libraries (Vertex AI, Cloud Logging) prefer gRPC over HTTP/2

**Problem with NAT**: gRPC can timeout or hang when routed through Cloud NAT

**Solution**: Force REST mode with environment variable:
```bash
GOOGLE_API_USE_REST=1
```

This makes client libraries use HTTP/1.1 REST instead of gRPC, which works better over NAT paths.

## Network Configuration Requirements

For PropertyVision, we need **THREE different network paths** simultaneously:

| Service | IP Type | Required Path | Works With |
|---------|---------|---------------|------------|
| Redis (Memorystore) | Private (10.85.154.187) | VPC private network | All configs ✅ |
| Vertex AI / Cloud Logging | Public (Google APIs) | Private Google Access | `private-ranges-only` ✅ |
| Google Maps Geocoding | Public (maps.googleapis.com) | Fast public internet | None worked ❌ |

**The conflict**: No single Cloud Run VPC configuration provides all three paths:
- `private-ranges-only`: Redis ✅, Vertex ✅, Maps ❌
- `all-traffic` + NAT: Redis ✅, Vertex ❌, Maps ✅

## Attempted Solutions

### ❌ Failed: Direct VPC Egress + IPv4-First DNS
**What we tried**:
```bash
gcloud run deploy --vpc-egress private-ranges-only \
  --set-env-vars "NODE_OPTIONS=--dns-result-order=ipv4first"
```

**Result**: DNS improved (4s → 2s), but TCP/TLS still 15-20 seconds. Total timeout unchanged.

### ❌ Failed: Direct VPC Egress + Cloud NAT
**What we tried**:
```bash
gcloud compute routers create cr-nat ...
gcloud compute routers nats create nat-egress ...
gcloud run deploy --vpc-egress all-traffic
```

**Result**: Maps API fast (<2s), but Vertex AI and Cloud Logging timed out (60+ seconds).

### ❌ Failed: Cloud NAT + REST Mode for Google APIs
**What we tried**:
```bash
gcloud run deploy --vpc-egress all-traffic \
  --set-env-vars "GOOGLE_API_USE_REST=1"
```

**Result**: Reduced Vertex/Logging timeouts from 60s to ~30s, still unusable. Jobs stuck at "Getting subject details" phase.

### ❌ Failed: Geo-Proxy with OIDC Authentication
**What we tried**: Deploy geo-proxy (no VPC) and call it from worker with OIDC token authentication

**Result**: OIDC token fetch itself timed out (>5s) due to same slow VPC path to Google's auth servers.

### ⚠️ Partial: Geo-Proxy with Header Authentication
**What we tried**:
```typescript
// Worker calls geo-proxy with simple header
const resp = await https.request({
  headers: { 'x-proxy-key': SHARED_SECRET }
});
```

**Geo-proxy status**: Works perfectly (responds in <100ms when tested directly)

**Worker status**: Still unable to reach proxy quickly through VPC connector with `private-ranges-only`

## Working Solution (Theoretical)

Based on our analysis, the solution requires one of:

### Option 1: Internal Load Balancer for Geo-Proxy ⭐ **Recommended**
- Deploy geo-proxy with Internal Load Balancer (ILB)
- ILB gives geo-proxy a private IP within VPC (e.g., 10.x.x.x)
- Worker calls geo-proxy via private IP through VPC
- Geo-proxy (no VPC attached) has fast public egress to Maps API

**Pros**:
- All three paths work (Redis private, Vertex Private Google Access, Maps via ILB → proxy)
- No OIDC latency (header auth over private network is fast)
- Geo-proxy isolated from VPC slowness

**Cons**:
- More complex infrastructure (ILB setup)
- Additional cost (minimal - ILB forwarding rules)

### Option 2: Accept 30-Second Geocoding Timeout
- Increase `geocodeWithTimeout` from 5s to 30s
- Direct Maps calls will complete in 20-25s
- Disable geo-proxy entirely

**Pros**:
- Simple, no infrastructure changes
- All paths work (eventually)

**Cons**:
- Job completion time increases significantly
- Poor user experience (30s for each geocoding call)
- 2 geocoding calls per job = 60s overhead minimum

### Option 3: Private Service Connect to Google Maps
- Set up Private Service Connect endpoint for `*.googleapis.com`
- Maps API accessible via private VPC endpoint
- No geo-proxy needed

**Pros**:
- All Google APIs including Maps go through private VPC paths
- Potentially fastest solution

**Cons**:
- High complexity (PSC endpoint setup, DNS configuration)
- May not support Geocoding API specifically (depends on Google's PSC offerings)
- Requires VPC-SC configuration

## Current Status (as of latest session)

**Deployed Components**:
- ✅ Geo-proxy service at `https://geo-proxy-839845580521.us-central1.run.app` (no VPC)
  - Status: Working perfectly, <100ms response times
  - Auth: Header-based (`x-proxy-key`)
  - Maps API key: Unrestricted key stored in Secret Manager

- ✅ Worker code updated with geo-proxy client
  - Feature flag: `USE_GEO_PROXY=true`
  - Proxy URL configured
  - Shared key configured

**Blocker**:
- ❌ Worker with VPC connector + `private-ranges-only` cannot reach public geo-proxy URL within 5-second timeout
- ❌ Vertex AI phase hanging, preventing jobs from reaching geocoding phase
- No clear path forward with current VPC connector configuration

## Recommended Next Steps

1. **Implement Option 1** (ILB for geo-proxy):
   ```bash
   # Create ILB backend service
   gcloud compute backend-services create geo-proxy-backend \
     --load-balancing-scheme=INTERNAL \
     --protocol=HTTP \
     --region=us-central1

   # Add geo-proxy as serverless NEG backend
   # Create forwarding rule with internal IP
   # Update worker to call internal IP instead of public URL
   ```

2. **Alternative**: If ILB is too complex, implement Option 2 (accept 30s timeout) as temporary workaround:
   ```typescript
   const subjectCoords = await this.geocodeWithTimeout(subjectAddress, 30000);
   ```

3. **Monitor**: Add structured logging to track which paths are actually being used:
   ```typescript
   diag('network.path', {
     target: url.hostname,
     vpcEgress: process.env.VPC_EGRESS_MODE,
     timingMs: { dns, tcp, tls, total }
   });
   ```

## Key Takeaways

1. **VPC egress paths are not obvious** - Direct testing with granular timing logs is essential
2. **DNS is rarely the bottleneck** - TCP/TLS handshake latency is usually the issue
3. **IPv4-first is still important** - But won't solve fundamental routing problems
4. **OIDC adds network hops** - Use simpler auth (headers, API keys) when possible
5. **Cloud NAT ≠ Fast egress for Google APIs** - Requires REST mode and still slower than Private Google Access
6. **geo-proxy architecture is sound** - The implementation works, but worker→proxy connectivity through VPC is the blocker
7. **Internal Load Balancer is likely the solution** - Gives proxy a private IP accessible from VPC without OIDC

## References

- [GEO_PROXY_GUIDE.md](./GEO_PROXY_GUIDE.md) - Full geo-proxy implementation details
- [Cloud Run VPC Egress Settings](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc)
- [Serverless VPC Access](https://cloud.google.com/vpc/docs/configure-serverless-vpc-access)
- [Cloud NAT Overview](https://cloud.google.com/nat/docs/overview)
- [Private Google Access](https://cloud.google.com/vpc/docs/private-google-access)
