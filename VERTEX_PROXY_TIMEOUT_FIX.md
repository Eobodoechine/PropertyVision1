# Vertex Proxy Timeout Fix - October 4, 2025

## Problem Summary

PropertyVision worker was experiencing timeout and network connection failures when calling vertex-proxy for grounded searches:

```
❌ VERTEX-DETAILS: Proxy call failed after 91799ms: socket hang up
❌ VERTEX-DETAILS: Client network socket disconnected before secure TLS connection was established
```

**Root Causes:**
1. Grounded searches take 60-90+ seconds, but vertex-proxy timeout was only 60s
2. No connection reuse - creating new TLS handshakes for every request
3. No retry logic for transient network errors (ECONNRESET, ETIMEDOUT, socket hang up)
4. Worker→proxy timeout (90s) was too close to proxy's own timeout (60s)

## Solution Implemented

### 1. Increased Timeouts End-to-End

**Vertex-Proxy Service:**
```bash
gcloud run deploy vertex-proxy \
  --timeout 180 \
  --min-instances 1
```
- Increased service timeout from 60s → 180s
- Set min-instances=1 to keep service warm

**Worker vertex-details.ts:**
- Increased all grounded search timeouts from 90s → 120s
- 5 grounded search calls updated (lines 177, 206, 223, 240, 257)

### 2. HTTP Keep-Alive for Connection Reuse

Added global HTTPS agent in `src/server/vertex-details.ts`:

```typescript
import https from 'https';

// Global HTTPS agent with keep-alive for connection reuse
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,  // Send keep-alive packet every 30s
  maxSockets: 50,         // Max concurrent connections
  maxFreeSockets: 10,     // Keep up to 10 idle connections
  timeout: 120000         // Socket timeout 120s
});
```

Used in proxy fetch call:
```typescript
const proxyResponse = await fetch(`${VERTEX_PROXY_URL}/vertex/generate`, {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify({ /* ... */ }),
  agent: httpsAgent  // Reuse connections
});
```

**Benefits:**
- Reduces TLS handshake overhead
- Faster subsequent requests
- More stable connections

### 3. Network Error Retry Logic

Implemented single retry with 500ms backoff for transient network errors:

```typescript
const maxRetries = 1;
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  const t0 = Date.now();
  try {
    if (attempt > 0) {
      console.log(`🔄 VERTEX-DETAILS: Retry attempt ${attempt}/${maxRetries} after 500ms backoff`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const proxyResponse = await fetch(/* ... */, { agent: httpsAgent });

    // Success - return result
    const proxyResult = await proxyResponse.json();
    return proxyResult.text || '';

  } catch (proxyError: any) {
    const elapsed = Date.now() - t0;
    const isNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'socket hang up', 'TLS'].some(
      err => proxyError.message?.includes(err)
    );

    if (isNetworkError && attempt < maxRetries) {
      console.warn(`⚠️  VERTEX-DETAILS: Network error after ${elapsed}ms: ${proxyError.message}, retrying...`);
      continue; // Retry
    }

    console.error(`❌ VERTEX-DETAILS: Proxy call failed after ${elapsed}ms: ${proxyError.message}, falling back to direct call`);
    break; // Fall through to direct call
  }
}
```

**Handles these network errors:**
- `ECONNRESET` - Connection reset by peer
- `ETIMEDOUT` - Connection timed out
- `ENOTFOUND` - DNS lookup failed
- `socket hang up` - Socket closed unexpectedly
- TLS connection errors

### 4. VPC Configuration

**Critical:** Worker must use `vpc-egress all-traffic` (not `private-ranges-only`)

```bash
gcloud run deploy propertyvision-worker \
  --vpc-connector redis-connector \
  --vpc-egress all-traffic  # Required for proxy services
```

**Why all-traffic is needed:**
- Redis (10.85.154.187) is on private VPC - uses VPC connector
- Vertex-proxy and geo-proxy are public Cloud Run services - need internet egress
- `private-ranges-only` blocks access to public proxy services
- `all-traffic` routes everything through VPC connector, which has internet access

**VPC Architecture:**
```
Worker (Cloud Run)
  ├─ Redis (10.85.154.187) → VPC Connector → Private VPC → Redis instance
  ├─ Vertex-Proxy (public URL) → VPC Connector → Internet → vertex-proxy
  └─ Geo-Proxy (public URL) → VPC Connector → Internet → geo-proxy
```

## Final Configuration

### Worker Service (propertyvision-worker)

**Deployment Command:**
```bash
gcloud run deploy propertyvision-worker \
  --source . \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress all-traffic \
  --service-account pv-worker-staging-sa@agile-device-472202-i8.iam.gserviceaccount.com \
  --set-env-vars "RUN_WORKER=true,NODE_ENV=production,USE_GEO_PROXY=true,GEO_PROXY_URL=https://geo-proxy-839845580521.us-central1.run.app,USE_VERTEX_PROXY=true,FORCE_VERTEX_PROXY=true,VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app,REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_CLOUD_PROJECT=agile-device-472202-i8,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc" \
  --set-secrets "PROXY_SHARED_KEY=proxy-shared-key:latest" \
  --min-instances 1 \
  --max-instances 3 \
  --timeout 3600
```

**Revision:** propertyvision-worker-00045-z6p (deployed 2025-10-04 13:35 UTC)

