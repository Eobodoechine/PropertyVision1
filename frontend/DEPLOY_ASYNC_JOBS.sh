#!/bin/bash

# Async Job Queue Deployment Script
# This script completes the async job implementation and deploys it

set -e

echo "🚀 Starting Async Job Queue Deployment"
echo "======================================"

# Step 1: Backup current route.ts
echo "📦 Step 1: Backing up current analyze route..."
cp src/app/api/analyze/route.ts src/app/api/analyze/route.backup.ts
echo "✅ Backup created: route.backup.ts"

# Step 2: Replace with new async version
echo "🔄 Step 2: Installing new async analyze route..."
mv src/app/api/analyze/route.new.ts src/app/api/analyze/route.ts
echo "✅ New route installed"

# Step 3: Create status endpoint directory
echo "📁 Step 3: Creating status endpoint..."
mkdir -p src/app/api/analyze/status/\[jobId\]

# Step 4: Create status endpoint
cat > src/app/api/analyze/status/\[jobId\]/route.ts << 'EOF'
import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '../../../../../../server/utils/jobQueue';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobQueue = getJobQueue();
    const job = await jobQueue.getJobStatus(params.jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: params.jobId,
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      result: job.result,
      error: job.error
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to get job status', details: error.message },
      { status: 500 }
    );
  }
}
EOF

echo "✅ Status endpoint created"

# Step 5: Create worker starter
echo "🔧 Step 5: Creating worker starter..."
cat > src/server/worker.ts << 'EOF'
import { getJobQueue } from './utils/jobQueue';

async function startWorker() {
  if (process.env.RUN_WORKER !== 'true') {
    console.log('⏭️  Worker disabled (RUN_WORKER != true)');
    return;
  }

  console.log('🚀 Starting job worker...');
  const jobQueue = getJobQueue();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('📪 SIGTERM received, stopping worker...');
    await jobQueue.stop();
    process.exit(0);
  });

  await jobQueue.processJobs();
}

startWorker().catch((error) => {
  console.error('❌ Worker failed:', error);
  process.exit(1);
});
EOF

echo "✅ Worker starter created"

# Step 6: Update package.json
echo "📝 Step 6: Adding worker script to package.json..."
# This would need to be done manually or with jq

echo ""
echo "⚠️  MANUAL STEP REQUIRED:"
echo "Add to package.json scripts:"
echo '  "worker": "tsx src/server/worker.ts"'
echo ""

# Step 7: Update frontend (create instruction file)
cat > FRONTEND_UPDATE_INSTRUCTIONS.md << 'EOF'
# Frontend Polling Implementation

Update `src/app/page.tsx` - replace the `analyzeProperty` function:

```typescript
async function analyzeProperty(address: string): Promise<PropertyAnalysisResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min timeout

  try {
    // Start async job
    const response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Failed to start analysis');
    }

    const { jobId } = await response.json();

    // Poll for results with backoff
    let pollInterval = 3000; // Start at 3 seconds
    return await new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/analyze/status/${jobId}`);

          if (!statusRes.ok) {
            reject(new Error('Failed to get job status'));
            return;
          }

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
    });
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
```
EOF

echo "✅ Frontend instructions created"

echo ""
echo "======================================"
echo "✅ Files Created Successfully!"
echo "======================================"
echo ""
echo "Created files:"
echo "  - src/app/api/analyze/route.ts (async version)"
echo "  - src/app/api/analyze/status/[jobId]/route.ts"
echo "  - src/server/worker.ts"
echo "  - FRONTEND_UPDATE_INSTRUCTIONS.md"
echo ""
echo "Next steps:"
echo "1. Review FRONTEND_UPDATE_INSTRUCTIONS.md and update page.tsx"
echo "2. Add worker script to package.json"
echo "3. Test locally: npm run dev (web) + npm run worker (worker)"
echo "4. Deploy to production (see deployment commands below)"
echo ""
echo "======================================"
echo "DEPLOYMENT COMMANDS"
echo "======================================"
echo ""
echo "# Deploy frontend (worker disabled):"
echo "gcloud run deploy propertyvision-frontend \\"
echo "  --source . \\"
echo "  --region us-central1 \\"
echo "  --allow-unauthenticated \\"
echo "  --vpc-connector redis-connector \\"
echo "  --vpc-egress private-ranges-only \\"
echo "  --set-env-vars \"REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json,RUN_WORKER=false\" \\"
echo "  --timeout 60"
echo ""
echo "# Deploy worker service:"
echo "gcloud run deploy propertyvision-worker \\"
echo "  --source . \\"
echo "  --region us-central1 \\"
echo "  --no-allow-unauthenticated \\"
echo "  --vpc-connector redis-connector \\"
echo "  --vpc-egress private-ranges-only \\"
echo "  --set-env-vars \"REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json,RUN_WORKER=true\" \\"
echo "  --cpu-always-allocated \\"
echo "  --min-instances 1 \\"
echo "  --max-instances 3 \\"
echo "  --concurrency 1 \\"
echo "  --timeout 3600 \\"
echo "  --command npm \\"
echo "  --args run,worker"
echo ""
