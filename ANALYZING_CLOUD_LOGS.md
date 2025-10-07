# Analyzing Cloud Run Logs for Performance Metrics

This guide explains how to extract and analyze timing data from Google Cloud logs to understand job performance.

## Prerequisites

- `gcloud` CLI installed and authenticated
- `jq` for JSON processing
- `node` for running analysis scripts

## Step 1: Fetch Logs from Cloud Run

### Basic Command Structure

```bash
gcloud logging read 'FILTER' --limit N --format json > output.json
```

### Fetch Recent Logs for a Service

```bash
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="propertyvision-worker-staging"
  AND timestamp>="2025-10-07T00:00:00Z"' \
  --limit 10000 --format json > /tmp/staging_logs.json
```

**Key Parameters:**
- `resource.type="cloud_run_revision"` - Filters to Cloud Run services
- `resource.labels.service_name="SERVICE_NAME"` - Specific service name
- `timestamp>="YYYY-MM-DDTHH:MM:SSZ"` - Time range filter
- `--limit N` - Number of log entries (max varies, typically use 10000)
- `--format json` - Output as JSON for parsing

### Common Filter Examples

**Filter by severity:**
```bash
'resource.type="cloud_run_revision" AND severity>=ERROR'
```

**Filter by text content:**
```bash
'resource.type="cloud_run_revision" AND textPayload=~"geocode.*timeout"'
```

**Multiple conditions:**
```bash
'resource.type="cloud_run_revision"
  AND resource.labels.service_name="SERVICE_NAME"
  AND severity>=INFO
  AND timestamp>="2025-10-07T00:00:00Z"
  AND timestamp<="2025-10-07T23:59:59Z"'
```

## Step 2: Find Successful Jobs

### Search for Completed Jobs

```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.textPayload and (.textPayload | contains("Job") and contains("completed"))) | .textPayload' | head -5
```

**Output Example:**
```
✅ Job 4c487f1a-e866-4bea-bd7e-f8e36cefcd9b completed
✅ Job 4c487f1a-e866-4bea-bd7e-f8e36cefcd9b saved to Redis: status=completed, progress=100
```

This gives you the Job ID to analyze.

## Step 3: Extract Phase Timing Data

### View Raw Phase Transitions

```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.timestamp and .textPayload) | select(.textPayload | contains("JOB_ID") and contains("phase")) | "\(.timestamp) | \(.textPayload)"' | sort | grep -E "(Subject Property Research|Comparable Search - Level|ARV Calculation)"
```

**Replace `JOB_ID`** with your actual job ID (e.g., `4c487f1a-e866-4bea-bd7e-f8e36cefcd9b`).

**Output Example:**
```
2025-10-07T18:14:20.728170Z | 💾 Updating job 4c487f1a... with: {"progress":10,"phase":"Subject Property Research",...}
2025-10-07T18:16:26.226520Z | 💾 Updating job 4c487f1a... with: {"progress":25,"phase":"Comparable Search - Level 1",...}
2025-10-07T18:19:12.327091Z | 💾 Updating job 4c487f1a... with: {"progress":45,"phase":"Comparable Search - Level 2",...}
```

## Step 4: Calculate Timing with Node.js Script

### Create Analysis Script

Save this as `/tmp/analyze_job_timing.js`:

```javascript
const fs = require('fs');
const logs = JSON.parse(fs.readFileSync('/tmp/staging_logs.json', 'utf8'));

// Replace with your job ID
const jobId = '4c487f1a-e866-4bea-bd7e-f8e36cefcd9b';
const events = [];

logs.reverse().forEach(log => {
  const msg = log.textPayload || (log.jsonPayload && log.jsonPayload.message);
  if (!msg || !msg.includes(jobId)) return;

  const time = new Date(log.timestamp);

  // Track phase transitions
  if (msg.includes('Processing job') && !events.find(e => e.name === 'Start')) {
    events.push({ name: 'Start', time, msg: 'Job started processing' });
  }
  if (msg.includes('Subject Property Research')) {
    events.push({ name: 'Subject Research', time, msg: 'Fetching subject property details' });
  }
  if (msg.includes('Comparable Search - Level 1')) {
    events.push({ name: 'Comp Search L1', time, msg: 'Level 1 - Tight Local search' });
  }
  if (msg.includes('Comparable Search - Level 2')) {
    events.push({ name: 'Comp Search L2', time, msg: 'Level 2 - Extended Local search' });
  }
  if (msg.includes('Comparable Search - Level 3')) {
    events.push({ name: 'Comp Search L3', time, msg: 'Level 3 - Broader Market search' });
  }
  if (msg.includes('ARV Calculation')) {
    events.push({ name: 'ARV Calculation', time, msg: 'Calculating After Repair Value' });
  }
  if (msg.includes('Job ' + jobId.substring(0, 8)) && msg.includes('completed')) {
    events.push({ name: 'Completed', time, msg: 'Job completed successfully' });
  }
});

// Deduplicate by name (keep first occurrence)
const unique = [];
const seen = new Set();
events.forEach(e => {
  if (!seen.has(e.name)) {
    seen.add(e.name);
    unique.push(e);
  }
});

console.log('');
console.log('📊 JOB TIMELINE - Job ' + jobId.substring(0, 8));
console.log('');

let prev = null;
unique.forEach((event, i) => {
  const timeStr = event.time.toISOString().split('T')[1].slice(0, 8);
  const name = (event.name + '                    ').slice(0, 20);

  if (prev) {
    const duration = ((event.time - prev.time) / 1000).toFixed(1);
    console.log(name + ' | ' + timeStr + ' | +' + duration + 's | ' + event.msg);
  } else {
    console.log(name + ' | ' + timeStr + ' | -------- | ' + event.msg);
  }

  prev = event;
});

if (unique.length >= 2) {
  const total = ((unique[unique.length - 1].time - unique[0].time) / 1000).toFixed(1);
  console.log('');
  console.log('⏱️  TOTAL DURATION: ' + total + 's (' + (total/60).toFixed(1) + ' minutes)');
}
```

