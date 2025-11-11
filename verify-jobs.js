#!/usr/bin/env node
/**
 * Systematic verification of jobs for address: 1395 Athens Ave SW, Atlanta, GA 30310
 * Purpose: Reduce assumptions to zero
 */

const Redis = require('ioredis');

async function verifyJobs() {
  const redis = new Redis('redis://localhost:6379');
  const targetAddress = '1395 Athens Ave SW, Atlanta, GA 30310';

  console.log('='.repeat(80));
  console.log('PHASE 1: GET GROUND TRUTH - All Jobs for Test Address');
  console.log('='.repeat(80));
  console.log(`Target address: "${targetAddress}"`);
  console.log('');

  try {
    // Get all job keys
    const keys = await redis.keys('job:*');
    console.log(`Total jobs in Redis: ${keys.length}`);

    // Get job data for all keys
    const jobs = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          if (parsed.address === targetAddress) {
            jobs.push({
              key: key,
              jobId: parsed.jobId,
              shortId: parsed.jobId.substring(0, 8),
              status: parsed.status,
              address: parsed.address,
              createdAt: parsed.createdAt,
              completedAt: parsed.completedAt,
              lastHeartbeat: parsed.lastHeartbeat,
              error: parsed.error,
              progress: parsed.progress,
              phase: parsed.phase
            });
          }
        } catch (e) {
          console.error(`Failed to parse job ${key}: ${e.message}`);
        }
      }
    }

    console.log(`\nJobs matching target address: ${jobs.length}`);
    console.log('');

    if (jobs.length === 0) {
      console.log('❌ VERIFICATION FAILED: No jobs found for this address');
      console.log('   This contradicts user claim of 5 runs');
      redis.quit();
      return;
    }

    // Sort chronologically by createdAt
    jobs.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });

    console.log('Jobs in chronological order:');
    console.log('-'.repeat(80));
    console.log('Run | Job ID   | Status      | Created At          | Error');
    console.log('-'.repeat(80));

    jobs.forEach((job, index) => {
      const runNum = (index + 1).toString().padStart(3);
      const status = job.status.padEnd(11);
      const createdAt = job.createdAt || 'N/A';
      const error = job.error ? job.error.substring(0, 40) : '';
      console.log(`${runNum} | ${job.shortId} | ${status} | ${createdAt} | ${error}`);
    });

    console.log('='.repeat(80));
    console.log('');

    // Analyze pattern
    console.log('PATTERN ANALYSIS:');
    const statusCounts = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});

    console.log(`  Total runs: ${jobs.length}`);
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    console.log('');

    // Check for hanging jobs (processing but old heartbeat)
    const now = Date.now();
    jobs.forEach((job, index) => {
      if (job.status === 'processing') {
        const lastHB = job.lastHeartbeat || 0;
        const staleness = Math.floor((now - lastHB) / 1000);
        console.log(`⚠️  Run ${index + 1} (${job.shortId}): Status="processing" but heartbeat is ${staleness}s old`);
        if (staleness > 60) {
          console.log(`   → Likely HANGING (stale > 60s)`);
        }
      }
    });

    console.log('');
    console.log('VERIFICATION RESULTS:');
    console.log(`  ✅ Found ${jobs.length} job(s) for target address`);
    console.log(`  User claimed: 5 runs`);
    console.log(`  Match: ${jobs.length === 5 ? '✅ YES' : '❌ NO'}`);

    // Save results for Phase 2
    require('fs').writeFileSync(
      '/Users/eobodoechine/PropertyVision1/verification-phase1-results.json',
      JSON.stringify(jobs, null, 2)
    );
    console.log('');
    console.log('✅ Phase 1 complete. Results saved to verification-phase1-results.json');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    redis.quit();
  }
}

verifyJobs();
