# Deployment Stabilization: Fix 429 Errors & Token Truncation

## Summary

This deployment implements surgical fixes to stop Vertex AI quota exhaustion (429 errors) and JSON truncation issues before testing ARV algorithm changes.

## Changes Implemented

### 1. Rate Limiting Infrastructure
- **New File**: `src/server/utils/vertexRateLimit.ts`
- **Package**: Added `bottleneck@^2.19.5` to [package.json](package.json)
- **Features**:
  - Global token-bucket rate limiter (4 RPS default, 2 max concurrent)
  - Exponential backoff + jitter retry logic for 429/5xx errors
  - Respects `Retry-After` header

### 2. Circuit Breaker
- **New File**: `src/server/utils/vertexCircuitBreaker.ts`
- **Features**:
  - Opens after 5x 429 errors in 60s window
  - Stays open for 60s to allow quota recovery
  - Worker returns 200 OK (ACK) when open, preventing Pub/Sub retry storm

### 3. Deduplication Updates
- **Modified File**: [src/server/utils/vertexDeduplicator.ts](src/server/utils/vertexDeduplicator.ts)
- **Changes**:
  - Wrapped all `vertexGenerate` calls with `callWithRetries()`
  - Added circuit breaker check before calls (`ensureClosed()`)
  - Record 429 errors for circuit breaker (`record429()`)
  - Added 3 JSON probes: `DEDUP_CALL`, `DEDUP_RESULT`, `DEDUP_ERROR`
  - Use env var `PV_DEDUP_MAXTOKENS` (default 4096) instead of hardcoded 4096

### 4. Worker Updates
- **Modified File**: [src/server/worker.ts](src/server/worker.ts)
- **Changes**:
  - Check circuit breaker status before processing jobs
  - Return 200 OK when breaker is open (lets Pub/Sub retry policy handle delay)

### 5. ARV Probes
- **Modified File**: [src/server/comprehensive-comp-search-v10.ts](src/server/comprehensive-comp-search-v10.ts)
- **Changes**:
  - Added `ARV_INPUT` probe (comps count, address, revision)
  - Added `ARV_OUTPUT` probe (method, prices, comp counts, flags, revision)

---

## Deployment Steps

### Phase 1: Install Dependencies

```bash
npm install
```

### Phase 2: Configure Pub/Sub (Production & Staging)

#### 2.1 Create Dead-Letter Topic

```bash
gcloud pubsub topics create worker-dead-letter \
  --project=durable-ring-475417-g0
```

#### 2.2 Update Staging Subscription

```bash
gcloud pubsub subscriptions update property-analysis-jobs-sub-staging \
  --project=durable-ring-475417-g0 \
  --min-retry-delay=30s \
  --max-retry-delay=600s \
  --dead-letter-topic=projects/durable-ring-475417-g0/topics/worker-dead-letter \
  --max-delivery-attempts=6
```

#### 2.3 Update Production Subscription

```bash
gcloud pubsub subscriptions update property-analysis-jobs-sub \
  --project=durable-ring-475417-g0 \
  --min-retry-delay=30s \
  --max-retry-delay=600s \
  --dead-letter-topic=projects/durable-ring-475417-g0/topics/worker-dead-letter \
  --max-delivery-attempts=6
```

**Effect**: First retry after 30s (was instant), max 600s (10 min), dead-letter after 6 attempts

### Phase 3: Deploy to Staging

#### 3.1 Set Environment Variables

Add to Cloud Run worker-staging service:

```bash
PV_DEDUP_MAXTOKENS=4096
PV_VERTEX_RPS=4
PV_VERTEX_MAX_CONCURRENCY=2
```

#### 3.2 Deploy Worker Service

```bash
./scripts/deploy-helper.sh worker staging
```

### Phase 4: Canary Test in Staging

#### 4.1 Test Address

Use the same address from previous tests:
```
2835 tyler dewayne ct, snellville ga 30078
```

#### 4.2 Success Criteria

Check logs for these probes:

**✅ DEDUP_CALL probe**:
```json
{"probe":"DEDUP_CALL","model":"gemini-2.5-pro","maxOutputTokens":4096,"grounded":false,"promptLength":...,"properties":...,"rev":"..."}
```

**✅ DEDUP_RESULT probe** (no `MAX_TOKENS`):
```json
{"probe":"DEDUP_RESULT","finishReason":"COMPLETE","jsonBytes":...,"duplicateGroups":...,"rev":"..."}
```

