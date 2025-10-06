# Fix for Concurrent Job Execution Issue

## Problem Summary

Job `efd459c1` for "5860 Sheldon Ct Atlanta, GA 30349" was processed **4 times concurrently**, resulting in:
- Multiple ARV values ($191,050 and $337,330)
- "ARV unavailable" error on frontend
- Wasted compute resources

### Root Cause

1. **No concurrent execution prevention** - Same job could be processed by multiple workers simultaneously
2. **No attempt limit in XAUTOCLAIM** - Reaper kept reclaiming jobs indefinitely
3. **Silent failures** - No logging for Redis operations, making debugging impossible
4. **Missing ownership tracking** - No way to know which worker was processing a job

### Timeline of Issue

```
23:29:01 - Run 1 starts
23:29:33 - Run 2 starts (XAUTOCLAIM reclaimed) - Run 1 still running
23:30:03 - Run 3 starts (XAUTOCLAIM reclaimed) - Runs 1,2 still running
23:30:33 - Run 4 starts (XAUTOCLAIM reclaimed) - Runs 1,2,3 still running
23:34:56 - One run completes: ARV $191,050
23:36:11 - Another run completes: ARV $337,330
Result: Multiple conflicting ARVs, none saved properly
```

## Fixes Applied

### Fix 1: Prevent Concurrent Execution

**File:** `frontend/src/server/utils/jobQueue.ts`

**Change:** Added `processingBy` field and ownership check

```typescript
interface JobData {
  // ... existing fields
  processingBy?: string; // Track which worker is processing this job
}

private async processJob(jobId: string, address: string, messageId: string): Promise<void> {
  // Check if job is already being processed by another worker
  const existingJob = await this.getJobStatus(jobId);
  if (existingJob && existingJob.status === 'processing' && existingJob.processingBy && existingJob.processingBy !== CONSUMER) {
    const timeSinceHeartbeat = Date.now() - (existingJob.lastHeartbeat || 0);
    if (timeSinceHeartbeat < 60000) { // If heartbeat within last 60 seconds
      console.warn(`⚠️  Job ${jobId} is already being processed by ${existingJob.processingBy}, skipping`);
      await this.redis.xack(STREAM, GROUP, messageId); // Acknowledge to prevent re-processing
      return;
    }
  }

  // Claim ownership
  await this.updateJob(jobId, {
    status: 'processing',
    processingBy: CONSUMER // Mark as being processed by this worker
  });
}
```

**What this does:**
- Before processing, checks if another worker is already handling the job
- If job is being processed AND heartbeat is fresh (<60s), skip and acknowledge
- If heartbeat is stale (>60s), assume worker died and take over
- Claims ownership by setting `processingBy` to current worker ID

### Fix 2: Limit XAUTOCLAIM Attempts

**File:** `frontend/src/server/utils/jobQueue.ts`

**Change:** Check attempt count before reprocessing reclaimed jobs

```typescript
// In XAUTOCLAIM reaper
if (jobData && jobData.jobId) {
  // Check if job has exceeded max attempts
  const job = await this.getJobStatus(jobData.jobId);
  if (job && (job.attempts || 0) >= MAX_ATTEMPTS) {
    console.warn(`⚠️  Job ${jobData.jobId} exceeded max attempts (${job.attempts}), moving to DLQ`);
    await this.handleJobFailure(jobData.jobId, new Error('Max reclaim attempts exceeded'), messageId);
    continue;
  }

  await this.processJob(jobData.jobId, jobData.address, messageId);
}
```

**What this does:**
- Before reprocessing a reclaimed job, checks attempt count
- If attempts >= MAX_ATTEMPTS (3), moves to Dead Letter Queue
- Prevents infinite reclaim loops

### Fix 3: Add Comprehensive Logging

**Files:** `frontend/src/server/utils/jobQueue.ts` and `frontend/src/server/utils/redisCache.ts`

**Changes:**

