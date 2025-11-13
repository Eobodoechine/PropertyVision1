#!/usr/bin/env node

/**
 * Test script: Submit 10 concurrent Chrome MCP jobs
 * Address: 1395 Athens Ave SW, Atlanta, GA 30310 (problematic address from investigation)
 *
 * Expected behavior with fixes:
 * - Max 3 jobs running concurrently (semaphore limit)
 * - NO MaxListenersExceededWarning
 * - All jobs complete successfully
 * - [SEMAPHORE_*] logs showing slot management
 */

const TEST_ADDRESS = '1395 Athens Ave SW, Atlanta, GA 30310';
const CONCURRENT_JOBS = 10;
const API_URL = 'http://localhost:3000/api/analyze';

async function submitJob(jobNumber) {
  const startTime = Date.now();
  console.log(`[Job ${jobNumber}] Submitting at ${new Date().toISOString()}`);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: TEST_ADDRESS })
    });

    const data = await response.json();
    const duration = Date.now() - startTime;

    if (response.ok) {
      console.log(`[Job ${jobNumber}] ✅ SUCCESS (${duration}ms) - Job ID: ${data.jobId?.substring(0, 8)}`);
      return { jobNumber, success: true, jobId: data.jobId, duration };
    } else {
      console.log(`[Job ${jobNumber}] ❌ FAILED (${duration}ms) - Error: ${data.error}`);
      return { jobNumber, success: false, error: data.error, duration };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`[Job ${jobNumber}] ❌ EXCEPTION (${duration}ms) - ${error.message}`);
    return { jobNumber, success: false, error: error.message, duration };
  }
}

async function main() {
  console.log('========================================');
  console.log('CONCURRENT JOB TEST - CONCURRENCY FIX v1.0');
  console.log('========================================');
  console.log(`Address: ${TEST_ADDRESS}`);
  console.log(`Concurrent jobs: ${CONCURRENT_JOBS}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('========================================\n');

  // Submit all jobs in parallel
  const testStartTime = Date.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENT_JOBS }, (_, i) => submitJob(i + 1))
  );

  const testDuration = Date.now() - testStartTime;

  // Summary
  console.log('\n========================================');
  console.log('TEST RESULTS SUMMARY');
  console.log('========================================');
  console.log(`Total duration: ${(testDuration / 1000).toFixed(1)}s`);
  console.log(`Jobs submitted: ${CONCURRENT_JOBS}`);
  console.log(`Jobs succeeded: ${results.filter(r => r.success).length}`);
  console.log(`Jobs failed: ${results.filter(r => !r.success).length}`);
  console.log('\nJob IDs:');
  results.forEach(r => {
    if (r.success) {
      console.log(`  [${r.jobNumber}] ${r.jobId?.substring(0, 8)}`);
    } else {
      console.log(`  [${r.jobNumber}] FAILED - ${r.error}`);
    }
  });
  console.log('========================================\n');

  console.log('Next steps:');
  console.log('1. Check worker logs for [SEMAPHORE_*] activity');
  console.log('2. Verify NO MaxListenersExceededWarning appears');
  console.log('3. Monitor jobs in Redis: redis-cli XREAD STREAMS prod:jobs 0');
  console.log('4. Check all jobs complete successfully\n');
}

main().catch(error => {
  console.error('Test script failed:', error);
  process.exit(1);
});
