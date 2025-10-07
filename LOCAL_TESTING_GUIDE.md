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

### 1. Progress Tracking System

**10-Phase Progress Flow:**

| Phase | Progress | Message | Est. Time |
|-------|----------|---------|-----------|
| QUEUED | 0% | Queued for processing | 5s |
| SUBJECT_PROPERTY | 10% | Fetching property details | 40s |
| COMPARABLE_SEARCH_L1 | 25% | Searching 1-mile radius | 90s |
| COMPARABLE_SEARCH_L2 | 40% | Expanding to 2-mile radius | 60s |
| COMPARABLE_SEARCH_L3 | 55% | Expanding to 3-mile radius | 60s |
| COMPARABLE_SEARCH_L4 | 70% | Expanding to 5-mile radius | 60s |
| DEDUPLICATION | 85% | Removing duplicate properties | 15s |
| ARV_CALCULATION | 92% | Calculating ARV | 20s |
| FINALIZING | 97% | Preparing analysis report | 2s |
| COMPLETED | 100% | Complete | - |

**Real ETA Countdown:**
- Tracks `phaseStartTime` when each phase begins
- Calculates real-time remaining: `estimatedSeconds - elapsedSeconds`
- Frontend polls every 2 seconds to update countdown
- ETA counts down: 40s → 39s → 38s → ... → 0s

### 2. Files Modified

#### Progress Tracking Core
- **[src/server/utils/jobQueue.ts](frontend/src/server/utils/jobQueue.ts)** - Job queue with `PHASES` config and `phaseStartTime` tracking
- **[src/app/api/analyze/status/[jobId]/route.ts](frontend/src/app/api/analyze/status/[jobId]/route.ts)** - Real-time ETA calculation in status endpoint
- **[src/server/comprehensive-comp-search-v5.ts](frontend/src/server/comprehensive-comp-search-v5.ts)** - Global job context for progress updates across modules

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
