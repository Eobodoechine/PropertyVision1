#!/usr/bin/env node
const fs = require('fs');

const JOB_LOGS = [
  { id: 'eecfec28', file: 'logs/job-eecfec28-eb09-4016-808f-83e94501ab36-logs.txt', name: 'Job1' },
  { id: 'ae4dcbfa', file: 'logs/job-ae4dcbfa-105f-4630-a440-f94af78ec78f-logs.txt', name: 'Job2' },
  { id: '4463db5c', file: 'logs/job-4463db5c-775f-4d95-92db-02c4896aebc2-logs.txt', name: 'Job3' }
];

const oauthCalls = [];

JOB_LOGS.forEach(job => {
  if (!fs.existsSync(job.file)) return;
  
  const content = fs.readFileSync(job.file, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach(line => {
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\t/);
    if (!timestampMatch) return;
    
    const timestamp = timestampMatch[1];
    const timestampMs = timestamp.substring(0, 23) + 'Z';
    const epochMs = new Date(timestampMs).getTime();
    
    // Look for OAuth/token operations
    if (line.includes('DIAG_TOKEN') || line.includes('AGENT_USE_OAUTH') || line.includes('token_uri')) {
      oauthCalls.push({ 
        jobId: job.id, 
        jobName: job.name, 
        timestamp, 
        epochMs,
        type: line.includes('FETCHED') ? 'fetched' : line.includes('CACHED') ? 'cached' : 'request'
      });
    }
  });
});

oauthCalls.sort((a, b) => a.epochMs - b.epochMs);

// Job 3 first failure window
const job3FirstFailureMs = 1762904059377;
const windowStart = job3FirstFailureMs - 60000;
const windowEnd = job3FirstFailureMs + 60000;

const oauthInWindow = oauthCalls.filter(o => 
  o.epochMs >= windowStart && o.epochMs <= windowEnd
);

console.log(JSON.stringify({
  analysis: 'OAuth Token Activity ±60s Around Job 3 First 429',
  failureTime: new Date(job3FirstFailureMs).toISOString(),
  totalOAuthCalls: oauthCalls.length,
  oauthInWindow: oauthInWindow.length,
  oauthDetails: oauthInWindow.map(o => ({
    job: o.jobName,
    timestamp: o.timestamp,
    type: o.type,
    relativeToFailure: `${((o.epochMs - job3FirstFailureMs) / 1000).toFixed(1)}s`
  })),
  verdict: oauthInWindow.length > 10 ? 'Significant OAuth activity' : 'Minimal OAuth activity'
}, null, 2));
