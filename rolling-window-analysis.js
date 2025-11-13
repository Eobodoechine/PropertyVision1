#!/usr/bin/env node
/**
 * Rolling 60-Second Window Analysis
 * Computes API attempt counts in 60s windows around Job 3 failures
 */

const fs = require('fs');

// Log files for all jobs
const JOB_LOGS = [
  { id: 'eecfec28', file: 'logs/job-eecfec28-eb09-4016-808f-83e94501ab36-logs.txt', name: 'Job1' },
  { id: 'ae4dcbfa', file: 'logs/job-ae4dcbfa-105f-4630-a440-f94af78ec78f-logs.txt', name: 'Job2' },
  { id: '4463db5c', file: 'logs/job-4463db5c-775f-4d95-92db-02c4896aebc2-logs.txt', name: 'Job3' }
];

// Extract all Vertex API attempts from all jobs
const allAttempts = [];

JOB_LOGS.forEach(job => {
  if (!fs.existsSync(job.file)) {
    console.error(`Warning: ${job.file} not found`);
    return;
  }
  
  const content = fs.readFileSync(job.file, 'utf-8');
  const lines = content.split('\n');
  
  // Look for Vertex API calls - various patterns
  const patterns = [
    /VERTEX_ATTEMPT_SUCCESS/,
    /VERTEX_ATTEMPT_429/,
    /SPD_VERTEX_CALL/,
    /VERTEX_ATTEMPT_ERROR/,
    /SPD_VERTEX_RETRY:/,
    /generateContent/ // Actual API endpoint calls
  ];
  
  lines.forEach(line => {
    // Extract timestamp
    const timestampMatch = line.match(/^(\S+)\t/);
    if (!timestampMatch) return;
    
    const timestamp = timestampMatch[1];
    const epochMs = new Date(timestamp).getTime();
    
    // Check if this is a Vertex attempt
    const isAttempt = patterns.some(p => p.test(line));
    if (isAttempt) {
      // Determine if success or 429
      const is429 = line.includes('429') || line.includes('RESOURCE_EXHAUSTED');
      const isSuccess = line.includes('SUCCESS') || line.includes('RETRY_SUCCESS');
      
      allAttempts.push({
        jobId: job.id,
        jobName: job.name,
        timestamp,
        epochMs,
        is429,
        isSuccess,
        line: line.substring(0, 150) // First 150 chars for context
      });
    }
  });
});

// Sort by timestamp
allAttempts.sort((a, b) => a.epochMs - b.epochMs);

// Load Job 3 429 errors
const job3Errors = JSON.parse(fs.readFileSync('logs/429_errors.json', 'utf-8'));

// For each 429 in Job 3, compute rolling 60s window
const windowAnalysis = job3Errors.first10Errors.map(error => {
  const errorTime = error.epochMs;
  const windowStart = errorTime - 60000; // 60 seconds before
  
  // Count attempts in this window
  const attemptsInWindow = allAttempts.filter(a => 
    a.epochMs > windowStart && a.epochMs <= errorTime
  );
  
  return {
    errorIndex: error.index,
    errorTime: error.timestamp,
    errorEpochMs: errorTime,
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: error.timestamp,
    totalAttemptsInWindow: attemptsInWindow.length,
    attemptsByJob: {
      Job1: attemptsInWindow.filter(a => a.jobName === 'Job1').length,
      Job2: attemptsInWindow.filter(a => a.jobName === 'Job2').length,
      Job3: attemptsInWindow.filter(a => a.jobName === 'Job3').length
    },
    successCount: attemptsInWindow.filter(a => a.isSuccess).length,
    error429Count: attemptsInWindow.filter(a => a.is429).length
  };
});

// Output analysis
const output = {
  analysis: 'Rolling 60-Second Window API Attempts',
  job3FirstFailure: job3Errors.firstFailureTime,
  job3FirstFailureEpochMs: job3Errors.firstFailureEpochMs,
  totalAttemptsExtracted: allAttempts.length,
  attemptsByJob: {
    Job1: allAttempts.filter(a => a.jobName === 'Job1').length,
    Job2: allAttempts.filter(a => a.jobName === 'Job2').length,
    Job3: allAttempts.filter(a => a.jobName === 'Job3').length
  },
  timeRange: {
    earliest: allAttempts[0]?.timestamp,
    latest: allAttempts[allAttempts.length - 1]?.timestamp
  },
  windowAnalysis
};

console.log(JSON.stringify(output, null, 2));
