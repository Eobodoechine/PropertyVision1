/**
 * Local Deduplication Test Script
 *
 * Tests the simplified deduplication system locally using the job queue
 *
 * Usage:
 *   npx tsx test-dedup-local.ts
 */

import { getJobQueue } from './src/server/utils/jobQueue';

async function testDeduplication() {
  console.log('🧪 Testing Simplified Deduplication Locally\n');

  // Use address from daed1273 that had duplicates
  const testAddress = '2267 Delowe Dr, East Point, GA 30344';

  try {
    // Create job queue instance (uses staging Redis)
    const jobQueue = getJobQueue();
    console.log('✅ Connected to job queue\n');

    // Add job to queue
    const jobId = await jobQueue.enqueueJob(
      testAddress,
      undefined,
      'test@example.com'
    );
    console.log(`📝 Created job: ${jobId}`);
    console.log(`📍 Testing address: ${testAddress}\n`);
    console.log('🔍 Watch worker logs for deduplication results...\n');

    // Poll job status in background
    const pollInterval = setInterval(async () => {
      const status = await jobQueue.getJobStatus(jobId);
      if (status) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`📊 [${timestamp}] Progress: ${status.progress}% | Phase: ${status.phase} | ${status.phaseMessage || ''} | ETA: ${status.estimatedTimeRemaining}s`);

        if (status.status === 'completed') {
          console.log('\n✅ Job completed successfully!');
          console.log('\n📋 Final Result:');
          console.log(`   Subject: ${status.result?.subject?.address || 'N/A'}`);
          console.log(`   ARV: $${status.result?.arv?.estimate?.toLocaleString() || 'N/A'}`);
          console.log(`   Qualified Comps: ${status.result?.qualified_comps?.length || 0}`);
          console.log('\n💡 Check worker logs above for deduplication details');
          clearInterval(pollInterval);
          process.exit(0);
        } else if (status.status === 'failed') {
          console.log('\n❌ Job failed:', status.error);
          console.log('\n💡 Check worker logs above for error details');
          clearInterval(pollInterval);
          process.exit(1);
        }
      }
    }, 2000); // Poll every 2 seconds

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testDeduplication();
