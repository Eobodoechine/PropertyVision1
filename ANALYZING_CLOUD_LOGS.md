# Analyzing Cloud Run Logs for Performance Metrics

This guide explains how to extract and analyze timing data from Google Cloud logs to understand job performance.

## Prerequisites

- `gcloud` CLI installed and authenticated
- `jq` for JSON processing
- `node` for running analysis scripts

## CRITICAL: How to Find the Latest Job Logs (Step-by-Step)

**ALWAYS follow this exact workflow to find logs for the most recent job run:**

### Step 1: Fetch Recent Logs with Timestamp Filter

```bash
# Fetch logs from the last few hours (adjust timestamp to cover your test window)
gcloud logging read 'resource.type="global"
  AND timestamp>="2025-10-08T18:00:00Z"' \
  --limit 10000 --format json > /tmp/recent_global_logs.json
```

**Important Notes:**
- Local worker logs have `resource.type="global"` (NOT `"cloud_run_revision"`)
- Cloud Run production logs have `resource.type="cloud_run_revision"`
- Use a timestamp that covers when you ran your test (check current time with `date -u`)

### Step 2: Find ALL Job IDs in the Time Window

```bash
# Extract all unique job IDs from the fetched logs
cat /tmp/recent_global_logs.json | jq -r '.[] | select(.jsonPayload.metadata.jobId) | .jsonPayload.metadata.jobId' | sort -u
```

This will show you ALL job IDs in that time window (there may be multiple if you ran tests multiple times).

### Step 3: Identify the LATEST Job ID

```bash
# Sort by timestamp to find which job ID is most recent
cat /tmp/recent_global_logs.json | jq -r '.[] | select(.jsonPayload.metadata.jobId) | "\(.timestamp) | \(.jsonPayload.metadata.jobId)"' | sort | tail -5
```

The job ID with the **newest timestamps** is the latest run.

### Step 4: Export Full Logs for the Latest Job

```bash
# Use the export script with the latest job ID
./export-job-logs.sh <LATEST_JOB_ID>
```

This creates:
- `logs-merged-<JOB_ID>.json` - Full structured logs
- `logs-console-<JOB_ID>.txt` - Human-readable format (newest first)

### Step 5: Analyze the Logs

```bash
# View the console logs to understand what happened
cat logs-console-<JOB_ID>.txt | grep -E "(FULL VERTEX RESPONSE|Winner|beds=|baths=|ERROR)"
```

## Structured Logging with Job ID Correlation

### How Job IDs are Included in Logs

All console.log() calls in the application automatically include structured metadata thanks to our Winston logger setup in `src/server/utils/logger.ts`:

**Key Features:**
- **Job ID**: Cloud Run logs use `jsonPayload.jobId`, local worker logs use `jsonPayload.metadata.jobId`
- **Address**: Included in `jsonPayload.address` or `jsonPayload.metadata.address` for easy filtering
- **Trace ID**: Included via `logging.googleapis.com/trace` for request correlation across services
- **Resource Type**: `cloud_run_revision` for Cloud Run, `global` for local worker

**Example Cloud Run Log Structure:**
```json
{
  "jsonPayload": {
    "message": "🚀 OPTIMIZED SPD: Parallel Primary + County fetch",
    "source": "console.log",
    "jobId": "9c483aed-bd1e-4b58-a49c-5495b0a3c2d6",
    "address": "2369 Three Bars Dr, Snellville, GA 30078"
  },
  "resource": {
    "type": "cloud_run_revision",
    "labels": {"service_name": "propertyvision-worker"}
  },
  "timestamp": "2025-10-08T05:33:00.670Z"
}
```

**Example Local Worker Log Structure:**
```json
{
  "jsonPayload": {
    "message": "🚀 OPTIMIZED SPD: Parallel Primary + County fetch",
    "metadata": {
      "source": "console.log",
      "environment": "development",
      "jobId": "b918bf79-917a-4223-8a79-bf12ab1911a1",
      "address": "1100 Water Shine Way, Snellville, GA 30078"
    }
  },
  "resource": {
    "type": "global",
    "labels": {"project_id": "agile-device-472202-i8"}
  },
  "timestamp": "2025-10-08T18:45:35.892Z"
}
```

**Benefits:**
- ✅ All logs (local AND Cloud Run) are sent to Cloud Logging automatically
- ✅ Filter by `jsonPayload.jobId` (Cloud Run) or `jsonPayload.metadata.jobId` (local)
- ✅ No need to search text payloads for job IDs
- ✅ Faster and more reliable log correlation
- ✅ Works with `export-job-logs.sh` script to fetch all logs for a specific job

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

**Filter by Job ID (RECOMMENDED):**
```bash
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="propertyvision-worker"
  AND jsonPayload.jobId="9c483aed-bd1e-4b58-a49c-5495b0a3c2d6"' \
  --limit 5000 --format json
```

**Filter by severity:**
```bash
'resource.type="cloud_run_revision" AND severity>=ERROR'
```

**Filter by text content:**
```bash
'resource.type="cloud_run_revision" AND textPayload=~"geocode.*timeout"'
```

**Filter by address:**
```bash
'resource.type="cloud_run_revision"
  AND jsonPayload.address:"2369 Three Bars Dr"'
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

## Using export-job-logs.sh Script

The easiest way to fetch logs for a specific job is to use the `export-job-logs.sh` script:

### Quick Start
```bash
# 1. Edit the script to set your job ID
vim export-job-logs.sh
# Set: JOB_ID="your-job-id-here"
# Set: FRESHNESS="24h"  # or "1h", "72h", etc.

