# Working Deployment Process - PropertyVision Worker

## Last Successful Deployment: October 5, 2025

**Working Revision**: `propertyvision-worker-00070-7mg`
**Image**: `gcr.io/agile-device-472202-i8/propertyvision-worker@sha256:7802a5584823a004bc5a987d0272f50c6ea7619b2e2fedef2fd6a624d1dbfd1f`
**Status**: ✅ Successfully processing jobs with 30-second geocoding timeout

---

## Complete Deployment Command

```bash
cd /Users/eobodoechine/PropertyVision1/frontend

# Step 1: Build the Docker image with explicit tag
gcloud builds submit --tag gcr.io/agile-device-472202-i8/propertyvision-worker:v3 --project=agile-device-472202-i8

# Step 2: Deploy with ALL 14 required environment variables
gcloud run deploy propertyvision-worker \
  --image gcr.io/agile-device-472202-i8/propertyvision-worker:v3 \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --no-allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --service-account 839845580521-compute@developer.gserviceaccount.com \
  --set-env-vars "RUN_WORKER=true,NODE_ENV=production,USE_GEO_PROXY=true,GEO_PROXY_URL=https://geo-proxy-839845580521.us-central1.run.app,USE_VERTEX_PROXY=true,FORCE_VERTEX_PROXY=true,VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app,REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json,NODE_OPTIONS=--dns-result-order=ipv4first,GOOGLE_API_USE_REST=1" \
  --set-secrets "PROXY_SHARED_KEY=proxy-shared-key:latest" \
  --min-instances 1 \
  --max-instances 3 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --no-cpu-throttling

# Step 3: Find the newly created revision
gcloud run revisions list --service=propertyvision-worker --region=us-central1 --project=agile-device-472202-i8 --limit=3

# Step 4: Route traffic to the new revision
gcloud run services update-traffic propertyvision-worker \
  --to-revisions=propertyvision-worker-XXXXX-xxx=100 \
  --region=us-central1 \
  --project=agile-device-472202-i8
```

---

## Required Environment Variables (All 14)

### From `frontend/ASYNC_JOBS_COMPLETE.md` (12 variables):
1. `RUN_WORKER=true` - Enables worker mode
2. `NODE_ENV=production` - Production environment
3. `USE_GEO_PROXY=true` - Enable geo-proxy for geocoding
4. `GEO_PROXY_URL=https://geo-proxy-839845580521.us-central1.run.app` - Geo-proxy service URL
5. `USE_VERTEX_PROXY=true` - Enable vertex-proxy
6. `FORCE_VERTEX_PROXY=true` - Force all Vertex calls through proxy
7. `VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app` - Vertex-proxy service URL
8. `REDIS_URL=redis://10.85.154.187:6379` - Redis connection (private IP)
9. `GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8` - GCP project ID
10. `GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json` - **CRITICAL** Service account path
11. `GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc` - Maps API key
12. `GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json` - **CRITICAL** Service account path

### From `GEO_PROXY_GUIDE.md` (2 variables):
13. `NODE_OPTIONS=--dns-result-order=ipv4first` - Prefer IPv4 for DNS
14. `GOOGLE_API_USE_REST=1` - Force REST instead of gRPC for Google APIs

### Required Secret:
- `PROXY_SHARED_KEY=proxy-shared-key:latest` (from Secret Manager in agile-device-472202-i8)

---

## Code Changes Required

### File: `frontend/src/server/step3-find-comparables.ts`

**Change geocoding timeout from 5 seconds to 30 seconds:**

```typescript
// Line 96: Subject property geocoding
const subjectCoords = await this.geocodeWithTimeout(subjectAddress, 30000); // Changed from 5000

// Line 547: Comparable property geocoding
const coords = await this.geocodeWithTimeout(prop.address, 30000); // Changed from 5000
```

**Why 30 seconds?**
- Direct Maps API calls through VPC with `private-ranges-only` egress take 20-25 seconds
- TCP/TLS handshake through VPC: 15-20 seconds
- DNS resolution: ~2 seconds
- API response: 2-5 seconds
- Total: 20-25 seconds, so 30-second timeout provides safe margin

