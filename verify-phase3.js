#!/usr/bin/env node
/**
 * Phase 3: Correlate jobs with worker log timestamps
 * Find WHEN each error occurred relative to job lifecycle
 */

const fs = require('fs');
const jobs = require('./verification-phase1-results.json');

console.log('='.repeat(80));
console.log('PHASE 3: CORRELATE JOBS WITH WORKER LOGS');
console.log('='.repeat(80));
console.log('');

// Convert timestamps to human-readable
function formatTimestamp(ts) {
  return new Date(ts).toISOString();
}

function tsToSeconds(ts) {
  return Math.floor(ts / 1000);
}

console.log('Job Timeline (converted to Unix seconds for log correlation):');
console.log('');

jobs.forEach((job, idx) => {
  const startSec = tsToSeconds(job.createdAt);
  const endSec = job.completedAt ? tsToSeconds(job.completedAt) : tsToSeconds(job.lastHeartbeat);
  const duration = endSec - startSec;

  console.log(`Run ${idx + 1} (${job.shortId}) - ${job.status.toUpperCase()}`);
  console.log(`  Created:    ${formatTimestamp(job.createdAt)} (${startSec})`);
  if (job.completedAt) {
    console.log(`  Completed:  ${formatTimestamp(job.completedAt)} (${endSec})`);
  } else {
    console.log(`  Last HB:    ${formatTimestamp(job.lastHeartbeat)} (${endSec})`);
  }
  console.log(`  Duration:   ${duration}s`);
  console.log(`  Phase:      ${job.phase}`);
  console.log(`  Progress:   ${job.progress}%`);
  if (job.error) {
    console.log(`  Error:      ${job.error}`);
  }
  console.log('');
});

console.log('-'.repeat(80));
console.log('CONCURRENT EXECUTION WINDOW:');
console.log('');

const firstStart = jobs[0].createdAt;
const lastStart = jobs[jobs.length - 1].createdAt;
const concurrentWindow = lastStart - firstStart;

console.log(`  First job started:  ${formatTimestamp(firstStart)}`);
console.log(`  Last job started:   ${formatTimestamp(lastStart)}`);
console.log(`  Concurrent window:  ${(concurrentWindow / 1000).toFixed(1)}s`);
console.log(`  All 5 jobs started within ${(concurrentWindow / 1000).toFixed(1)} seconds!`);
console.log('');

console.log('-'.repeat(80));
console.log('FAILURE ANALYSIS:');
console.log('');

const failed = jobs.filter(j => j.status === 'failed');
const hanging = jobs.filter(j => j.status === 'processing');

console.log(`Failed jobs: ${failed.length}`);
failed.forEach(job => {
  const startSec = tsToSeconds(job.createdAt);
  const failSec = tsToSeconds(job.completedAt);
  console.log(`  - ${job.shortId}: Failed after ${failSec - startSec}s at ${job.progress}% (${job.phase})`);
  console.log(`    Error: ${job.error}`);
});

console.log('');
console.log(`Hanging jobs: ${hanging.length}`);
hanging.forEach(job => {
  const startSec = tsToSeconds(job.createdAt);
  const hbSec = tsToSeconds(job.lastHeartbeat);
  const staleness = tsToSeconds(Date.now()) - hbSec;
  console.log(`  - ${job.shortId}: Last heartbeat ${staleness}s ago at ${job.progress}% (${job.phase})`);
  console.log(`    Ran for ${hbSec - startSec}s before hanging`);
});

console.log('');
console.log('='.repeat(80));
console.log('NEXT STEP: Search worker logs for these job IDs');
console.log('  Job IDs to search:');
jobs.forEach((job, idx) => {
  console.log(`  ${idx + 1}. ${job.jobId} (${job.status})`);
});
console.log('='.repeat(80));
