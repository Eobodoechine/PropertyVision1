#!/usr/bin/env node
/**
 * Phase B: 429 Metrics Analysis Script
 *
 * Analyzes structured JSON logs to extract real 429 signals from Google/Vertex
 * Reports mechanism_reported, quota_id, retry delays, and inflight distribution
 *
 * Usage:
 *   node tools/summarize-429.js <LOG_FILE>
 *   node tools/summarize-429.js logs/job-abc123.json
 */

const fs = require('fs');

const LOG_FILE = process.argv[2];

if (!LOG_FILE || !fs.existsSync(LOG_FILE)) {
  console.error('Usage: node tools/summarize-429.js <LOG_FILE>');
  console.error('Example: node tools/summarize-429.js logs/job-abc123.json');
  process.exit(1);
}

console.log('=== Phase B: 429 Metrics Analysis ===');
console.log(`Log file: ${LOG_FILE}`);
console.log('');

// Read and parse JSON logs
const content = fs.readFileSync(LOG_FILE, 'utf8');
const lines = content.split('\n').filter(line => line.trim().length > 0);

const events = [];
for (const line of lines) {
  try {
    // Check if line contains structured JSON (Cloud Logging format)
    const jsonStart = line.indexOf('{"t":');
    if (jsonStart !== -1) {
      // Extract JSON substring from Cloud Logging formatted line
      const jsonStr = line.substring(jsonStart);
      const parsed = JSON.parse(jsonStr);
      if (parsed.t && parsed.kind) {
        events.push(parsed);
      }
    } else {
      // Try parsing as pure JSON (for pre-extracted logs)
      const parsed = JSON.parse(line);
      if (parsed.t && parsed.kind) {
        events.push(parsed);
      }
    }
  } catch (err) {
    // Skip non-JSON lines
  }
}

if (events.length === 0) {
  console.error('❌ No structured JSON logs found in', LOG_FILE);
  console.error('   Make sure the job was run with Phase B code changes.');
  process.exit(1);
}

// Extract job config
const jobConfig = events.find(e => e.kind === 'JOB_CONFIG');
if (jobConfig) {
  console.log('📊 Job Configuration:');
  console.log(`  Concurrency:        ${jobConfig.concurrency}`);
  console.log(`  Pacing (ms):        ${jobConfig.pacing_ms}`);
  console.log(`  Jitter (ms):        ${jobConfig.jitter_ms}`);
  console.log(`  Phase offset (ms):  ${jobConfig.phase_offset_max_ms}`);
  console.log(`  Total prompts:      ${jobConfig.total_prompts}`);
  console.log(`  Expected Vertex:    ${jobConfig.expected_vertex_calls}`);
  if (jobConfig.baseline_limiter_calls !== undefined) {
    console.log(`  Baseline limiter:   ${jobConfig.baseline_limiter_calls}`);
  }
  console.log('');
} else {
  console.log('⚠️  No JOB_CONFIG found (Phase A logs?)');
  console.log('');
}

// Count API attempts
const attemptStarts = events.filter(e =>
  e.kind === 'ATTEMPT_START' || e.kind === 'VERTEX_CALL_START'
);
const attemptCount = attemptStarts.length;

// Count 429 errors
const errors429 = events.filter(e => e.kind === '429_DIAG');
const error429Count = errors429.length;

// Calculate 429%
const error429Pct = attemptCount > 0
  ? ((error429Count / attemptCount) * 100).toFixed(2)
  : '0.00';

// Calculate first-429 lag
let first429Lag = 'N/A';
if (attemptStarts.length > 0 && errors429.length > 0) {
  const firstAttemptT = attemptStarts[0].t;
  const first429T = errors429[0].t;
  const lagMs = first429T - firstAttemptT;
  first429Lag = (lagMs / 1000).toFixed(2) + 's';
}

// Calculate duration and QPS
let durationSec = 'N/A';
let qps = 'N/A';
if (attemptStarts.length > 1) {
  const firstT = attemptStarts[0].t;
  const lastT = attemptStarts[attemptStarts.length - 1].t;
  const durationMs = lastT - firstT;
  durationSec = (durationMs / 1000).toFixed(2) + 's';
  if (durationMs > 0) {
    qps = (attemptCount / (durationMs / 1000)).toFixed(2);
  }
}