---

## Critical Build Process

### ⚠️ IMPORTANT: Use `gcloud builds submit`, NOT `gcloud run deploy --source`

**Why?**
- `gcloud run deploy --source` uses buildpacks with aggressive caching
- Buildpacks set file timestamps to Jan 1, 1980 for reproducible builds
- Result: Code changes may NOT be picked up even after successful build
- Cloud Run may reuse old images even with new source code

**Correct Process:**
1. Use `gcloud builds submit` to build image with explicit tag
2. Deploy that specific image with `--image` flag
3. Check which revision was created (Cloud Run reuses revisions with matching configs)
4. Route traffic to the new revision explicitly

---

## What Failed and Why - Learn From These Mistakes

### ❌ Failure 1: Geo-Proxy with Public URL
**What we tried:** Deploy geo-proxy without VPC, call it from worker via public URL
**Result:** Worker with `vpc-egress private-ranges-only` cannot reach public URLs within 5-second timeout
**Why it failed:** VPC routing through Serverless VPC Access Connector is very slow for public internet (15-20s TCP/TLS handshake)
**Duration:** Multiple hours attempting to debug

### ❌ Failure 2: Internal Load Balancer for Geo-Proxy
**What we tried:** Deploy ILB with private IP (10.128.0.3) to give geo-proxy a VPC-accessible endpoint
**Result:** Worker still couldn't reach geo-proxy within 5-second timeout
**Why it failed:** Even private IP routing through VPC connector was too slow; same 15-20s overhead
**Infrastructure created:**
- Serverless NEG: `geo-proxy-neg`
- Backend service: `geo-proxy-backend`
- URL map: `geo-proxy-url-map`
- HTTP proxy: `geo-proxy-http-proxy`
- Proxy-only subnet: `proxy-only-subnet` (192.168.0.0/23)
- Forwarding rule: `geo-proxy-ilb` (IP: 10.128.0.3)
**Status:** Infrastructure still exists but unused

### ❌ Failure 3: Missing Critical Environment Variables
**What we tried:** Deploy with partial environment variables from GEO_PROXY_GUIDE.md only
**Result:** `fetchPropertyDetailsViaVertex` failed immediately with "Could not fetch subject property details"
**Why it failed:** Missing `GOOGLE_APPLICATION_CREDENTIALS` and `GCP_SA_JSON` - without these, service account authentication fails
**Lesson:** Must combine variables from BOTH `ASYNC_JOBS_COMPLETE.md` AND `GEO_PROXY_GUIDE.md`

### ❌ Failure 4: Cloud Run Revision Reuse
**What we tried:** Deploy with same configuration but different image
**Result:** Cloud Run reused old revision with old image instead of creating new revision
**Why it failed:** Cloud Run matches configuration (env vars, secrets, VPC, etc.) and reuses existing revisions even if image is different
**How to check:** Always run `gcloud run revisions list` after deploy to see which revision was actually created/reused
**Workaround:** Change a dummy env var (like `DEPLOY_VERSION=v3`) or check revision list for newly created revisions

### ❌ Failure 5: Source Deployment Caching
**What we tried:** Use `gcloud run deploy --source .` to build and deploy
**Result:** Changes to code were not reflected in deployed service
**Why it failed:** Buildpacks cache layers and use reproducible builds (timestamp Jan 1, 1980), causing Cloud Run to reuse old builds
**Fix:** Use `gcloud builds submit` with explicit tag, then deploy that image

### ❌ Failure 6: Wrong Project for Secrets
**What we tried:** Deploy with secrets from project 839845580521
**Result:** Permission denied on secrets
**Why it failed:** Secrets are in project `agile-device-472202-i8`, not `839845580521`
**Fix:** Only use `PROXY_SHARED_KEY` secret from `agile-device-472202-i8`; all other API keys are env vars, not secrets

---

