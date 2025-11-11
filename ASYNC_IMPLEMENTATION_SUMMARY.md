# Async Job Queue - Implementation Complete (Files 1-2)

## ✅ Completed Files

### 1. Redis Streams Methods (`src/server/utils/redisCache.ts`)
**Status:** ✅ ADDED

Added methods:
- `xadd()` - Add to stream with MAXLEN trim
- `xgroupCreate()` - Create consumer group (idempotent)
- `xreadGroup()` - Read from stream
- `xack()` - Acknowledge message
- `xautoclaim()` - Reclaim stuck jobs

### 2. Job Queue Worker (`src/server/utils/jobQueue.ts`)
**Status:** ✅ CREATED

Features:
- Enqueue jobs to Redis Stream
- Worker loop with XREADGROUP
- Heartbeat mechanism (every 10s)
- XAUTOCLAIM reaper (every 15s, idle >30s)
- Retry logic (max 3 attempts)
- Dead letter queue (DLQ)
- Graceful shutdown

## 🔄 Remaining Files (Next Steps)

### 3. Modify Analyze Endpoint
**File:** `src/app/api/analyze/route.ts`

**Changes Needed:**
```typescript
import { getJobQueue } from '../../../server/utils/jobQueue';
import { createHash } from 'crypto';

const jobQueue = getJobQueue();

export async function POST(request: NextRequest) {
  const { address } = await request.json();

  // Idempotency check
  const idempotencyKey = createHash('sha256').update(address.toLowerCase()).digest('hex');
  const existing = await redis.get(`idempotency:${idempotencyKey}`);
  if (existing) {
    return NextResponse.json({ jobId: existing, status: 'queued' });
  }

  // Create async job
  const jobId = await jobQueue.enqueueJob(address);

  // Store idempotency mapping
  await redis.setJob(`idempotency:${idempotencyKey}`, jobId, 3600);

  return NextResponse.json({ jobId, status: 'queued' });
}
```

### 4. Create Status Endpoint
**File:** `src/app/api/analyze/status/[jobId]/route.ts` (NEW)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '../../../../../server/utils/jobQueue';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const jobQueue = getJobQueue();
  const job = await jobQueue.getJobStatus(params.jobId);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    jobId: params.jobId,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    result: job.result,
    error: job.error
  });
}
```

### 5. Update Frontend
**File:** `src/app/page.tsx`

**Modify `analyzeProperty` function:**
```typescript
async function analyzeProperty(address: string): Promise<PropertyAnalysisResponse> {
  // Start job
  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });

  const { jobId } = await response.json();

  // Poll for results with backoff
  let pollInterval = 3000;
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const statusRes = await fetch(`${API_BASE_URL}/api/analyze/status/${jobId}`);
        const status = await statusRes.json();

        if (status.status === 'completed') {
          resolve(status.result);
        } else if (status.status === 'failed') {
          reject(new Error(status.error || 'Analysis failed'));
        } else {
          // Update progress
          setProgress(status.progress || 0);

          // Backoff: 3s → 5s → 8s → 13s (cap at 15s)
          pollInterval = Math.min(pollInterval + 2000, 15000);
          setTimeout(poll, pollInterval);
        }
      } catch (error) {
        reject(error);
      }
    };

    poll();

    // Timeout after 10 minutes
    setTimeout(() => reject(new Error('Timeout')), 600000);
  });
}
```

### 6. Start Worker on Boot
**File:** `src/server/worker.ts` (NEW)

```typescript
import { getJobQueue } from './utils/jobQueue';

async function startWorker() {
  if (process.env.RUN_WORKER !== 'true') {
    console.log('⏭️  Worker disabled (RUN_WORKER != true)');
    return;
  }

  console.log('🚀 Starting job worker...');
  const jobQueue = getJobQueue();
  await jobQueue.processJobs();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📪 SIGTERM received, stopping worker...');
  const jobQueue = getJobQueue();
  await jobQueue.stop();
  process.exit(0);
});

startWorker().catch(console.error);
```

**Add to `package.json`:**
```json
{
  "scripts": {
    "worker": "tsx src/server/worker.ts"
  }
}
```

## Deployment

### Step 1: Deploy Frontend (Worker Disabled)
```bash
gcloud run deploy propertyvision-frontend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --service-account pv-worker-staging-sa@agile-device-472202-i8.iam.gserviceaccount.com \
  --set-env-vars "REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_CLOUD_PROJECT=agile-device-472202-i8,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,RUN_WORKER=false" \
  --timeout 60
```

### Step 2: Deploy Worker Service
```bash
gcloud run deploy propertyvision-worker \
  --source . \
  --region us-central1 \
  --no-allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --service-account pv-worker-staging-sa@agile-device-472202-i8.iam.gserviceaccount.com \
  --set-env-vars "REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_CLOUD_PROJECT=agile-device-472202-i8,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,RUN_WORKER=true" \
  --cpu-always-allocated \
  --min-instances 1 \
  --max-instances 3 \
  --concurrency 1 \
  --timeout 3600 \
  --command npm \
  --args run,worker
```

## Testing

```bash
# Test async job creation
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"3690 Herren Dr SW, Smyrna, GA 30082"}'

# Response: {"jobId":"abc-123","status":"queued"}

# Poll status
curl https://enohomebuyers.com/api/analyze/status/abc-123

# Eventually: {"status":"completed","result":{...}}
```

## Summary

✅ **Completed:**
1. Redis Streams methods
2. Job queue with worker loop

⏳ **Remaining:**
3. Modify analyze endpoint
4. Create status endpoint
5. Update frontend polling
6. Create worker starter script
7. Deploy both services

**Total time remaining:** ~1 hour for remaining files + testing + deployment

Would you like me to continue creating the remaining 5 files?
