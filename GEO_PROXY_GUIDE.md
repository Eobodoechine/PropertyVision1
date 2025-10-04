# Geo-Proxy Implementation Guide

## Overview

The geo-proxy is a lightweight proxy service that sits outside VPC to provide fast geocoding for the PropertyVision worker. It was implemented to solve critical network latency issues when calling Google Maps Geocoding API from Cloud Run services deployed with VPC connectivity.

## Problem Statement

### Root Cause
When the PropertyVision worker called Google Maps Geocoding API directly through VPC (either Direct VPC Egress or Serverless VPC Access Connector), the network path exhibited severe latency:

- **DNS resolution**: ~2 seconds (acceptable)
- **TCP handshake**: 14-22 seconds ❌
- **TLS handshake**: 17-26 seconds ❌
- **Total**: >20 seconds, far exceeding the 5-second timeout SLA

This made geocoding completely unusable, causing all property analyses to fail with "no-data" errors.

### Network Configuration Challenges

The system requires THREE different network paths simultaneously:
1. **Redis (10.85.154.187)** → Private VPC path ✅
2. **Vertex AI / Cloud Logging** → Private Google API path (not NAT) ✅
3. **Google Maps API** → Fast public internet path ❌ (BLOCKED by VPC routing)

**Attempted solutions that failed:**
- **Direct VPC egress (`private-ranges-only`)** → Maps API goes through slow restrictedVIP path (15-20s)
- **Direct VPC egress (`all-traffic`) + Cloud NAT** → Vertex AI/Logging timeout (60s+), though Maps works
- **VPC connector + `private-ranges-only`** → Still exhibits slow public egress for Maps API

## Solution Architecture

### Geo-Proxy Design

```
Worker (in VPC)  →  Geo-Proxy (no VPC, fast internet)  →  Google Maps API
    ↓                       Response: <100ms
  Redis (private VPC)
  Vertex AI (Private Google Access)
```

**Key characteristics:**
- **No VPC** - Deployed to Cloud Run without VPC connectivity for fast public internet egress
- **Header-based auth** - Simple `x-proxy-key` header authentication (no OIDC to avoid token fetch latency)
- **Pass-through proxy** - Returns raw Google Maps JSON responses with no modification
- **Minimal latency** - Proven <100ms response times in testing

## Implementation

### Directory Structure

```
PropertyVision1/
├── geo-proxy/
│   ├── src/
│   │   └── index.ts        # Express proxy server
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile (optional)
```

### Geo-Proxy Code

**File**: `/geo-proxy/src/index.ts`

```typescript
import express from 'express';
import fetch from 'node-fetch';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

const app = express();
app.use(express.json());

// Shared key authentication middleware
function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const provided = req.header('x-proxy-key');
  if (!provided || provided !== process.env.PROXY_SHARED_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/geocode', auth, async (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address required' });

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'country:US');
  url.searchParams.set('region', 'us');
  url.searchParams.set('key', process.env.GMAPS_KEY!);

  const t0 = Date.now();
  try {
    const r = await fetch(url.toString(), { timeout: 8000 });
    const j = await r.json();
    console.log(JSON.stringify({
      event: 'proxy.response',
      component: 'geo-proxy',
      http: { status: r.status },
      timingMs: { total: Date.now() - t0 }
    }));
    return res.status(200).json(j);
  } catch (e:any) {
    console.log(JSON.stringify({
      event: 'proxy.error',
      component: 'geo-proxy',
      msg: e.message,
      timingMs: { total: Date.now() - t0 }
    }));
    return res.status(502).json({ error: 'upstream-failed', message: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => console.log('geo-proxy up'));
```

### Worker Integration

**File**: `/frontend/src/server/step3-find-comparables.ts`

**Feature flags** (lines 32-34):
```typescript
const USE_GEO_PROXY = process.env.USE_GEO_PROXY === 'true';
const GEO_PROXY_URL = process.env.GEO_PROXY_URL || '';
const PROXY_SHARED_KEY = process.env.PROXY_SHARED_KEY || '';
```

