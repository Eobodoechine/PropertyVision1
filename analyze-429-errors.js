#!/usr/bin/env node
/**
 * Deep 429 Error Analysis Script
 * Extracts detailed 429 error information from Job 3 logs
 */

const fs = require('fs');
const path = require('path');

// Job 3 log file
const JOB3_LOG = 'logs/job-4463db5c-775f-4d95-92db-02c4896aebc2-logs.txt';

// Read and parse log file
const logContent = fs.readFileSync(JOB3_LOG, 'utf-8');
const logLines = logContent.split('\n');

// Extract 429 errors
const errors429 = [];
const attemptPattern = /❌ SPD_VERTEX_EXIT_NO_CANDIDATES.*httpCode=429/;

for (let i = 0; i < logLines.length; i++) {
  const line = logLines[i];
  
  if (attemptPattern.test(line)) {
    // Parse the log line
    const timestampMatch = line.match(/^(\S+)\t/);
    const callerMatch = line.match(/caller=([^,]+)/);
    const attemptMatch = line.match(/attempt=(\d+)\/(\d+)/);
    const reasonMatch = line.match(/reason=([^,]+)/);
    const errorMatch = line.match(/error=(\{[^}]+\})/);
    
    const timestamp = timestampMatch ? timestampMatch[1] : 'unknown';
    const caller = callerMatch ? callerMatch[1] : 'unknown';
    const attemptNum = attemptMatch ? parseInt(attemptMatch[1]) : 0;
    const maxAttempts = attemptMatch ? parseInt(attemptMatch[2]) : 0;
    const reason = reasonMatch ? reasonMatch[1] : 'unknown';
    
    let errorObj = {};
    if (errorMatch) {
      try {
        errorObj = JSON.parse(errorMatch[1]);
      } catch (e) {
        errorObj = { raw: errorMatch[1] };
      }
    }
    
    // Convert timestamp to epoch ms
    const epochMs = new Date(timestamp).getTime();
    
    errors429.push({
      index: errors429.length + 1,
      timestamp,
      epochMs,
      logLine: i + 1,
      caller,
      attempt: attemptNum,
      maxAttempts,
      reason,
      httpCode: 429,
      errorMessage: errorObj.message || '',
      errorCode: errorObj.code || 429,
      errorStatus: errorObj.status || '',
      errorDetails: errorObj.details || null,
      retryAfter: null, // Not captured in current logs
      quotaInfo: null   // Not captured in current logs
    });
  }
}

// Output as JSON
console.log(JSON.stringify({
  jobId: '4463db5c-775f-4d95-92db-02c4896aebc2',
  jobStartTime: '2025-11-11T23:34:19.177Z',
  firstFailureTime: errors429.length > 0 ? errors429[0].timestamp : null,
  firstFailureEpochMs: errors429.length > 0 ? errors429[0].epochMs : null,
  total429Count: errors429.length,
  first10Errors: errors429.slice(0, 10),
  errorClassification: {
    resourceExhausted: errors429.filter(e => e.errorStatus === 'RESOURCE_EXHAUSTED').length,
    concurrencyQuota: errors429.filter(e => e.errorMessage.includes('concurrent_requests')).length,
    transportErrors: 0 // None found in these logs
  },
  attemptDistribution: {
    attempt1: errors429.filter(e => e.attempt === 1).length,
    attempt2: errors429.filter(e => e.attempt === 2).length,
    attempt3: errors429.filter(e => e.attempt === 3).length
  }
}, null, 2));