## Solution That Worked: Accept 30-Second Timeout

**Final approach:** Disable geo-proxy, increase geocoding timeout to 30 seconds, let direct Maps API calls complete through VPC

**Why this works:**
- VPC egress `private-ranges-only` allows:
  - ✅ Redis (private IP 10.85.154.187) - instant access
  - ✅ Vertex AI (via Private Google Access to 199.36.153.x) - fast access
  - ✅ Maps API (via slow VPC path) - 20-25 seconds but eventually completes
- With 30-second timeout, Maps API calls complete successfully
- Tradeoff: Each job takes 60+ seconds longer (2 geocoding calls × 30s = 60s overhead)
- Benefit: Simple, no additional infrastructure, guaranteed to work

---

## VPC Configuration (Required)

**VPC Connector:** `redis-connector`
- Network: `default`
- IP Range: `10.8.0.0/28`
- Min instances: 2
- Max instances: 10
- Region: `us-central1`
- Status: READY

**VPC Egress:** `private-ranges-only`
- Allows access to private IPs (Redis)
- Allows access to Google APIs via Private Google Access
- Blocks fast access to public internet (slow 15-20s handshakes)

**Private Google Access:** Enabled on `default` subnet in `us-central1`
- Required for Vertex AI and Cloud Logging
- Check with: `gcloud compute networks subnets describe default --region=us-central1 --format="value(privateIpGoogleAccess)"`

---

## Testing After Deployment

### Test 1: Simple Address
```bash
curl -s -X POST https://propertyvision-frontend-839845580521.us-central1.run.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "673 Pearce St SW, Atlanta, GA 30310"}'
```
**Expected Result:** Job completes with ARV estimate (e.g., $582,990)

### Test 2: Problematic Address
```bash
curl -s -X POST https://propertyvision-frontend-839845580521.us-central1.run.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "430 burgundy terrace, atlanta, ga, 30354"}'
```
**Expected Result:** Job completes with ARV estimate (e.g., $463,888)
**Time:** 2-3 minutes (includes geocoding overhead)

### Check Job Status
```bash
curl -s https://propertyvision-frontend-839845580521.us-central1.run.app/api/analyze/status/JOB_ID | jq '{status, arv: .result.arv.estimate, comps: (.result.arv.compsUsed // [] | length), error: .error}'
```