**Proxy client** (lines 1449-1496):
```typescript
// Geo-proxy client (header-based auth, no OIDC)
private async geocodeViaProxy(address: string, timeoutMs: number): Promise<{ lat: number; lon: number } | null> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);

    const body = JSON.stringify({ address });
    const url = new URL(`${GEO_PROXY_URL}/geocode`);

    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'content-type': 'application/json',
        'x-proxy-key': PROXY_SHARED_KEY,
        'content-length': Buffer.byteLength(body).toString()
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        const total = Date.now() - t0;
        diag('geocode.proxy.result', { http: { status: res.statusCode }, timingMs: { total } });

        try {
          const j = JSON.parse(data);
          const first = j?.results?.[0];
          if (!first) return resolve(null);
          resolve({ lat: first.geometry.location.lat, lon: first.geometry.location.lng });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', (e: any) => {
      clearTimeout(timer);
      diag('geocode.proxy.error', { msg: e.message, timingMs: { total: Date.now() - t0 } });
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}
```

**Conditional routing** (in `geocodeWithTimeout`):
```typescript
// Use geo-proxy if enabled (feature-flagged)
if (USE_GEO_PROXY) {
  diag('geocode.proxy.call', { addressHash, timeoutMs, url: GEO_PROXY_URL });
  return await this.geocodeViaProxy(normalizedAddress, timeoutMs);
}
// ... otherwise use direct HTTPS call
```

## Deployment

### Prerequisites

1. **Secret Manager setup**:
```bash
# Store Google Maps API key (unrestricted, Geocoding API only)
echo -n "YOUR_MAPS_API_KEY" | gcloud secrets create GMAPS_KEY --data-file=-

# Store proxy shared key
openssl rand -base64 32 | gcloud secrets create PROXY_SHARED_KEY --data-file=-
```

2. **Grant proxy access to Maps key**:
```bash
gcloud secrets add-iam-policy-binding GMAPS_KEY \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Deploy Geo-Proxy

```bash
cd geo-proxy

gcloud run deploy geo-proxy \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --update-secrets "GMAPS_KEY=GMAPS_KEY:latest" \
  --set-env-vars "PROXY_SHARED_KEY=YOUR_SHARED_KEY" \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 30
```

**Critical**: DO NOT add `--vpc-connector` or `--network` flags - proxy must use default fast public egress.

### Deploy Worker with Proxy Enabled

```bash
cd frontend

gcloud run deploy propertyvision-worker \
  --source . \
  --region us-central1 \
  --no-allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --set-env-vars "\
    REDIS_URL=redis://10.85.154.187:6379,\
    USE_GEO_PROXY=true,\
    GEO_PROXY_URL=https://geo-proxy-PROJECT_ID.REGION.run.app,\
    PROXY_SHARED_KEY=YOUR_SHARED_KEY,\
    NODE_OPTIONS=--dns-result-order=ipv4first,\
    GOOGLE_API_USE_REST=1,\
    [... other env vars ...]" \
  --min-instances 1 \
  --max-instances 3 \
  --concurrency 1 \
  --timeout 3600
```

## Testing

### Test Geo-Proxy Directly

```bash
curl -s -X POST https://geo-proxy-PROJECT_ID.REGION.run.app/geocode \
  -H "content-type: application/json" \
  -H "x-proxy-key: YOUR_SHARED_KEY" \
  -d '{"address":"673 Pearce St SW, Atlanta, GA 30310"}' \
  | jq '{status, lat: .results[0].geometry.location.lat}'
```

**Expected output**:
```json
{
  "status": "OK",
  "lat": 33.7297372
}
```

### Test End-to-End

```bash
# Create test job
JOB=$(curl -X POST https://propertyvision-frontend-PROJECT_ID.REGION.run.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "673 Pearce St SW, Atlanta, GA 30310"}' 2>&1 | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)

# Wait 90 seconds
sleep 90

# Check status
curl -s https://propertyvision-frontend-PROJECT_ID.REGION.run.app/api/analyze/status/$JOB \
  | jq '{status, arv: .result.arv.estimate, comps: (.result.arv.compsUsed | length)}'
```

### Monitor Logs

**Check for successful geocoding**:
```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND
   resource.labels.service_name=propertyvision-worker AND
   (jsonPayload.event="geocode.proxy.call" OR
    jsonPayload.event="geocode.proxy.result" OR
    jsonPayload.event="geocode.success")' \
  --limit 20 --freshness=10m
```

**Expected log events**:
1. `geocode.proxy.call` - Worker calling proxy
2. `geocode.proxy.result` - Proxy response received (check `timingMs.total < 2000`)
3. `geocode.success` - Coordinates obtained

**Check proxy logs**:
```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND
   resource.labels.service_name=geo-proxy AND
   jsonPayload.event="proxy.response"' \
  --limit 10 --freshness=10m \
  --format='value(jsonPayload.timingMs.total)'
```

**Expected**: Response times <100ms

## Troubleshooting

### Issue: Proxy returns 401 Unauthorized

**Cause**: Shared key mismatch between worker and proxy

**Fix**:
```bash
# Verify proxy env var
gcloud run services describe geo-proxy --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)'

