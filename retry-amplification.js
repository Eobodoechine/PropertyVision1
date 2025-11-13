#!/usr/bin/env node
/**
 * Retry Amplification Analysis
 * Check if retries are causing cascading failures
 */

const fs = require('fs');

// Load 429 errors
const errors = JSON.parse(fs.readFileSync('logs/429_errors.json', 'utf-8'));

// Analyze attempt distribution
const attemptDist = errors.attemptDistribution;
const total = attemptDist.attempt1 + attemptDist.attempt2 + attemptDist.attempt3;
const retries = attemptDist.attempt2 + attemptDist.attempt3;
const retryPercentage = ((retries / total) * 100).toFixed(1);

// Check timing between retries
const timings = [];
for (let i = 1; i < errors.first10Errors.length; i++) {
  const prev = errors.first10Errors[i-1];
  const curr = errors.first10Errors[i];
  const gap = curr.epochMs - prev.epochMs;
  
  timings.push({
    errorIndex: curr.index,
    prevAttempt: prev.attempt,
    currAttempt: curr.attempt,
    gapMs: gap,
    alignsWithBackoff: gap >= 1000 && gap <= 5000 // Retry backoff range
  });
}

const output = {
  analysis: 'Retry Amplification Check',
  window: '±20s around Job 3 start',
  attemptDistribution: {
    firstAttempt: attemptDist.attempt1,
    retryAttempt2: attemptDist.attempt2,
    retryAttempt3: attemptDist.attempt3,
    totalAttempts: total,
    retryCount: retries,
    retryPercentage: `${retryPercentage}%`
  },
  timingAnalysis: timings,
  findings: {
    retryAmplification: retries > attemptDist.attempt1,
    cascadePattern: timings.filter(t => t.alignsWithBackoff).length > 0,
    avgRetryGap: (timings.reduce((sum, t) => sum + t.gapMs, 0) / timings.length).toFixed(0) + 'ms'
  },
  interpretation: retryPercentage > 50 
    ? 'HIGH: Retries outnumber first attempts - amplification detected'
    : 'LOW: Retries are not dominating the error pattern'
};

console.log(JSON.stringify(output, null, 2));
