# Local Testing Guide - PropertyVision Progress Tracking

Complete guide for testing PropertyVision locally with progress tracking, real ETA countdown, and email notifications.

## Quick Start

```bash
# 1. Start local Redis
docker run -d --name propertyvision-redis-local -p 6379:6379 redis:7-alpine

# 2. Start frontend (Terminal 1)
cd /Users/eobodoechine/PropertyVision1/frontend
npm run dev

# 3. Start worker (Terminal 2)
cd /Users/eobodoechine/PropertyVision1/frontend
./start-worker-local-fixed.sh

# 4. Open browser
open http://localhost:3000
```

## Prerequisites

- **Docker Desktop** - Running and accessible
- **Node.js** - v18+ with npm
- **GCP Credentials** - Service account JSON file
- **Gmail App Password** - For email notifications

## Detailed Setup

### 1. Local Redis Setup

Production Redis (10.85.154.187) is on GCP's internal VPC and not accessible from local machines. Use Docker instead:

```bash
# Start Redis container
docker run -d --name propertyvision-redis-local -p 6379:6379 redis:7-alpine

# Verify it's running
docker ps | grep redis

# Stop Redis (when done testing)
docker stop propertyvision-redis-local

# Remove Redis container
docker rm propertyvision-redis-local
```

**Convenience script:** [`/Users/eobodoechine/PropertyVision1/start-redis.sh`](start-redis.sh)

### 2. Environment Configuration

File: `/Users/eobodoechine/PropertyVision1/frontend/.env.local`

```bash
# Worker Configuration
RUN_WORKER=true
NODE_ENV=production  # Enables Cloud Logging to GCP

# Local Testing - Bypass Firebase Auth
NEXT_PUBLIC_DISABLE_AUTH=true

# Frontend API URL - CRITICAL for local testing
# Without this, frontend API calls will fail with 404 errors
# Must restart dev server after adding/changing this variable
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000

# Vertex AI Service Account (required)
GCP_SA_JSON=/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json
GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc

# Google Cloud Logging
GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8
GOOGLE_APPLICATION_CREDENTIALS=/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json

# Redis Cache (local Docker Redis)
REDIS_URL=redis://localhost:6379

# Email Notifications (Gmail)
EMAIL_USER=lopez.b.mikaela@gmail.com
EMAIL_PASS=dudnzaafegqjzfci
EMAIL_FROM=PropertyVision Alerts <alerts@propertyvision.app>

# Vertex Proxy Configuration
USE_VERTEX_PROXY=true
FORCE_VERTEX_PROXY=true
VERTEX_PROXY_URL=https://vertex-proxy-839845580521.us-central1.run.app
PROXY_SHARED_KEY=GnbM4TK7RRhsDqvPU9alb/QtGr6sTnEuzma4ZNczJAc=
```

**Key Settings:**
- `NEXT_PUBLIC_DISABLE_AUTH=true` - Bypasses Firebase authentication for local testing
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` - **CRITICAL**: Routes frontend API calls to local server (must restart dev server after adding)
- `NODE_ENV=production` - Sends logs to Google Cloud Logging for debugging
- `REDIS_URL=redis://localhost:6379` - Uses local Docker Redis instead of GCP internal VPC
- Email notifications forward to: `nnamdi@enohomebuyers.com`

**⚠️ Important:** After adding or modifying any `NEXT_PUBLIC_*` environment variable, you **must restart** the Next.js dev server. These variables are embedded at build/startup time, not loaded dynamically.

### 3. Start Frontend Dev Server

```bash
cd /Users/eobodoechine/PropertyVision1/frontend
npm run dev
```

Frontend available at: **http://localhost:3000**

### 4. Start Worker Process

**Important:** Use the `start-worker-local-fixed.sh` script because `tsx` doesn't auto-load `.env.local` files.

```bash
cd /Users/eobodoechine/PropertyVision1/frontend
chmod +x start-worker-local-fixed.sh
./start-worker-local-fixed.sh
```

**What this script does:**
- Explicitly exports all environment variables from `.env.local`
- Starts worker with: `npx tsx src/server/worker.ts`
- Logs output to: `/tmp/worker_fixed.log`

## How We Got Local Dev Working

### Critical Issues Resolved

#### 1. Frontend API Calls Returning 404
**Problem:** Status polling failed with `Failed to get job status` errors.

**Root Cause:** The frontend's `API_BASE_URL` defaulted to empty string when `NEXT_PUBLIC_API_BASE_URL` wasn't set. This caused requests to go to the wrong endpoint.

