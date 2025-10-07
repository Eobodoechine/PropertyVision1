# Staging Deployment Guide

## Overview

This guide documents the complete staging environment configuration for PropertyVision. Use this to ensure staging matches production configuration and to avoid deployment issues.

**Last Updated**: 2025-10-07
**Issue Fixed**: Geocoding timeout causing "Invalid address: could not geocode" errors

---

## Environment Configuration

### Staging Services

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | `https://propertyvision-frontend-staging-839845580521.us-central1.run.app` | Next.js web application |
| Worker | `https://propertyvision-worker-staging-839845580521.us-central1.run.app` | Background job processor |
| Redis | `10.94.52.139:6379` | Job queue and caching (VPC internal) |

### Shared Services (Used by both Production and Staging)

| Service | URL | Purpose |
|---------|-----|---------|
| Geo-Proxy | `https://geo-proxy-839845580521.us-central1.run.app` | Fast geocoding proxy (no VPC) |
| Vertex-Proxy | `https://vertex-proxy-839845580521.us-central1.run.app` | Vertex AI proxy (no VPC) |

---

## Worker Configuration

### Required Environment Variables

The staging worker MUST have these environment variables configured identically to production:

```bash
# Redis Configuration (Staging-specific)
REDIS_HOST=10.94.52.139
REDIS_PORT=6379

# Worker Control
RUN_WORKER=true

# Geo-Proxy Configuration
USE_GEO_PROXY=true
GEO_PROXY_URL=https://geo-proxy-839845580521.us-central1.run.app

# Vertex-Proxy Configuration
USE_VERTEX_PROXY=true
FORCE_VERTEX_PROXY=true
VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app

# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8
GOOGLE_API_USE_REST=1

# Node Configuration
NODE_OPTIONS=--dns-result-order=ipv4first
NODE_ENV=staging

# Secrets (from Secret Manager)
GOOGLE_MAPS_API_KEY=secret:GMAPS_KEY:latest
PROXY_SHARED_KEY=secret:proxy-shared-key:latest
EMAIL_USER=secret:email-user:latest
EMAIL_PASS=secret:email-password:latest
EMAIL_FROM=secret:email-from:latest
GCP_SA_JSON_B64=secret:gcp-sa-json-b64:latest
```

### Cloud Run Settings

```bash
--region us-central1
--allow-unauthenticated
--min-instances 1              # Keep worker always running
--max-instances 3
--concurrency 1                # One job at a time
--timeout 3600                 # 1 hour timeout
--vpc-connector redis-connector
--vpc-egress private-ranges-only
```

---

## Critical Code Configuration

### Geocode Timeout

**File**: `frontend/src/server/utils/jobQueue.ts` (line ~354)

```typescript
const geocodeTimeout = 30000; // 30 second timeout for geocode (geo-proxy can take up to 30s through VPC)
```

**Why 30 seconds?**
- Production uses 30-second timeout
- Geo-proxy typically responds in 28-94ms
- But through VPC connector with `private-ranges-only` egress, the geo-proxy call can take up to 30 seconds
- 10-second timeout (previous value) was too short and caused "Invalid address: could not geocode" errors

---

## Deployment Commands

### Deploy Frontend (Staging)

```bash
cd /Users/eobodoechine/PropertyVision1/frontend

gcloud run deploy propertyvision-frontend-staging \
  --source . \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated
```

**Expected duration**: ~10-15 minutes

### Deploy Worker (Staging)

```bash
cd /Users/eobodoechine/PropertyVision1/frontend

gcloud run deploy propertyvision-worker-staging \
  --source . \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --update-env-vars "\
USE_GEO_PROXY=true,\
GEO_PROXY_URL=https://geo-proxy-839845580521.us-central1.run.app,\
USE_VERTEX_PROXY=true,\
FORCE_VERTEX_PROXY=true,\
VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app,\
GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,\
GOOGLE_API_USE_REST=1,\
NODE_OPTIONS=--dns-result-order=ipv4first,\
NODE_ENV=staging,\
RUN_WORKER=true,\
REDIS_HOST=10.94.52.139,\
REDIS_PORT=6379" \
  --update-secrets "\
GOOGLE_MAPS_API_KEY=GMAPS_KEY:latest,\
PROXY_SHARED_KEY=proxy-shared-key:latest,\
EMAIL_USER=email-user:latest,\
EMAIL_PASS=email-password:latest,\
EMAIL_FROM=email-from:latest,\
GCP_SA_JSON_B64=gcp-sa-json-b64:latest" \
  --min-instances 1 \
  --max-instances 3 \
  --concurrency 1 \
  --timeout 3600 \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only
```

**Expected duration**: ~10-15 minutes

---

## Verification Steps

### 1. Verify Worker Environment Variables

```bash
gcloud run services describe propertyvision-worker-staging \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --format json | jq -r '.spec.template.spec.containers[0].env[] | "\(.name)=\(.value // "FROM_SECRET")"' | sort
```

**Expected output should include all 17+ environment variables listed above.**

### 2. Verify Worker is Running

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND
   resource.labels.service_name="propertyvision-worker-staging" AND
   timestamp>="'$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)'"' \
  --limit 10 \
  --format json \
  --project agile-device-472202-i8 | \
  jq -r '.[] | "\(.timestamp) - \(.textPayload)"'
```

**Expected**: Logs showing "No messages received (timeout or empty queue)" every ~5 seconds (indicating worker is polling)

### 3. Test Geocoding

Submit a test job via the staging frontend with a known address:

**Test Address**: `2835 Tyler Dewayne Ct, Snellville, GA 30078`

Check logs for successful geocoding:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND
   resource.labels.service_name="propertyvision-worker-staging" AND
   jsonPayload.event="geocode.proxy.result"' \
  --limit 5 \
  --format json \
  --project agile-device-472202-i8 | \
  jq -r '.[] | "\(.timestamp) - Status: \(.jsonPayload.http.status) - Time: \(.jsonPayload.timingMs.total)ms"'
```