# Verify worker env var
gcloud run services describe propertyvision-worker --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)' | grep PROXY_SHARED_KEY
```

### Issue: Proxy returns REQUEST_DENIED

**Cause**: Maps API key has IP/referrer restrictions blocking Cloud Run public IPs

**Fix**: Use an unrestricted API key with only "Geocoding API" enabled in API restrictions

### Issue: No geocoding events in worker logs

**Possible causes**:
1. Worker not reaching geocoding phase (check for Vertex AI timeouts)
2. `USE_GEO_PROXY` not set to `true`
3. Worker timing out before geocoding

**Debug**:
```bash
# Check worker env vars
gcloud run services describe propertyvision-worker --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)' | grep -E 'USE_GEO_PROXY|GEO_PROXY_URL'

# Check for job errors
gcloud logging read \
  'resource.labels.service_name=propertyvision-worker AND severity>=ERROR' \
  --limit 20 --freshness=10m
```

### Issue: Geocoding still times out through proxy

**Possible causes**:
1. VPC connector still routing proxy calls through slow path
2. Network configuration blocking public egress

**Current status**: This is the ACTIVE BLOCKER as of this documentation. Worker with VPC connector + `private-ranges-only` appears unable to reach the public geo-proxy URL quickly.

**Potential solutions**:
1. Deploy geo-proxy with Internal Load Balancer and private IP in VPC
2. Use Private Service Connect for Google Maps API endpoints
3. Accept 30-second geocoding timeout and disable proxy

## Configuration Reference

### Environment Variables

**Geo-Proxy**:
- `GMAPS_KEY` - Google Maps API key (from Secret Manager)
- `PROXY_SHARED_KEY` - Authentication secret
- `PORT` - Server port (default: 8080)

**Worker**:
- `USE_GEO_PROXY` - Enable/disable proxy (`true`/`false`)
- `GEO_PROXY_URL` - Proxy service URL (e.g., `https://geo-proxy-xxx.run.app`)
- `PROXY_SHARED_KEY` - Authentication secret (must match proxy)
- `NODE_OPTIONS` - Set to `--dns-result-order=ipv4first`
- `GOOGLE_API_USE_REST` - Force REST for Google client libs (`1`)

### Secret Manager

**Secrets**:
- `GMAPS_KEY` - Latest version auto-updates on proxy redeploy
- `PROXY_SHARED_KEY` - Can be rotated without code changes

**Permissions**:
- Geo-proxy SA needs `roles/secretmanager.secretAccessor` on `GMAPS_KEY`

## Performance Metrics

**With geo-proxy (when working)**:
- DNS: ~2s (IPv4-first)
- Proxy call: <100ms
- Total geocoding: <2s ✅

**Without geo-proxy (direct VPC call)**:
- DNS: ~2s
- TCP handshake: 14-22s
- TLS handshake: 17-26s
- Total: >20s ❌

## Current Status

**As of latest deployment**:
- ✅ Geo-proxy functional - responds in <100ms when tested directly
- ✅ New unrestricted Maps API key configured
- ✅ Worker code updated with proxy client
- ❌ End-to-end flow blocked - worker with VPC connector unable to reach proxy quickly
- ❌ Vertex AI phase hanging, preventing geocoding from running

**Next steps**: Investigate VPC connector public egress performance or implement alternative solution.

## Related Files

- [/geo-proxy/src/index.ts](../geo-proxy/src/index.ts) - Proxy server implementation
- [/frontend/src/server/step3-find-comparables.ts](../frontend/src/server/step3-find-comparables.ts) - Worker geocoding logic
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - General deployment procedures
- [LOGGING_GUIDE.md](./LOGGING_GUIDE.md) - Log monitoring and debugging