// Analyze inflight distribution at 429 events
const inflightAt429 = errors429
  .filter(e => e.inflightAtStart !== undefined)
  .map(e => e.inflightAtStart);

const inflightHistogram = {};
inflightAt429.forEach(count => {
  inflightHistogram[count] = (inflightHistogram[count] || 0) + 1;
});

// Analyze mechanism_reported distribution
const mechanismCounts = {};
errors429.forEach(e => {
  const mechanism = e.mechanism_reported || 'null';
  mechanismCounts[mechanism] = (mechanismCounts[mechanism] || 0) + 1;
});

// Analyze quota_id distribution
const quotaIdCounts = {};
errors429.forEach(e => {
  const quotaId = e.quota_id || 'null';
  quotaIdCounts[quotaId] = (quotaIdCounts[quotaId] || 0) + 1;
});

// Analyze retry_delay_ms distribution
const retryDelays = errors429
  .filter(e => e.retry_delay_ms !== null && e.retry_delay_ms !== undefined)
  .map(e => e.retry_delay_ms);

const avgRetryDelay = retryDelays.length > 0
  ? (retryDelays.reduce((sum, d) => sum + d, 0) / retryDelays.length).toFixed(0)
  : 'N/A';

const minRetryDelay = retryDelays.length > 0 ? Math.min(...retryDelays) : 'N/A';
const maxRetryDelay = retryDelays.length > 0 ? Math.max(...retryDelays) : 'N/A';

// Output results
console.log('📊 Metrics Summary:');
console.log(`  Total API Attempts:  ${attemptCount}`);
console.log(`  429 Errors:          ${error429Count}`);
console.log(`  429% Rate:           ${error429Pct}%`);
console.log('');
console.log(`  First 429 Lag:       ${first429Lag}`);
console.log(`  Test Duration:       ${durationSec}`);
console.log(`  Average QPS:         ${qps}`);
console.log('');

// Phase B enhancements: mechanism, quota, inflight distribution
console.log('🔬 Phase B: Real Google Signals');
console.log('');
console.log('  Mechanism Distribution:');
Object.entries(mechanismCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([mechanism, count]) => {
    const pct = ((count / error429Count) * 100).toFixed(1);
    console.log(`    ${mechanism}: ${count} (${pct}%)`);
  });
console.log('');

console.log('  Quota ID Distribution:');
Object.entries(quotaIdCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([quotaId, count]) => {
    const pct = ((count / error429Count) * 100).toFixed(1);
    const display = quotaId.length > 60 ? quotaId.slice(0, 60) + '...' : quotaId;
    console.log(`    ${display}: ${count} (${pct}%)`);
  });
console.log('');

console.log('  Retry Delay Recommendations (from Google):');
console.log(`    Average: ${avgRetryDelay}ms`);
console.log(`    Min:     ${minRetryDelay}ms`);
console.log(`    Max:     ${maxRetryDelay}ms`);
console.log(`    Sample:  ${retryDelays.length} of ${error429Count} 429s included RetryInfo`);
console.log('');

if (Object.keys(inflightHistogram).length > 0) {
  console.log('  Inflight Distribution at 429 Events:');
  Object.entries(inflightHistogram)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .forEach(([inflight, count]) => {
      const pct = ((count / inflightAt429.length) * 100).toFixed(1);
      console.log(`    Inflight=${inflight}: ${count} (${pct}%)`);
    });
  console.log('');
}

// S0-v2: Enhanced validations for S0 runs
const isS0Run = jobConfig && jobConfig.run_label && jobConfig.run_label.startsWith('S0');
let s0ValidationsPassed = true;

