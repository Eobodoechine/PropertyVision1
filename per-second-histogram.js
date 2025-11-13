#!/usr/bin/env node
/**
 * Per-Second Histogram
 * Timeline visualization ±60s around Job 3 first 429
 */

const fs = require('fs');

// Load data
const errors = JSON.parse(fs.readFileSync('logs/429_errors.json', 'utf-8'));
const rolling = JSON.parse(fs.readFileSync('logs/rolling_window_analysis.json', 'utf-8'));

const firstFailureMs = errors.firstFailureEpochMs;
const windowStart = firstFailureMs - 60000;
const windowEnd = firstFailureMs + 60000;

// Create per-second buckets
const buckets = {};
for (let t = windowStart; t <= windowEnd; t += 1000) {
  const timestamp = new Date(t).toISOString().slice(0, 19);
  buckets[timestamp] = {
    epochMs: t,
    attempts: 0,
    success: 0,
    error429: 0,
    inFlight: 0 // Approximate
  };
}

// Parse all job logs for this window
const JOB_LOGS = [
  'logs/job-eecfec28-eb09-4016-808f-83e94501ab36-logs.txt', // Job 1
  'logs/job-ae4dcbfa-105f-4630-a440-f94af78ec78f-logs.txt', // Job 2
  'logs/job-4463db5c-775f-4d95-92db-02c4896aebc2-logs.txt'  // Job 3
];

JOB_LOGS.forEach(logFile => {
  if (!fs.existsSync(logFile)) return;
  
  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach(line => {
    const timestampMatch = line.match(/^(\S+)\t/);
    if (!timestampMatch) return;
    
    const timestamp = timestampMatch[1];
    const epochMs = new Date(timestamp).getTime();
    
    if (epochMs < windowStart || epochMs > windowEnd) return;
    
    // Round to nearest second
    const bucketKey = new Date(Math.floor(epochMs / 1000) * 1000).toISOString().slice(0, 19);
    
    if (!buckets[bucketKey]) return;
    
    // Count events
    if (line.includes('SPD_VERTEX_CALL') || line.includes('VERTEX_ATTEMPT')) {
      buckets[bucketKey].attempts++;
    }
    if (line.includes('SUCCESS') || line.includes('RETRY_SUCCESS')) {
      buckets[bucketKey].success++;
    }
    if (line.includes('429') || line.includes('RESOURCE_EXHAUSTED')) {
      buckets[bucketKey].error429++;
    }
  });
});

// Convert to array and sort
const timeline = Object.values(buckets).sort((a, b) => a.epochMs - b.epochMs);

// Mark first failure
const firstFailureSecond = new Date(Math.floor(firstFailureMs / 1000) * 1000).toISOString().slice(0, 19);

// Generate visualization
const output = {
  analysis: 'Per-Second Timeline',
  window: '±60s around first Job 3 429',
  firstFailureTime: errors.firstFailureTime,
  firstFailureSecond,
  timeline: timeline.map(t => ({
    timestamp: t.timestamp || new Date(t.epochMs).toISOString().slice(0, 19),
    attempts: t.attempts,
    success: t.success,
    error429: t.error429,
    marker: (new Date(t.epochMs).toISOString().slice(0, 19) === firstFailureSecond) ? '← FIRST 429' : ''
  })).filter(t => t.attempts > 0 || t.error429 > 0) // Only show active seconds
};

console.log(JSON.stringify(output, null, 2));