# 2. Run the script
bash export-job-logs.sh
```

### What It Does
- Fetches logs from all services (frontend, worker, geo-proxy, vertex-proxy)
- Filters by job ID using multiple jsonPayload fields
- Creates merged JSON file with all logs sorted by timestamp
- **NEW**: Creates human-readable console format file: `logs-console-${JOB_ID}.txt`
- Zips raw JSON files for archival

### Output Files
```
logs-propertyvision-frontend-${JOB_ID}.json  # Frontend service logs
logs-propertyvision-worker-${JOB_ID}.json    # Worker service logs (most detailed)
logs-geo-proxy-${JOB_ID}.json                # Geocoding proxy logs
logs-vertex-proxy-${JOB_ID}.json             # Vertex AI proxy logs
logs-merged-${JOB_ID}.json                   # All logs combined, sorted by time
logs-console-${JOB_ID}.txt                   # Human-readable: timestamp | message
logs-${JOB_ID}.zip                           # Compressed archive of JSON files
```

### Filter Used by Script
The script searches for the job ID in multiple locations:
```bash
(
  textPayload:"$JOB_ID"
  OR jsonPayload.message:"$JOB_ID"
  OR jsonPayload.jobId="$JOB_ID"        # ← Primary method (structured logging)
  OR jsonPayload.job_id="$JOB_ID"
  OR jsonPayload.metadata.jobId="$JOB_ID"
)
```

## Quick Reference Commands

### Find Latest Completed Job
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.jsonPayload.jobId) | .jsonPayload.jobId' | sort -u | tail -1
```

### Find All Job IDs in Logs
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.jsonPayload.jobId) | .jsonPayload.jobId' | sort -u
```

### Count Errors in Logs
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.severity == "ERROR") | .textPayload // .jsonPayload.message' | wc -l
```

### Search for Specific Error
```bash
cat /tmp/staging_logs.json | jq -r '.[] | select(.textPayload and (.textPayload | contains("geocode") and contains("failed"))) | "\(.timestamp) | \(.textPayload)"' | sort
```

### Convert JSON Logs to Console Format
```bash
cat logs-merged-${JOB_ID}.json | jq -r '.[] | "\(.timestamp) | \(.textPayload // .jsonPayload.message // "")"' | grep -v '^.*|[[:space:]]*$' > logs-console-${JOB_ID}.txt
```

## Tips

1. **Use structured logging filters first**: Filter by `jsonPayload.jobId` instead of text search for faster and more accurate results
2. **Use `--limit 10000`** for comprehensive analysis (Cloud Logging may have higher limits, adjust as needed)
3. **Always filter by timestamp** to reduce noise and improve query performance
4. **Save logs to file** instead of piping directly - makes re-analysis faster
5. **Use `jq` for JSON parsing** - it's much faster than shell text processing
6. **Sort timestamps** with `| sort` when order matters for timing analysis
7. **Check both `textPayload` and `jsonPayload.message`** - logs may appear in either field
8. **Use the export-job-logs.sh script** - it handles all the filtering and formatting automatically
9. **View logs-console-${JOB_ID}.txt for readability** - easier to scan than raw JSON

## Troubleshooting

### "No logs found" or "0 entries"

**MOST COMMON MISTAKE**: Using the wrong job ID or looking in the wrong resource type.

**Solution - Follow this checklist:**

1. **Did you fetch logs with a timestamp filter first?**
   ```bash
   # CORRECT: Fetch recent logs first with timestamp
   gcloud logging read 'resource.type="global" AND timestamp>="2025-10-08T18:00:00Z"' --limit 10000 --format json > /tmp/recent_global_logs.json

   # WRONG: Searching for job ID without knowing if it exists
   ./export-job-logs.sh some-random-job-id
   ```

2. **Did you find ALL job IDs in that time window?**
   ```bash
   # This shows you which job IDs actually exist
   cat /tmp/recent_global_logs.json | jq -r '.[] | select(.jsonPayload.metadata.jobId) | .jsonPayload.metadata.jobId' | sort -u
   ```

3. **Did you identify which job ID is the LATEST?**
   ```bash
   # Sort by timestamp to see which is newest
   cat /tmp/recent_global_logs.json | jq -r '.[] | select(.jsonPayload.metadata.jobId) | "\(.timestamp) | \(.jsonPayload.metadata.jobId)"' | sort | tail -5
   ```

4. **Are you looking in the right resource type?**
   - Local worker: `resource.type="global"`
   - Cloud Run: `resource.type="cloud_run_revision"`
   - If export-job-logs.sh returns 0 entries for all services, it falls back to searching global resource type

5. **Is the timestamp range correct?**
   ```bash
   # Check current UTC time
   date -u

   # Make sure your timestamp filter covers when you ran the test
   # Example: If test ran at 18:45 UTC, use timestamp>="2025-10-08T18:00:00Z"
   ```

### "Wrong job ID - logs don't match what I expect"

**Problem**: You grabbed a job ID from browser/local logs but it's from an old run.

**Solution**: ALWAYS use the step-by-step workflow at the top of this document to find the latest job ID from Cloud Logging timestamps, not from browser URLs or local log files.

### "No logs found for local worker"

- Local worker logs have `resource.type="global"`
- Job ID is in `jsonPayload.metadata.jobId` (NOT `jsonPayload.jobId`)
- The export-job-logs.sh script now handles this automatically (fallback to global resource type)

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