**Expected**: Status 200 with response time 28-94ms (typical), up to 30000ms (timeout)

### 4. Test End-to-End Job Processing

1. Navigate to staging frontend: `https://propertyvision-frontend-staging-839845580521.us-central1.run.app`
2. Enter address: `2835 Tyler Dewayne Ct, Snellville, GA 30078`
3. Click "Analyze Property"
4. Verify progress shows:
   - ✅ "Queued" (0%)
   - ✅ "Getting subject details" (10%)
   - ✅ "Comparable Search - Level 1" (40%)
   - ✅ Countdown timer appears (~14 seconds remaining)

---

## Common Issues and Solutions

### Issue 1: "Invalid address: could not geocode"

**Symptoms**: All addresses fail with geocoding error

**Root Cause**: Geocode timeout too short (10 seconds instead of 30 seconds)

**Solution**:
1. Verify `geocodeTimeout = 30000` in `frontend/src/server/utils/jobQueue.ts:354`
2. Redeploy worker
3. Test with known good address

**How to Verify**:
```bash
gcloud logging read \
  'resource.labels.service_name="propertyvision-worker-staging" AND
   jsonPayload.event="geocode.proxy.call"' \
  --limit 1 \
  --format json \
  --project agile-device-472202-i8 | \
  jq '.[] | .jsonPayload.timeoutMs'
```

Expected: `30000`

### Issue 2: "Cannot read properties of undefined (reading 'getSubjectDetails')"

**Symptoms**: Worker crashes after geocoding succeeds

**Root Cause**: Missing environment variables prevent services from initializing

**Solution**: Add all required environment variables (see "Required Environment Variables" section above)

**How to Verify**:
```bash
gcloud run services describe propertyvision-worker-staging \
  --region us-central1 \
  --format json | \
  jq -r '.spec.template.spec.containers[0].env | length'
```

Expected: At least 17 environment variables

### Issue 3: Worker not processing jobs (queue always empty)

**Symptoms**: Worker shows "No messages received" but jobs are stuck in "Queued" state

**Root Cause**: `RUN_WORKER=true` not set, or `min-instances=0` causing cold starts

**Solution**:
```bash
gcloud run services update propertyvision-worker-staging \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --update-env-vars "RUN_WORKER=true" \
  --min-instances 1
```

### Issue 4: Geo-proxy returns 401 Unauthorized

**Symptoms**: Geocoding fails with "socket hang up" or 401 error

**Root Cause**: `PROXY_SHARED_KEY` mismatch between worker and geo-proxy

**Solution**:
```bash
# Get the correct key from geo-proxy
CORRECT_KEY=$(gcloud run services describe geo-proxy \
  --region us-central1 \
  --format json | \
  jq -r '.spec.template.spec.containers[0].env[] | select(.name == "PROXY_SHARED_KEY") | .value')

echo "Correct key: $CORRECT_KEY"

# Verify it matches the secret
gcloud secrets versions access latest --secret=proxy-shared-key
```

---

## Differences Between Staging and Production

| Configuration | Production | Staging | Notes |
|---------------|------------|---------|-------|
| Redis Host | `10.85.154.187` | `10.94.52.139` | Different Redis instances |
| Redis Port | `6379` | `6379` | Same |
| NODE_ENV | `production` | `staging` | For logging metadata only |
| Geo-Proxy URL | Same | Same | Shared service |
| Vertex-Proxy URL | Same | Same | Shared service |
| All other env vars | Same | Same | Must match exactly |

---

## Monitoring and Debugging

### View Worker Logs (Live Tail)

```bash
gcloud beta logging tail \
  'resource.type="cloud_run_revision" AND
   resource.labels.service_name="propertyvision-worker-staging"' \
  --project agile-device-472202-i8
```

### View Recent Errors

```bash
gcloud logging read \
  'resource.labels.service_name="propertyvision-worker-staging" AND
   severity>=ERROR AND
   timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"' \
  --limit 20 \
  --format json \
  --project agile-device-472202-i8 | \
  jq -r '.[] | "\(.timestamp) - \(.textPayload // .jsonPayload.message)"'
```

### Compare Production vs Staging Config

```bash
echo "=== PRODUCTION ===" && \
gcloud run services describe propertyvision-worker \
  --region us-central1 \
  --format json | \
  jq -r '.spec.template.spec.containers[0].env[] | "\(.name)=\(.value // "SECRET")"' | sort

echo -e "\n=== STAGING ===" && \
gcloud run services describe propertyvision-worker-staging \
  --region us-central1 \
  --format json | \
  jq -r '.spec.template.spec.containers[0].env[] | "\(.name)=\(.value // "SECRET")"' | sort
```

---

## Related Documentation

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - General deployment procedures for production
- [GEO_PROXY_GUIDE.md](./GEO_PROXY_GUIDE.md) - Geo-proxy implementation and troubleshooting
- [COUNTDOWN_TIMER_IMPLEMENTATION.md](./COUNTDOWN_TIMER_IMPLEMENTATION.md) - Countdown timer feature details
- [LOGGING_GUIDE.md](./LOGGING_GUIDE.md) - Log monitoring and debugging

---

## Changelog

### 2025-10-07 - Initial Creation
- Documented complete staging environment configuration
- Fixed geocoding timeout issue (10s → 30s)
- Added all missing environment variables to match production
- Set min-instances=1 to keep worker always running
- Verified end-to-end job processing with countdown timer