### Run the Analysis

```bash
node /tmp/analyze_job_timing.js
```

**Output:**
```
📊 JOB TIMELINE - Job 4c487f1a

Start                | 18:14:09 | -------- | Job started processing
Subject Research     | 18:14:20 | +11.4s | Fetching subject property details
Comp Search L1       | 18:16:26 | +125.5s | Level 1 - Tight Local search
Comp Search L2       | 18:19:12 | +166.1s | Level 2 - Extended Local search
Comp Search L3       | 18:21:18 | +126.3s | Level 3 - Broader Market search
ARV Calculation      | 18:25:19 | +240.9s | Calculating After Repair Value
Completed            | 18:25:29 | +9.6s | Job completed successfully

⏱️  TOTAL DURATION: 679.8s (11.3 minutes)
```

## Step 5: Customizing for Your Use Case

### Adjust Phase Tracking

Modify the `if (msg.includes(...))` conditions to match your application's phase names:

```javascript
// Example: Track geocoding separately
if (msg.includes('Validating address via geocoding')) {
  events.push({ name: 'Geocoding', time, msg: 'Validating address coordinates' });
}

// Example: Track Vertex AI calls
if (msg.includes('COMPREHENSIVE COMPARABLE SEARCH')) {
  events.push({ name: 'Vertex Search Start', time, msg: 'Starting Vertex AI search' });
}
```

### Filter by Time Range

```bash
# Only fetch logs from last hour
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="SERVICE_NAME"' \
  --freshness 1h --limit 5000 --format json > /tmp/recent_logs.json

# Specific time window
gcloud logging read 'resource.type="cloud_run_revision"
  AND timestamp>="2025-10-07T18:00:00Z"
  AND timestamp<="2025-10-07T19:00:00Z"' \
  --limit 10000 --format json > /tmp/logs.json
```

## Quick Reference Commands

### Find Latest Completed Job
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.textPayload and (.textPayload | contains("completed"))) | .textPayload' | head -1
```

### Count Errors in Logs
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.severity == "ERROR") | .textPayload' | wc -l
```

### Search for Specific Error
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.textPayload and (.textPayload | contains("geocode") and contains("failed"))) | "\(.timestamp) | \(.textPayload)"' | sort
```

### List All Unique Job IDs
```bash
cat /tmp/staging_logs.json | jq -r '.[] | .textPayload' | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | sort -u
```

## Tips

1. **Use `--limit 10000`** for comprehensive analysis (Cloud Logging may have higher limits, adjust as needed)
2. **Always filter by timestamp** to reduce noise and improve query performance
3. **Save logs to file** instead of piping directly - makes re-analysis faster
4. **Use `jq` for JSON parsing** - it's much faster than shell text processing
5. **Sort timestamps** with `| sort` when order matters for timing analysis
6. **Check both `textPayload` and `jsonPayload.message`** - logs may appear in either field

## Troubleshooting

### "No logs found"
- Check service name spelling: `gcloud run services list`
- Verify timestamp format: `YYYY-MM-DDTHH:MM:SSZ`
- Check authentication: `gcloud auth list`

### "Invalid filter syntax"
- Use single quotes around the entire filter
- Capitalize `AND`, `OR` operators
- Escape quotes in nested strings

### "jq parse error"
- Verify JSON file is valid: `jq . /tmp/staging_logs.json | head`
- Check for truncated output (file size limits)
- Use `--limit` to reduce log volume

## See Also

- [Google Cloud Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language)
- [gcloud logging read documentation](https://cloud.google.com/sdk/gcloud/reference/logging/read)
- [jq manual](https://stedolan.github.io/jq/manual/)
