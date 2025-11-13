#!/usr/bin/env node
const fs = require('fs');

const JOB_LOGS = [
  { id: 'eecfec28', file: 'logs/job-eecfec28-eb09-4016-808f-83e94501ab36-logs.txt', name: 'Job1' },
  { id: 'ae4dcbfa', file: 'logs/job-ae4dcbfa-105f-4630-a440-f94af78ec78f-logs.txt', name: 'Job2' },
  { id: '4463db5c', file: 'logs/job-4463db5c-775f-4d95-92db-02c4896aebc2-logs.txt', name: 'Job3' }
];

const allAttempts = [];

JOB_LOGS.forEach(job => {
  if (!fs.existsSync(job.file)) return;
  
  const content = fs.readFileSync(job.file, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach(line => {
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\t/);
    if (!timestampMatch) return;
    
    const timestamp = timestampMatch[1];
    // Truncate to milliseconds for parsing
    const timestampMs = timestamp.substring(0, 23) + 'Z';
    const epochMs = new Date(timestampMs).getTime();
    
    // Look for Vertex attempt markers
    if (line.includes('VERTEX_ATTEMPT') || line.includes('generateContent')) {
      allAttempts.push({ 
        jobId: job.id, 
        jobName: job.name, 
        timestamp, 
        epochMs,
        line: line.substring(0, 100)
      });
    }
  });
});

allAttempts.sort((a, b) => a.epochMs - b.epochMs);

console.log(`Total attempts found: ${allAttempts.length}`);

// Job 3 first failure
const job3FirstFailureMs = 1762904059377;
console.log(`Job 3 first failure: ${new Date(job3FirstFailureMs).toISOString()}`);

// Compute windows
const windows = [10000, 30000, 60000];

const analysis = windows.map(windowMs => {
  const windowStart = job3FirstFailureMs - windowMs;
  const attemptsInWindow = allAttempts.filter(a => 
    a.epochMs > windowStart && a.epochMs <= job3FirstFailureMs
  );
  
  return {
    windowSize: `${windowMs/1000}s`,
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(job3FirstFailureMs).toISOString(),
    totalAttempts: attemptsInWindow.length,
    qps: (attemptsInWindow.length / (windowMs/1000)).toFixed(2),
    byJob: {
      Job1: attemptsInWindow.filter(a => a.jobName === 'Job1').length,
      Job2: attemptsInWindow.filter(a => a.jobName === 'Job2').length,
      Job3: attemptsInWindow.filter(a => a.jobName === 'Job3').length
    }
  };
});

console.log(JSON.stringify({
  analysis: 'Shorter Rolling Windows at First Job 3 429',
  windows: analysis
}, null, 2));