#### A. updateJob logging
```typescript
private async updateJob(jobId: string, updates: Partial<JobData>): Promise<void> {
  console.log(`💾 Updating job ${jobId} with:`, JSON.stringify(updates).substring(0, 200));
  const job = await this.getJobStatus(jobId);
  if (job) {
    const updated = { ...job, ...updates, lastHeartbeat: Date.now() };
    await this.redis.setJob(jobId, updated, JOB_TTL);
    console.log(`✅ Job ${jobId} saved to Redis: status=${updated.status}, progress=${updated.progress}`);
  } else {
    console.error(`❌ CRITICAL: Job ${jobId} not found in Redis during updateJob! Creating new entry.`);
    const newJob = { jobId, ...updates, lastHeartbeat: Date.now(), createdAt: updates.createdAt || Date.now() };
    await this.redis.setJob(jobId, newJob, JOB_TTL);
    console.log(`✅ Job ${jobId} created in Redis: status=${newJob.status}, progress=${newJob.progress}`);
  }
}
```

#### B. setJob logging
```typescript
async setJob(jobId: string, jobData: any, ttlSeconds: number = 3600): Promise<void> {
  if (!this.client || !this.isConnected) {
    console.error(`❌ CRITICAL: Redis not connected, job ${jobId} will NOT be persisted!`);
    return;
  }

  try {
    const key = `job:${jobId}`;
    const dataStr = JSON.stringify(jobData);
    await this.client.set(key, dataStr, 'EX', ttlSeconds);
    console.log(`📝 Redis SET job:${jobId} (${dataStr.length} bytes, TTL=${ttlSeconds}s)`);
  } catch (error) {
    console.error(`❌ Redis SET JOB error for ${jobId}:`, error);
    throw error; // Re-throw so caller knows it failed
  }
}
```

#### C. xack logging
```typescript
async xack(stream: string, group: string, id: string): Promise<void> {
  if (!this.client || !this.isConnected) {
    console.error(`❌ CRITICAL: Cannot XACK - Redis not connected! Stream: ${stream}, ID: ${id}`);
    return;
  }

  try {
    const result = await this.client.xack(stream, group, id);
    console.log(`✅ XACK successful: stream=${stream}, id=${id}, result=${result}`);
  } catch (error) {
    console.error(`❌ Redis XACK error for ${id}:`, error);
    throw error; // Re-throw so caller knows it failed
  }
}
```

**What this does:**
- Logs every attempt to update a job
- Logs every Redis SET operation with data size
- Logs every XACK with success/failure status
- Makes Redis disconnection visible
- Creates job if it doesn't exist (instead of silent fail)
- Re-throws errors instead of swallowing them

## Expected Behavior After Fix

### Before Fix:
```
23:29:01 - Job starts
23:29:33 - XAUTOCLAIM reclaims → 2 concurrent runs
23:30:03 - XAUTOCLAIM reclaims → 3 concurrent runs
23:30:33 - XAUTOCLAIM reclaims → 4 concurrent runs
Result: Multiple ARVs, none saved
```

### After Fix:
```
23:29:01 - Job starts, claims ownership (processingBy=worker-1)
23:29:33 - XAUTOCLAIM reclaims
          → Checks ownership
          → Sees worker-1 still processing (heartbeat fresh)
          → Skips and acknowledges
23:30:03 - XAUTOCLAIM reclaims
          → Sees worker-1 still processing
          → Skips and acknowledges
23:34:56 - Job completes, ARV $191,050
          → Saved to Redis (with logging)
          → XACK succeeds (with logging)
Result: Single ARV, properly saved
```

## Testing Checklist

After deployment, verify:

- [ ] Only ONE "Processing job" log per job
- [ ] "⚠️ Job already being processed" logs when reaper tries to reclaim
- [ ] "💾 Updating job" logs before each Redis save
- [ ] "📝 Redis SET job:" logs for successful saves
- [ ] "✅ XACK successful" logs when jobs are acknowledged
- [ ] Jobs complete with single ARV value
- [ ] Frontend receives results (no "ARV unavailable")
- [ ] No jobs exceed MAX_ATTEMPTS (3)
- [ ] Jobs that fail 3 times move to DLQ

## Deployment

```bash
cd /Users/eobodoechine/PropertyVision1/frontend
gcloud builds submit --tag gcr.io/agile-device-472202-i8/propertyvision-worker:v5 --project=agile-device-472202-i8

gcloud run deploy propertyvision-worker \
  --image gcr.io/agile-device-472202-i8/propertyvision-worker:v5 \
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
```

## Summary

Three critical fixes applied:
1. **Ownership tracking** - Prevents concurrent execution of same job
2. **Attempt limiting** - Prevents infinite XAUTOCLAIM loops
3. **Comprehensive logging** - Makes all operations visible for debugging

These changes will eliminate the concurrent execution issue and make the system debuggable when issues occur.