if (isS0Run) {
  console.log('🔬 S0-v2 Validations:');
  console.log('');

  // Check for S0_VIOLATION events (pre/post inflight violations)
  const s0Violations = events.filter(e => e.kind === 'S0_VIOLATION');
  const passNoViolations = s0Violations.length === 0;
  console.log(`  ${passNoViolations ? '✅' : '❌'} No S0_VIOLATION events: ${passNoViolations ? 'PASS' : `FAIL (${s0Violations.length} violations found)`}`);
  if (!passNoViolations) {
    s0ValidationsPassed = false;
    console.log(`     Violations: ${s0Violations.map(v => `pre=${v.pre_inflight}, post=${v.post_inflight}`).join(', ')}`);
  }

  // Check JOB_END integrity (no bypassed calls) - uses per-job baseline tracking
  const jobEnd = events.find(e => e.kind === 'JOB_END');
  if (jobEnd) {
    // New per-job baseline fields
    const baseline = jobEnd.baseline_limiter_calls ?? 0;
    const endCalls = jobEnd.end_limiter_calls ?? jobEnd.actual_vertex_calls ?? 0;
    const sinceStart = jobEnd.vertex_calls_since_start ?? (endCalls - baseline);
    const expected = jobEnd.vertex_calls_expected_main ?? jobEnd.expected_vertex_calls ?? 0;
    const delta = jobEnd.call_delta ?? (sinceStart - expected);

    const passIntegrity = jobEnd.integrity_check === 'PASS' && delta >= 0;
    console.log(`  ${passIntegrity ? '✅' : '❌'} JOB_END integrity: ${passIntegrity ? 'PASS' : 'FAIL'}`);
    console.log(`     baseline=${baseline}, end=${endCalls}, since_start=${sinceStart}, expected=${expected}, delta=${delta}`);
    if (!passIntegrity) {
      s0ValidationsPassed = false;
    }
  } else {
    console.log(`  ⚠️  JOB_END event not found - cannot verify integrity`);
    s0ValidationsPassed = false;
  }

  // Check ATTEMPT_START/END events have correct inflight values
  const attemptEvents = events.filter(e => e.kind === 'ATTEMPT_START' && e.schema_version === 'v2');
  if (attemptEvents.length > 0) {
    const badInflight = attemptEvents.filter(e => e.pre_inflight !== 0 || e.post_inflight !== 1);
    const passInflight = badInflight.length === 0;
    console.log(`  ${passInflight ? '✅' : '❌'} All attempts have pre=0, post=1: ${passInflight ? 'PASS' : `FAIL (${badInflight.length}/${attemptEvents.length} attempts had bad inflight)`}`);
    if (!passInflight) {
      s0ValidationsPassed = false;
      console.log(`     Bad inflight attempts: ${badInflight.slice(0, 3).map(e => `pre=${e.pre_inflight}, post=${e.post_inflight}`).join(', ')}`);
    }
  } else {
    console.log(`  ⚠️  No ATTEMPT_START events with schema_version=v2 found`);
  }

  // Check for S0_BYPASS_VIOLATION (direct vertexGenerate calls)
  const bypassViolations = events.filter(e => e.kind === 'S0_BYPASS_VIOLATION');
  const passNoBypass = bypassViolations.length === 0;
  console.log(`  ${passNoBypass ? '✅' : '❌'} No S0_BYPASS_VIOLATION events: ${passNoBypass ? 'PASS' : `FAIL (${bypassViolations.length} bypasses found)`}`);
  if (!passNoBypass) {
    s0ValidationsPassed = false;
  }

  console.log('');
}

// Pass/fail criteria
console.log('🎯 Phase B Pass Criteria:');
const pass429Rate = parseFloat(error429Pct) <= 5.0;
const passFirst429Lag = first429Lag === 'N/A' || parseFloat(first429Lag) >= 60.0;

if (attemptCount > 0) {
  console.log(`  ${pass429Rate ? '✅' : '❌'} 429% ≤ 5%: ${pass429Rate ? 'PASS' : 'FAIL'} (actual: ${error429Pct}%)`);

  if (first429Lag === 'N/A') {
    console.log(`  ✅ First-429 lag ≥ 60s: PASS (no 429 errors!)`);
  } else {
    console.log(`  ${passFirst429Lag ? '✅' : '❌'} First-429 lag ≥ 60s: ${passFirst429Lag ? 'PASS' : 'FAIL'} (actual: ${first429Lag})`);
  }
} else {
  console.log('  ⚠️  No API attempts found - cannot evaluate criteria');
}

console.log('');

// Overall pass/fail (including S0 validations for S0 runs)
const overallPass = pass429Rate && passFirst429Lag && (!isS0Run || s0ValidationsPassed);
if (overallPass) {
  console.log('🎉 Overall: PASS');
  if (isS0Run) {
    console.log('   S0 falsifier test confirms: 429 errors are from Google/Vertex (upstream), NOT from our parallelism');
  }
} else {
  console.log('❌ Overall: FAIL');
  if (isS0Run && !s0ValidationsPassed) {
    console.log('   S0 test was INVALID - isolation was not maintained (inflight > 1 or bypassed limiter)');
  }
}