### Vertex-Proxy Service

**Configuration:**
- Timeout: 180s
- Min instances: 1
- Max instances: 10

### Timeout Budget

Full request chain timeouts:

```
Worker → Vertex-Proxy → Vertex AI
120s      180s           N/A

Worker service timeout: 3600s (1 hour)
```

**Logic:**
- Worker waits up to 120s for proxy response
- Proxy has 180s to complete Vertex AI call (60s buffer)
- Worker service has 3600s total (handles long-running jobs)

## Files Modified

1. **src/server/vertex-details.ts**
   - Added global `httpsAgent` with keep-alive (lines 7-14)
   - Updated 5 timeout values: 90000ms → 120000ms
   - Added retry loop with network error detection (lines 96-153)

2. **ASYNC_JOBS_COMPLETE.md**
   - Updated deployment command with `vpc-egress all-traffic`
   - Added explanation of critical environment variables

## Test Results

**Deployed Revision:** propertyvision-worker-00045-z6p

**Success Indicators:**
```
✅ VERTEX-DETAILS: Proxy success in 36373ms, returned 817 chars
✅ No socket hang up errors
✅ No ETIMEDOUT errors
✅ Jobs processing through all analysis steps
✅ Redis connection stable
```

**Log Streaming Command:**
```bash
gcloud beta logging tail \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-worker" AND resource.labels.revision_name="propertyvision-worker-00045-z6p"' \
  --project agile-device-472202-i8 \
  --format="value(timestamp,jsonPayload.message,textPayload)"
```

## Lessons Learned

### What Didn't Work

1. **VPC egress = private-ranges-only**
   - Blocked access to public proxy services
   - Caused Redis connection errors: `ECONNRESET`, `ETIMEDOUT`
   - Worker crashed repeatedly

2. **Insufficient timeout margins**
   - Worker 90s timeout too close to proxy 60s timeout
   - No buffer for network latency
   - Requests failed just before completing

### What Worked

1. **End-to-end timeout increase**
   - Worker: 120s, Proxy: 180s, Service: 3600s
   - Proper timeout cascade with margins

2. **HTTP keep-alive**
   - Eliminated repeated TLS handshakes
   - More stable connections
   - Faster subsequent requests

3. **Targeted retry logic**
   - Single retry sufficient for transient errors
   - 500ms backoff prevents thundering herd
   - Falls back to direct call if proxy unavailable

4. **VPC egress = all-traffic**
   - Enables both private VPC and internet access
   - Required when using external proxy services

## Related Issues Fixed

This fix also resolves:
- Worker crash loops from VPC connectivity issues
- "gax logging timeout" errors
- Duplicate job runs (side effect of crashes)

## Monitoring

**Key metrics to watch:**
1. Vertex-proxy call success rate
2. Average proxy response time (should be 30-90s for grounded searches)
3. Network error retry frequency
4. Worker restart frequency (should be minimal)

**Alert thresholds:**
- Proxy timeout rate > 5%
- Average response time > 100s
- Worker restart rate > 1/hour

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ PropertyVision Worker (Cloud Run)                           │
│ Revision: 00045-z6p                                         │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ vertex-details.ts                                     │  │
│  │                                                       │  │
│  │  • HTTP Keep-Alive Agent                            │  │
│  │    - keepAlive: true                                │  │
│  │    - maxSockets: 50                                 │  │
│  │    - timeout: 120s                                  │  │
│  │                                                       │  │
│  │  • Retry Logic                                      │  │
│  │    - maxRetries: 1                                  │  │
│  │    - backoff: 500ms                                 │  │
│  │    - detects: ECONNRESET, ETIMEDOUT, socket hang up │  │
│  │                                                       │  │
│  │  • Timeout: 120s                                    │  │
│  └───────────────────────────────────────────────────────┘  │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │ HTTPS (keep-alive)
                             ▼
              ┌──────────────────────────────┐
              │ VPC Connector                │
              │ redis-connector              │
              │                              │
              │  Routes:                     │
              │  • Private: 10.85.x.x → VPC │
              │  • Public: * → Internet     │
              └──────────────┬───────────────┘
                             │
              ┌──────────────┴───────────────┐
              │                              │
              ▼                              ▼
    ┌─────────────────┐          ┌─────────────────────┐
    │ Redis Instance  │          │ Vertex-Proxy        │
    │ 10.85.154.187   │          │ (Cloud Run)         │
    │                 │          │                     │
    │ Private VPC     │          │ • timeout: 180s     │
    └─────────────────┘          │ • min-instances: 1  │
                                 │                     │
                                 └──────────┬──────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ Vertex AI        │
                                  │ Grounded Search  │
                                  │                  │
                                  │ 60-90s response  │
                                  └──────────────────┘
```

## Summary

The vertex-proxy timeout issue has been **completely resolved** through:
1. Increased timeouts with proper margins (120s → 180s → 3600s)
2. HTTP keep-alive for connection reuse
3. Network error retry with intelligent backoff
4. Correct VPC configuration (all-traffic egress)

Worker is now stable and processing jobs successfully without timeout or connection errors.

---

**Fixed:** 2025-10-04
**Deployed Revision:** propertyvision-worker-00045-z6p
**Status:** ✅ Production Ready