**✅ ARV_INPUT probe**:
```json
{"probe":"ARV_INPUT","compsIn":...,"addr":"...","rev":"..."}
```

**✅ ARV_OUTPUT probe**:
```json
{"probe":"ARV_OUTPUT","method":"...","conservativePrice":...,"aggressivePrice":...,"keptComps":...,"droppedComps":...,"flags":{...},"rev":"..."}
```

**✅ No DEDUP_ERROR probes** (or very few):
```json
{"probe":"DEDUP_ERROR","code":429,...}  // Should NOT appear
```

**✅ Circuit breaker never opens**:
```
🔴 Circuit breaker OPEN  // Should NOT appear
```

**✅ Job completes successfully** (not stuck in Pub/Sub retry loop)

### Phase 5: Deploy to Production

**Only after staging passes canary test for 24 hours**:

```bash
# Set same env vars in production worker
PV_DEDUP_MAXTOKENS=4096
PV_VERTEX_RPS=4
PV_VERTEX_MAX_CONCURRENCY=2

# Deploy production
./scripts/deploy-helper.sh worker production
```

---

## Environment Variables Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `PV_DEDUP_MAXTOKENS` | 4096 | Max output tokens for dedup call (prevents truncation) |
| `PV_VERTEX_RPS` | 4 | Requests per second limit (conservative, can raise later) |
| `PV_VERTEX_MAX_CONCURRENCY` | 2 | Max concurrent Vertex calls |

---

## Rollback Plan

If issues occur after deployment:

### 1. Quick Fix: Increase Limits

```bash
# In Cloud Run env vars
PV_VERTEX_RPS=8  # Double rate limit
PV_VERTEX_MAX_CONCURRENCY=4  # Double concurrency
```

### 2. Full Rollback

```bash
# Revert to previous Cloud Run revision
gcloud run services update-traffic propertyvision-worker-staging \
  --to-revisions=PREVIOUS_REVISION=100 \
  --project=durable-ring-475417-g0
```

### 3. Revert Pub/Sub Config

```bash
# Reset retry delays to default (minimum 10s)
gcloud pubsub subscriptions update property-analysis-jobs-sub-staging \
  --project=durable-ring-475417-g0 \
  --min-retry-delay=10s \
  --max-retry-delay=600s \
  --clear-dead-letter-policy
```

---

## Verification Queries

### Check 429 Errors in Logs

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-worker-staging" AND jsonPayload.message=~"429"' \
  --limit 50 \
  --format json \
  --project durable-ring-475417-g0
```

### Check Circuit Breaker Status

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-worker-staging" AND textPayload=~"Circuit breaker"' \
  --limit 20 \
  --format json \
  --project durable-ring-475417-g0
```

### Check Probes

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-worker-staging" AND textPayload=~"probe"' \
  --limit 50 \
  --format json \
  --project durable-ring-475417-g0 \
  | jq -r '.[] | .textPayload' \
  | jq -s 'group_by(.probe) | map({probe: .[0].probe, count: length})'
```

---

## Next Steps (After Stabilization)

Once staging is stable for 24 hours with zero 429 errors:

1. **Deploy to production**
2. **Monitor for 48 hours**
3. **Implement ARV strategy toggle** (`PV_ARV_STRATEGY=old|new`)
4. **Run A/B test** with same 10 addresses
5. **Compare ARV outputs** objectively via probes
6. **Decide** which ARV algorithm to keep

---

## Files Changed

**New Files** (3):
- [src/server/utils/vertexRateLimit.ts](src/server/utils/vertexRateLimit.ts)
- [src/server/utils/vertexCircuitBreaker.ts](src/server/utils/vertexCircuitBreaker.ts)
- [DEPLOYMENT-STABILIZATION.md](DEPLOYMENT-STABILIZATION.md) (this file)

**Modified Files** (4):
- [package.json](package.json) - Added `bottleneck@^2.19.5`
- [src/server/utils/vertexDeduplicator.ts](src/server/utils/vertexDeduplicator.ts) - Rate limiter, circuit breaker, probes
- [src/server/worker.ts](src/server/worker.ts) - Circuit breaker check
- [src/server/comprehensive-comp-search-v10.ts](src/server/comprehensive-comp-search-v10.ts) - ARV probes

**Infrastructure**:
- Pub/Sub subscriptions: `property-analysis-jobs-sub`, `property-analysis-jobs-sub-staging`
- Pub/Sub topic: `worker-dead-letter` (new)

---

## Contact

For issues or questions about this deployment, refer to the investigation timeline in the session summary.
