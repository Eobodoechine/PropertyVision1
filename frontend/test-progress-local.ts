/**
 * Local Progress Tracking Test Script
 *
 * Tests the UX progress tracking system locally using staging Redis
 *
 * Usage:
 *   npx tsx test-progress-local.ts
 */

import { ComprehensiveCompSearchV5 } from './src/server/comprehensive-comp-search-v5';
import { getJobQueue } from './src/server/utils/jobQueue';

async function testProgressTracking() {
  console.log('🧪 Starting Local Progress Tracking Test\n');

  // Test address
  const testAddress = '430 Burgundy Drive, Madison, AL 35758';

  try {
    // Create job queue instance (uses staging Redis)
    const jobQueue = getJobQueue();
    console.log('✅ Connected to job queue\n');

    // Add job to queue
    const jobId = await jobQueue.addJob({
      address: testAddress,
      email: 'test@example.com'
    });
    console.log(`📝 Created job: ${jobId}\n`);

    // Poll job status in background
    const pollInterval = setInterval(async () => {
      const status = await jobQueue.getJobStatus(jobId);
      if (status) {
        console.log(`📊 [${new Date().toLocaleTimeString()}] Progress: ${status.progress}% | Phase: ${status.phase} | ${status.phaseMessage || ''} | ETA: ${status.estimatedTimeRemaining}s`);

        if (status.status === 'completed') {
          console.log('\n✅ Job completed successfully!');
          console.log('Result:', JSON.stringify(status.result, null, 2));
          clearInterval(pollInterval);
          process.exit(0);
        } else if (status.status === 'failed') {
          console.log('\n❌ Job failed:', status.error);
          clearInterval(pollInterval);
          process.exit(1);
        }
      }
    }, 2000); // Poll every 2 seconds

    // Start processing (this will run the actual analysis)
    console.log('🚀 Starting analysis...\n');
    await jobQueue.processJob(jobId);

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testProgressTracking();