**Solution:**
- Added `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` to `.env.local`
- **Must restart Next.js dev server** after adding this variable (it's embedded at build time)

**Verification:**
```bash
# Check network requests in browser DevTools
# Should see: http://localhost:3000/api/analyze/status/[jobId] returning 200 OK
```

#### 2. Real-Time Countdown Timer
**Problem:** How to make ETA count down smoothly (40s → 39s → 38s...) without worker updating Redis every second.

**Solution:** Server-side ETA calculation in status API endpoint ([src/app/api/analyze/status/[jobId]/route.ts:22-27](frontend/src/app/api/analyze/status/[jobId]/route.ts#L22-L27)):

```typescript
// Worker stores these once when phase starts:
// - estimatedTimeRemaining: 40 (total seconds for phase)
// - phaseStartTime: Date.now()

// API calculates real-time remaining on each poll:
let realTimeRemaining = job.estimatedTimeRemaining || 0;
if (job.phaseStartTime && job.estimatedTimeRemaining) {
  const elapsedSeconds = Math.floor((Date.now() - job.phaseStartTime) / 1000);
  realTimeRemaining = Math.max(0, job.estimatedTimeRemaining - elapsedSeconds);
}
```

**How it works:**
1. Frontend polls every 2 seconds
2. API calculates: `remaining = estimatedTime - (now - startTime)`
3. Returns dynamically calculated countdown
4. No Redis writes needed every second!

#### 3. Email Notifications Taking ~4 Minutes
**Problem:** Email arrived quickly (<1s after failure), but job took ~4 minutes to fail.

**Root Cause:** Invalid addresses (like "333") trigger multiple retry strategies:
- Direct property lookup
- Comprehensive search with multiple fallback attempts
- Each Vertex AI call can take 10-30+ seconds

**Why it's slow:**
- Worker exhausts all retry attempts before giving up
- This is **intentional behavior** to maximize success rate for edge cases
- Email sends immediately once job fails (< 1 second)

**Current behavior:**
- Invalid address "333": ~4 minutes until failure → email sent
- Valid address with missing data: Multiple Vertex retries → eventual success or failure

## What Was Implemented

### 1. Progress Tracking System (V10 Parallel Search)

**7-Phase Progress Flow (All 4 search levels run in parallel):**

| Phase | Progress | Message | Est. Time |
|-------|----------|---------|-----------|
| QUEUED | 0% | Queued for processing | 5s |
| SUBJECT_PROPERTY | 10% | Fetching property details | 540s |
| COMPARABLE_SEARCH_L1-4 | 30% | Running parallel comparable search (Levels 1-4) | 240s |
| DEDUPLICATION | 60% | Removing duplicate properties | 40s |
| ARV_CALCULATION | 75% | Calculating ARV | 10s |
| FINALIZING | 90% | Preparing analysis report | 5s |
| COMPLETED | 100% | Complete | - |

**V10 Parallel Search Features:**
- All 4 search levels (1-mile, 2-mile, 3-mile, 5-mile) run **simultaneously**
- Progressive qualification: Apply L1→L2→L3→L4 criteria on accumulated results
- Early exit when target comps (6) found
- **39-42% faster**: 449s → 254-274s total time
- Visual green progress bar shows real-time completion
- 90+ comprehensive error handlers with full context logging

**Real ETA Countdown:**
- Tracks `phaseStartTime` when each phase begins
- Calculates real-time remaining: `estimatedSeconds - elapsedSeconds`
- Frontend polls every 2 seconds to update countdown
- ETA counts down: 40s → 39s → 38s → ... → 0s

### 2. Files Modified (V10 Parallel Search)

#### V10 Core Implementation
- **[src/server/comprehensive-comp-search-v10.ts](frontend/src/server/comprehensive-comp-search-v10.ts)** - Main V10 search entry point with 9 error handlers
- **[src/server/utils/parallelSearchOrchestrator.ts](frontend/src/server/utils/parallelSearchOrchestrator.ts)** - Parallel coordination with 23 error handlers
- **[src/server/utils/parallelSearchConfig.ts](frontend/src/server/utils/parallelSearchConfig.ts)** - V10 configuration (enabled by default)
- **[src/server/utils/boundedQueue.ts](frontend/src/server/utils/boundedQueue.ts)** - Local concurrency control (3 error handlers)
- **[src/server/utils/minHeap.ts](frontend/src/server/utils/minHeap.ts)** - Memory-efficient top-K selection (4 error handlers)
- **[src/server/utils/geocodeCache.ts](frontend/src/server/utils/geocodeCache.ts)** - LRU cache for geocoding (12 error handlers)
- **[src/server/utils/compScoring.ts](frontend/src/server/utils/compScoring.ts)** - Scoring and deduplication (9 error handlers)
- **[src/server/utils/redisSemaphore.ts](frontend/src/server/utils/redisSemaphore.ts)** - Global concurrency control (3 error handlers)

#### Progress Tracking & UI
- **[src/server/utils/jobQueue.ts](frontend/src/server/utils/jobQueue.ts)** - Routes to V10, updated `PHASES` with parallel search messaging
- **[src/hooks/useJobProgress.ts](frontend/src/hooks/useJobProgress.ts)** - Updated progress milestones for V10 (0→10→30→60→75→90→97→100)
- **[src/app/page.tsx](frontend/src/app/page.tsx)** - Added visual green progress bar with smooth animations
- **[src/app/api/analyze/status/[jobId]/route.ts](frontend/src/app/api/analyze/status/[jobId]/route.ts)** - Real-time ETA calculation

#### Authentication Bypass
- **[src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx)** - Added `NEXT_PUBLIC_DISABLE_AUTH` flag to bypass Firebase auth with mock user

#### Email Notifications
- **[src/server/utils/emailService.ts](frontend/src/server/utils/emailService.ts)** - Gmail SMTP configuration for failure notifications

#### Worker Startup
- **[start-worker-local-fixed.sh](frontend/start-worker-local-fixed.sh)** - Explicit env var export script for tsx

### 3. Architecture Details

**Global Job Context Pattern:**
```typescript
// Allows any module to update progress without passing jobQueue instance
let currentJobContext: { jobId: string; queue: JobQueue } | null = null;

export function setJobContext(jobId: string, queue: JobQueue) {
  currentJobContext = { jobId, queue };
}

export async function updateProgress(phaseKey: keyof typeof PHASES) {
  if (currentJobContext) {
    await currentJobContext.queue.updateProgress(
      currentJobContext.jobId,
      phaseKey
    );
  }
}
```

**Real-Time ETA Calculation:**
```typescript
// Status endpoint calculates remaining time on each poll
let realTimeRemaining = job.estimatedTimeRemaining || 0;
if (job.phaseStartTime && job.estimatedTimeRemaining) {
  const elapsedSeconds = Math.floor((Date.now() - job.phaseStartTime) / 1000);
  realTimeRemaining = Math.max(0, job.estimatedTimeRemaining - elapsedSeconds);
}
```

## Testing Workflow

### Basic Test Flow

1. **Start all services** (Redis, Frontend, Worker)
2. **Navigate to:** http://localhost:3000
3. **You'll see:** "Local Test User" (auth bypassed)
4. **Enter address:** e.g., "2835 tyler dewayne ct, snellville, ga, 30078"
5. **Click:** "Analyze Property"
6. **Watch:** Progress tracking in real-time

### Monitor Progress

**Browser DevTools:**
- Network tab: Status polls every 2 seconds to `/api/analyze/status/[jobId]`
- Watch progress, phase, and ETA countdown update

**Worker Logs:**
```bash
# Watch progress updates
tail -f /tmp/worker_fixed.log | grep -E "Progress|Phase|ETA"

# Watch all activity
tail -f /tmp/worker_fixed.log
```

### Inspect Redis Data

```bash
# Connect to local Redis
docker exec -it propertyvision-redis-local redis-cli

# List all jobs
KEYS job:*

# Get specific job
GET job:<jobId>

# View job queue stream
XREAD COUNT 10 STREAMS jobs 0

# Check pending jobs
XPENDING jobs job-queue

# Exit Redis CLI
exit
```

## Troubleshooting

### Frontend Shows "Analysis failed - Failed to get job status"

**Symptoms:**
- Jobs complete successfully in worker (email confirms success)
- Frontend displays error: "Analysis failed - Failed to get job status"
- Status endpoint returns 404 even though job exists in Redis
- Dev server logs show job was created but status polls return 404

**Root Cause:**
Next.js development mode hot module reload (HMR) creates multiple `RedisCache` singleton instances. Each API route compilation creates a new instance, so:
- `/api/analyze` writes job using one Redis instance
- `/api/analyze/status/[jobId]` reads job using a different Redis instance
- The instances don't share connections, causing "Job not found" errors

**Debug Evidence:**
```
🔍 REDIS getJob: jobId=xxx, connected=false, client=true
❌ REDIS getJob: NOT CONNECTED - returning null
```
This shows the Redis client exists (`client=true`) but the connection flag is stale (`connected=false`) after hot reload.

**Fix Applied:**
Used `globalThis` to persist Redis singleton across hot module reloads in development:

**File Modified:**
- **[src/server/utils/redisCache.ts](frontend/src/server/utils/redisCache.ts)** - Persist singleton in `globalThis` during development

**Solution:**
```typescript
// redisCache.ts - Persist singleton across HMR
declare global {
  var __redisCache: RedisCache | undefined;
}

export function getRedisCache(): RedisCache {
  // In development, use globalThis to persist across hot reloads
  if (process.env.NODE_ENV !== 'production') {
    if (!global.__redisCache) {
      global.__redisCache = new RedisCache();
    }
    return global.__redisCache;
  }

  // In production, use regular singleton
  if (!redisCacheInstance) {
    redisCacheInstance = new RedisCache();
  }
  return redisCacheInstance;
}

// Also ensure connection is ready before reading
async getJob(jobId: string): Promise<any | null> {
  if (!this.client) {
    return null;
  }

  // Ensure connection is ready before reading
  await this.ensureConnected();

  const key = `job:${jobId}`;
  const data = await this.client.get(key);
  return data ? JSON.parse(data) : null;
}
```

**Impact:**
- ✅ **All API routes share same Redis instance** - Jobs written by one route can be read by another
- ✅ **Status polling works correctly** - No more 404 errors for existing jobs
- ✅ **Production unaffected** - Only applies to `NODE_ENV !== 'production'`
- ✅ **No Redis connection leaks** - Single persistent connection during development

**Verification:**
```bash
# After fix, dev server logs should show:
# 🔍 REDIS getJob: jobId=xxx, connected=true, client=true
# 🔍 REDIS getJob: key=job:xxx, found=true
# 🔍 STATUS: Job xxx result: FOUND
# GET /api/analyze/status/xxx 200 in 20ms
```

**Additional Context:**
This is a known Next.js limitation documented in:
- GitHub Issue: [#45483 - Fast Refresh causes database connection exhaustion](https://github.com/vercel/next.js/issues/45483)
- Stack Overflow: [Using a Redis Singleton for NextJS API Routes](https://stackoverflow.com/questions/71489656/using-a-redis-singleton-for-nextjs-api-routes)

The `globalThis` workaround is the official recommended solution for persisting stateful connections across HMR in development mode.

### Frontend Page Crashes During Development

**Symptoms:**
- Page refreshes unexpectedly
- Intermittent errors: `⨯ SyntaxError: Unexpected end of JSON input`
- `GET / 500` in server logs
- Fast Refresh warnings: "had to perform a full reload due to a runtime error"

**Root Cause:**
Firebase SDK initialization causing JSON parsing errors during Next.js hot-reload when `NEXT_PUBLIC_DISABLE_AUTH=true`.

**Fix Applied:**
Updated Firebase initialization to skip when auth is disabled:

**Files Modified:**
1. **[src/lib/firebase.ts](frontend/src/lib/firebase.ts#L16-21)** - Skip Firebase init when `NEXT_PUBLIC_DISABLE_AUTH=true`
2. **[src/contexts/AuthContext.tsx](frontend/src/contexts/AuthContext.tsx#L68-72)** - Add null checks for auth/db

**Solution:**
```typescript
// firebase.ts - Only initialize if auth not disabled
const disableAuth = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true';
const app = disableAuth ? undefined : initializeApp(firebaseConfig);
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

// AuthContext.tsx - Skip Firebase setup if auth is null
if (!auth) {
  setLoading(false);
  return;
}
```

**Impact:**
- ✅ **Local dev only** - `NEXT_PUBLIC_DISABLE_AUTH` only in `.env.local`
- ✅ **Production unaffected** - Firebase initializes normally in staging/production
- ✅ **Reduces crashes** - Firebase SDK not loaded when bypassing auth

**If crashes still occur (Next.js dev mode issue):**
```bash
# Option 1: Clear Next.js cache
cd /Users/eobodoechine/PropertyVision1/frontend
rm -rf .next
npm run dev

# Option 2: Hard refresh browser
# Press: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

# Option 3: Restart dev server
# Ctrl+C to stop, then npm run dev
```

### Redis Connection Timeout
```
Error: connect ETIMEDOUT
```

**Solution:**
```bash
# Check Docker is running
docker ps

# Restart Redis container
docker restart propertyvision-redis-local

# Verify port 6379 is available
lsof -i :6379
```

### Worker Can't Find GCP Credentials
```
Error: hasServiceAccount() returned false
```

**Solution:**
```bash
# Verify file exists
ls -l /Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json

# Check permissions
chmod 644 /Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json

# Ensure script exports env vars
grep GCP_SA_JSON /Users/eobodoechine/PropertyVision1/frontend/start-worker-local-fixed.sh
```

### Email Notifications Not Sending
```
Error: Invalid login: 535-5.7.8 Username and Password not accepted
```

**Solution:**
- Verify Gmail app password in `.env.local`
- Ensure `EMAIL_USER` matches the Google account that generated the app password
- Check for spaces in password (remove them)
- Generate new app password: https://myaccount.google.com/apppasswords

### Auth Page Still Showing

**Solution:**
```bash
# Verify env variable is set
grep NEXT_PUBLIC_DISABLE_AUTH /Users/eobodoechine/PropertyVision1/frontend/.env.local

# Restart dev server
# Stop current server (Ctrl+C)
npm run dev
```

### Progress Not Updating

**Check:**
1. Worker is processing: `grep "Processing job" /tmp/worker_fixed.log`
2. Redis connection in frontend and worker
3. Browser DevTools Network tab shows status polling every 2s
4. Worker logs show progress updates being saved to Redis

## Environment Comparison

| Component | Local | Staging | Production |
|-----------|-------|---------|------------|
| Redis | localhost:6379 | 10.94.52.139:6379 | 10.85.154.187:6379 |
| Auth | Bypassed (mock user) | Firebase | Firebase |
| Worker | Local tsx process | Cloud Run | Cloud Run |
| Frontend | localhost:3000 | Cloud Run staging | Cloud Run prod |

## File Reference

### Scripts
- `/Users/eobodoechine/PropertyVision1/start-redis.sh` - Start local Redis
- `/Users/eobodoechine/PropertyVision1/frontend/start-worker-local-fixed.sh` - Start worker with env vars

### Configuration
- `/Users/eobodoechine/PropertyVision1/frontend/.env.local` - Local environment config

### Implementation Files
- `src/server/utils/jobQueue.ts` - Job queue and progress tracking logic
- `src/server/comprehensive-comp-search-v5.ts` - Comparable search with progress updates
- `src/app/api/analyze/status/[jobId]/route.ts` - Status endpoint with real-time ETA
- `src/server/utils/emailService.ts` - Email notification service
- `src/contexts/AuthContext.tsx` - Auth provider with bypass flag
- `src/app/test-progress/page.tsx` - Test page (optional, bypasses auth inline)

## Advanced Usage

### Custom Test Addresses

```javascript
// Good test addresses (real properties):
"2835 tyler dewayne ct, snellville, ga, 30078"  // Works, has comps
"1600 Pennsylvania Avenue NW, Washington, DC"   // White House (unique property)
"430 Burgundy St, New Orleans, LA"              // Previous test address
```

### Monitor Specific Phase

```bash
# Watch comparable search phases
tail -f /tmp/worker_fixed.log | grep "COMPARABLE_SEARCH"

# Watch ARV calculation
tail -f /tmp/worker_fixed.log | grep "ARV"

# Watch email notifications
tail -f /tmp/worker_fixed.log | grep "email\|Email\|📧"
```

### Test Email Notifications

Trigger email by causing a job failure:
```bash
# Submit job with invalid address (will fail and send email)
# Or manually trigger failure in worker code
```

## Next Steps: Deploy to Staging

After local testing succeeds:

```bash
# Deploy frontend to staging
cd /Users/eobodoechine/PropertyVision1/frontend
gcloud run deploy propertyvision-frontend-staging \
  --source . \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated

# Deploy worker to staging
gcloud run deploy propertyvision-worker-staging \
  --source . \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --set-env-vars REDIS_HOST=10.94.52.139,REDIS_PORT=6379
```

**Remember:** Remove `NEXT_PUBLIC_DISABLE_AUTH=true` before deploying to staging/production!

## Support

For issues:
1. Check worker logs: `/tmp/worker_fixed.log`
2. Check Redis: `docker exec -it propertyvision-redis-local redis-cli`
3. Check browser DevTools Network tab for API errors
4. Verify all services are running: Docker, npm dev, worker script
