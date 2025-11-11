// Test script to verify race condition fixes
// This script rapidly submits 5 jobs with the same address to test:
// 1. AsyncLocalStorage prevents log contamination
// 2. Distributed locks prevent concurrent processing
// 3. MIN_IDLE_MS prevents premature reclaim

import { getJobQueue } from './src/server/utils/jobQueue';

const TEST_ADDRESS = '2255 Meadowvale Dr NE, Atlanta, GA 30345';
const NUM_JOBS = 5;
const SUBMIT_DELAY_MS = 100; // Small delay between submissions to create race condition

async function testRaceCondition() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧪 RACE CONDITION TEST SCRIPT');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('PURPOSE:');
  console.log('  Test that our fixes prevent the race condition that occurred in job 11e48fb1');
  console.log('');
  console.log('WHAT WE ARE TESTING:');
  console.log('  1. AsyncLocalStorage: Each job logs with correct bracket ID (no contamination)');
  console.log('  2. Distributed Locks: Only ONE worker processes each job at a time');
  console.log('  3. MIN_IDLE_MS (28s): Reaper does not prematurely reclaim active jobs');
  console.log('');
  console.log('TEST PARAMETERS:');
  console.log(`  Test Address: ${TEST_ADDRESS}`);
  console.log(`  Number of jobs: ${NUM_JOBS}`);
  console.log(`  Submission interval: ${SUBMIT_DELAY_MS}ms`);
  console.log('');
  console.log('EXPECTED BEHAVIOR:');
  console.log('  ✅ Each job should process independently');
  console.log('  ✅ Each job should have consistent bracket ID throughout logs');
  console.log('  ✅ Lock acquisition logs should show "LOCK ACQUIRED" for one worker');
  console.log('  ✅ Other workers should see "LOCK ALREADY HELD" and skip');
  console.log('  ✅ All ARV values should be > $0 (valid results)');
  console.log('');
  console.log('WHAT TO WATCH FOR:');
  console.log('  🔍 Look for bracket ID switches (BEFORE: [11e48fb1] -> [885bf534])');
  console.log('  🔍 Look for concurrent processing of same job (should NOT happen)');
  console.log('  🔍 Look for "LOCK ALREADY HELD" messages (shows locks are working)');
  console.log('  🔍 Look for consistent heartbeat updates every 7 seconds');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const jobQueue = getJobQueue();
  const submittedJobs: string[] = [];

  console.log('🚀 STARTING JOB SUBMISSIONS');
  console.log('');

  for (let i = 0; i < NUM_JOBS; i++) {
    console.log(`📤 SUBMITTING JOB ${i + 1}/${NUM_JOBS}`);
    console.log(`   Address: ${TEST_ADDRESS}`);
    console.log(`   Time: ${new Date().toISOString()}`);

    try {
      const jobId = await jobQueue.enqueueJob(TEST_ADDRESS);
      submittedJobs.push(jobId);

      const shortId = jobId.slice(0, 8);
      console.log(`✅ JOB ${i + 1} ENQUEUED`);
      console.log(`   Job ID: ${jobId}`);
      console.log(`   Short ID: [${shortId}]`);
      console.log(`   Status: Job added to Redis Streams queue`);
      console.log('');

      // Small delay to create race condition (jobs submitted rapidly but not instantly)
      if (i < NUM_JOBS - 1) {
        console.log(`⏳ Waiting ${SUBMIT_DELAY_MS}ms before next submission...`);
        await new Promise(resolve => setTimeout(resolve, SUBMIT_DELAY_MS));
        console.log('');
      }
    } catch (error) {
      console.error(`❌ JOB ${i + 1} SUBMISSION FAILED`);
      console.error(`   Error: ${error}`);
      console.error('');
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ ALL JOBS SUBMITTED');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('SUBMITTED JOB IDS:');
  submittedJobs.forEach((jobId, index) => {
    console.log(`  ${index + 1}. [${jobId.slice(0, 8)}] ${jobId}`);
  });
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 NEXT STEPS:');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('1. MONITOR WORKER LOGS:');
  console.log('   Watch the worker container logs for:');
  console.log('   - "🔧 PHASE 2: JobLogger initialized with AsyncLocalStorage"');
  console.log('   - "🔧 PHASE 5: Lock acquisition SUCCEEDED"');
  console.log('   - "🔧 PHASE 5: Lock acquisition FAILED - another worker is processing this job"');
  console.log('   - Consistent bracket IDs throughout each job (no switches)');
  console.log('   - "💓 HEARTBEAT" messages every 7 seconds');
  console.log('');
  console.log('2. DOWNLOAD LOGS AFTER COMPLETION:');
  console.log('   Use the download-job-logs.sh script to download logs for each job:');
  submittedJobs.forEach((jobId, index) => {
    console.log(`   ./download-job-logs.sh ${jobId} "${new Date().toISOString()}" local`);
  });
  console.log('');
  console.log('3. ANALYZE LOGS FOR RACE CONDITION:');
  console.log('   For each log file, check:');
  console.log('   - Does bracket ID stay consistent? (should be YES)');
  console.log('   - Are there any log lines with different bracket ID? (should be NO)');
  console.log('   - Did the job complete with valid ARV? (should be YES if no API errors)');
  console.log('   - Was the lock acquired successfully? (should be YES for one worker, NO for others)');
  console.log('');
  console.log('4. VERIFY FIX SUCCESS:');
  console.log('   Compare with the BEFORE state (job 11e48fb1):');
  console.log('   - BEFORE: 85% log contamination (183/215 lines had wrong bracket ID)');
  console.log('   - AFTER: 0% log contamination (all lines should have correct bracket ID)');
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎯 TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('The jobs are now in the queue and will be processed by the worker.');
  console.log('Monitor the worker logs to verify the fixes are working correctly.');
  console.log('');

  // Keep process alive for a moment to ensure all logs are flushed
  await new Promise(resolve => setTimeout(resolve, 2000));

  process.exit(0);
}

// Run the test
console.log('');
console.log('Starting race condition test in 3 seconds...');
console.log('Press Ctrl+C to cancel');
console.log('');

setTimeout(async () => {
  try {
    await testRaceCondition();
  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ TEST SCRIPT ERROR');
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error);
    console.error('');
    console.error('Stack trace:');
    console.error(error instanceof Error ? error.stack : 'N/A');
    console.error('');
    process.exit(1);
  }
}, 3000);