### Monitor Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-worker AND resource.labels.revision_name=propertyvision-worker-00070-7mg AND timestamp>=\"2025-10-05T22:00:00Z\"" --limit 100 --project=agile-device-472202-i8
```

---

## Key Lessons Learned

### 1. **No Single .md File Has Complete Configuration**
- `frontend/ASYNC_JOBS_COMPLETE.md` has 12 variables
- `GEO_PROXY_GUIDE.md` has 2 additional variables
- **MUST combine both** for complete configuration

### 2. **Missing GOOGLE_APPLICATION_CREDENTIALS = Instant Failure**
- Service account authentication requires both:
  - `GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json`
  - `GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json`
- Without these, `fetchPropertyDetailsViaVertex` fails silently with generic error

### 3. **VPC Egress private-ranges-only Is Slow for Public Internet**
- Direct Maps API calls: 20-25 seconds
- Geo-proxy via public URL: 15-20+ seconds (unusable with 5s timeout)
- Geo-proxy via ILB private IP: 15-20+ seconds (still too slow)
- **Only solution:** Increase timeout to 30 seconds

### 4. **Cloud Run Revision Reuse Is Aggressive**
- Cloud Run matches configuration and reuses revisions
- Always check `gcloud run revisions list` after deploy
- Verify the image SHA matches your new build
- Use revision list to find newly created revision, then route traffic explicitly

### 5. **Use gcloud builds submit for Explicit Control**
- `gcloud run deploy --source` has unpredictable caching
- `gcloud builds submit` with explicit tag ensures new build
- Deploy the explicit image tag with `--image` flag
- This guarantees code changes are included

### 6. **Geo-Proxy Architecture Is Sound But VPC Routing Breaks It**
- Geo-proxy itself works perfectly (<100ms response time)
- Problem: Worker cannot reach it quickly through VPC
- ILB doesn't solve the VPC routing slowness
- Conclusion: Proxy architecture requires `vpc-egress all-traffic` (but that breaks Vertex AI)

### 7. **Vertex-Proxy Works, Geo-Proxy Doesn't (with current VPC config)**
- Vertex-proxy: Works because we can wait 10+ minutes for responses
- Geo-proxy: Fails because geocoding needs <5s but VPC path takes 15-20s
- Solution: Accept 30s geocoding timeout, skip geo-proxy entirely

---

## Deployment Checklist for Future Agents

- [ ] Navigate to `frontend/` directory
- [ ] Update `step3-find-comparables.ts` with 30-second timeout (lines 96, 547)
- [ ] Build image: `gcloud builds submit --tag gcr.io/agile-device-472202-i8/propertyvision-worker:vN`
- [ ] Deploy with **all 14 environment variables** from both .md files
- [ ] Include `--set-secrets "PROXY_SHARED_KEY=proxy-shared-key:latest"`
- [ ] Verify VPC connector: `redis-connector`
- [ ] Verify VPC egress: `private-ranges-only`
- [ ] Check revision list to find newly created revision
- [ ] Verify new revision has correct image SHA
- [ ] Route traffic: `gcloud run services update-traffic propertyvision-worker --to-revisions=REVISION=100`
- [ ] Test with simple address (673 Pearce St)
- [ ] Test with problematic address (430 burgundy terrace)
- [ ] Monitor logs for errors
- [ ] Confirm jobs complete with ARV estimates

---

## Infrastructure Dependencies

### Required Services
- Redis (Memorystore): `10.85.154.187:6379`
- Vertex-proxy: `https://vertex-proxy-839845580521.us-central1.run.app`
- Geo-proxy: `https://geo-proxy-839845580521.us-central1.run.app` (deployed but not used)
- VPC Connector: `redis-connector`

### Required Secrets (in agile-device-472202-i8)
- `proxy-shared-key` - Shared key for proxy authentication
- `GMAPS_KEY` - Google Maps API key (used by geo-proxy)

### Service Account
- `839845580521-compute@developer.gserviceaccount.com`
- Needs access to: Vertex AI, Cloud Logging, Secret Manager

---

## Performance Metrics

**With 30-second timeout (current solution):**
- Subject property geocoding: 20-25 seconds
- Each comparable geocoding: 20-25 seconds (but usually cached from Redis)
- Total job time: 2-3 minutes
- Success rate: High
- User experience: Acceptable but slow

**Attempted but failed (geo-proxy with 5s timeout):**
- Would have been: <2 seconds per geocode
- Total job time: <1 minute
- Success rate: 0% (all timeouts)
- Status: Abandoned due to VPC routing limitations

---

## File Paths Reference

- Code changes: `/Users/eobodoechine/PropertyVision1/frontend/src/server/step3-find-comparables.ts`
- Build from: `/Users/eobodoechine/PropertyVision1/frontend/`
- Service account JSON: `/app/agile-device-472202-i8-319f002d9438.json` (in container)
- Complete env vars: `frontend/ASYNC_JOBS_COMPLETE.md` (line 86) + `GEO_PROXY_GUIDE.md` (lines 389-390)

---

## Success Indicators

✅ Revision deployed with v3 image (sha256:7802a5584...)
✅ All 14 environment variables present
✅ `GOOGLE_APPLICATION_CREDENTIALS` set correctly
✅ VPC connector and egress configured
✅ Jobs complete with ARV estimates
✅ No "Could not fetch subject property details" errors
✅ Geocoding completes within 30 seconds

**Last verified working:** October 5, 2025 at 22:30 UTC
**Revision:** propertyvision-worker-00070-7mg
**Test results:**
- 673 Pearce St: $582,990 ARV ✅
- 430 Burgundy Terrace: $463,888 ARV ✅
