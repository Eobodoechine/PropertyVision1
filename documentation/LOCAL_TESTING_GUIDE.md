# Local ARV Testing Guide

Complete guide for running and debugging ARV analysis locally with full Cloud Logging integration.

## Overview

This guide covers how to run full ARV (After Repair Value) analysis locally on your machine with:
- Real Vertex AI API calls
- Redis caching with performance tracking
- Cloud Logging integration for debugging
- Log download and analysis tools

## Prerequisites

### 1. Service Account Credentials

A service account key for `pv-worker-staging-sa` already exists at `/tmp/pv-worker-staging-sa-key.json`.

**To verify the key exists:**
```bash
ls -lh /tmp/pv-worker-staging-sa-key.json
```

**If the key is missing or expired, create a new one:**
```bash
gcloud iam service-accounts keys create /tmp/pv-worker-staging-sa-key.json \
  --iam-account=pv-worker-staging-sa@durable-ring-475417-g0.iam.gserviceaccount.com
```

**Important:** This key provides access to:
- Vertex AI API (for grounded search)
- Cloud Logging API (for log writing)
- Redis (for caching)

### 2. Required Environment Variables

Set these variables before running local tests:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/pv-worker-staging-sa-key.json
export GOOGLE_CLOUD_PROJECT=durable-ring-475417-g0
```

### 3. Redis Connection

Ensure Redis is accessible. The local test runner will automatically connect to the configured Redis instance (typically the staging Redis).

## Running Local Tests

### Quick Start

Run a full ARV analysis for any address:

```bash
cd PropertyVision1

# Set up authentication
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/pv-worker-staging-sa-key.json
export GOOGLE_CLOUD_PROJECT=durable-ring-475417-g0

# Run the test
echo "2835 tyler dewayne ct, snellville ga 30078" | npx tsx scripts/run-local-arv.ts
```

### What Happens During a Test Run

1. **Job ID Generation**: A unique UUID is generated and displayed at startup
   ```
   🆔 Job ID: ea9e9232-b4a3-4b5d-8676-72e7e4c0fb0b
   ```

2. **Analysis Execution**: Full ARV analysis runs with:
   - Subject property research via Vertex AI
   - Parallel comparable search (4 levels simultaneously)
   - Deduplication and qualification
   - ARV calculation with confidence scoring

3. **Real-time Logging**: All logs appear in:
   - **Console**: Immediate feedback with `[job-id-prefix]` tags
   - **Cloud Logging**: Written to `local-arv-test` log for persistent storage

4. **Results Display**: Summary shows:
   - ARV estimates (base and 2-bath upgrade)
   - Qualified comparables count
   - Cache performance (hits/misses)
   - Probe breakdown by type

### Interactive Mode

For interactive testing with custom addresses:

```bash
# Set up authentication
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/pv-worker-staging-sa-key.json
export GOOGLE_CLOUD_PROJECT=durable-ring-475417-g0

# Run without piping - will prompt for address
npx tsx scripts/run-local-arv.ts

# Enter your address when prompted:
📍 Enter address: 123 main street, atlanta ga 30308
```

## Viewing Logs

### During Test Execution

Watch console output for real-time feedback:
- `[ea9e9232]` prefix shows job ID (first 8 chars)
- Progress indicators for each analysis phase
- Cache hit/miss notifications
- Final summary with statistics

### In Cloud Logging Console

View logs in Google Cloud Console:

1. Go to [Cloud Logging](https://console.cloud.google.com/logs)
2. Use this filter:
   ```
   logName="projects/durable-ring-475417-g0/logs/local-arv-test"
   jsonPayload.jobId="<YOUR-JOB-ID>"
   ```

### Downloading Logs for Analysis

Use the download script with the job ID shown at test start:

```bash
# Job ID is displayed at test startup
./scripts/download-job-logs.sh ea9e9232-b4a3-4b5d-8676-72e7e4c0fb0b
```

The script will:
- Download all logs for that job ID
- Save to `logs/job-<JOB_ID>.json`
- Display summary statistics
- Show cache performance metrics

## Analyzing Downloaded Logs

### View All Messages

```bash
jq -r '.[] | .textPayload // .jsonPayload.message' logs/job-<JOB_ID>.json
```

### View Cache Performance

```bash
# Count cache hits vs misses
jq -r '.[] | select(.jsonPayload.probe? | test("CACHE")) | .jsonPayload.probe' logs/job-<JOB_ID>.json | sort | uniq -c

# Example output:
#  45 VERTEX_RESULT_CACHE_CHECK
#  42 VERTEX_RESULT_CACHE_HIT
#   3 VERTEX_RESULT_CACHE_MISS
```

### View Errors Only

```bash
jq -r '.[] | select(.severity=="ERROR") | "\(.timestamp) \(.jsonPayload.message // .textPayload)"' logs/job-<JOB_ID>.json
```

### View Probe Breakdown

```bash
# Count by probe type
jq -r '.[] | select(.jsonPayload.probe?) | .jsonPayload.probe' logs/job-<JOB_ID>.json | sort | uniq -c | sort -rn
```

### View Timeline

```bash
# Chronological view with timestamps
jq -r '.[] | "\(.timestamp) [\(.jsonPayload.probe // "LOG")] \(.jsonPayload.message // .textPayload)"' logs/job-<JOB_ID>.json | head -50
```

## Cache Testing Workflow

To test cache performance improvements:

### 1. First Run (Cold Cache)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/pv-worker-staging-sa-key.json
export GOOGLE_CLOUD_PROJECT=durable-ring-475417-g0

echo "2835 tyler dewayne ct, snellville ga 30078" | npx tsx scripts/run-local-arv.ts
```

Note the:
- Total duration
- Cache miss count
- Job ID

### 2. Second Run (Warm Cache)

Run the same address again immediately:

```bash
echo "2835 tyler dewayne ct, snellville ga 30078" | npx tsx scripts/run-local-arv.ts
```

Expect to see:
- Significantly faster execution (5-10x speedup)
- High cache hit rate (90%+)
- Same quality results

### 3. Compare Performance

```bash
# Download both runs
./scripts/download-job-logs.sh <FIRST_JOB_ID>
./scripts/download-job-logs.sh <SECOND_JOB_ID>

# Compare cache stats
echo "First run (cold cache):"
jq -r '.[] | select(.jsonPayload.probe? | test("CACHE_HIT")) | .jsonPayload.probe' logs/job-<FIRST_JOB_ID>.json | wc -l

echo "Second run (warm cache):"
jq -r '.[] | select(.jsonPayload.probe? | test("CACHE_HIT")) | .jsonPayload.probe' logs/job-<SECOND_JOB_ID>.json | wc -l
```

## Common Test Scenarios

### Test Specific Property Type

```bash
# Single-family home
echo "123 oak street, atlanta ga 30308" | npx tsx scripts/run-local-arv.ts

# Condo
echo "456 peachtree st unit 3b, atlanta ga 30308" | npx tsx scripts/run-local-arv.ts

# Townhouse
echo "789 maple court, decatur ga 30030" | npx tsx scripts/run-local-arv.ts
```

### Test Edge Cases

```bash
# New construction (recent year built)
echo "321 modern ave, roswell ga 30075" | npx tsx scripts/run-local-arv.ts

# Unusual configuration
echo "555 loft ln, atlanta ga 30318" | npx tsx scripts/run-local-arv.ts

# Rural/sparse data area
echo "100 country road, jasper ga 30143" | npx tsx scripts/run-local-arv.ts
```

### Stress Testing

Run multiple tests in succession to verify:
- Cache stability
- Redis connection handling
- Memory management

```bash
for addr in \
  "2835 tyler dewayne ct, snellville ga 30078" \
  "123 main st, atlanta ga 30308" \
  "456 elm street, marietta ga 30060"
do
  echo "Testing: $addr"
  echo "$addr" | npx tsx scripts/run-local-arv.ts
  echo "---"
done
```

## Troubleshooting

### Authentication Errors

**Error**: `Permission denied` or `PERMISSION_DENIED`

**Solution**: Verify service account key is set:
```bash
echo $GOOGLE_APPLICATION_CREDENTIALS
# Should show: /tmp/pv-worker-staging-sa-key.json

# Verify file exists
ls -lh $GOOGLE_APPLICATION_CREDENTIALS
```

### Empty Vertex Responses

**Error**: Grounded search returns 0 characters

**Solution**: Check service account has Vertex AI permissions:
```bash
gcloud projects get-iam-policy durable-ring-475417-g0 \
  --flatten="bindings[].members" \
  --filter="bindings.members:pv-worker-staging-sa@*" \
  --format="table(bindings.role)"
```

Should include: `roles/aiplatform.user`

### Logs Not Appearing in Cloud

**Error**: No logs showing in Cloud Logging after test

**Solution**: Verify environment variable is set:
```bash
echo $NODE_ENV
# Should show: development (automatically set by run-local-arv.ts)

echo $GOOGLE_CLOUD_PROJECT
# Should show: durable-ring-475417-g0
```

### Redis Connection Failures

**Error**: `Redis connection failed` or timeout errors

**Solution**:
1. Check VPN/network connection to staging environment
2. Verify Redis credentials in environment
3. Check Redis instance is running:
   ```bash
   redis-cli -h <REDIS_HOST> -p <REDIS_PORT> ping
   ```

### Download Script Not Finding Logs

**Error**: `No logs found for job ID`

**Solution**:
1. Wait 1-2 minutes for logs to propagate to Cloud Logging
2. Verify job ID is correct (check console output from test)
3. Ensure test ran with Cloud Logging enabled (`GOOGLE_CLOUD_PROJECT` was set)

## Best Practices

### 1. Always Set Environment Variables

Create a helper script:

```bash
# ~/.pv-local-test-env.sh
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/pv-worker-staging-sa-key.json
export GOOGLE_CLOUD_PROJECT=durable-ring-475417-g0
```

Source before testing:
```bash
source ~/.pv-local-test-env.sh
```

### 2. Save Job IDs

Keep a log of test runs:

```bash
echo "2835 tyler dewayne ct, snellville ga 30078" | npx tsx scripts/run-local-arv.ts 2>&1 | tee /tmp/test-$(date +%Y%m%d-%H%M%S).log
```

Extract job ID later:
```bash
grep "Job ID:" /tmp/test-*.log
```

### 3. Download Logs Immediately

Download logs right after test completion for offline analysis:

```bash
# Run test
JOB_ID=$(echo "123 main st, atlanta ga" | npx tsx scripts/run-local-arv.ts 2>&1 | grep "Job ID:" | cut -d' ' -f4)

# Wait for log propagation
sleep 60

# Download logs
./scripts/download-job-logs.sh $JOB_ID
```

### 4. Compare Before/After Changes

When testing code changes:

```bash
# Baseline run
git checkout main
echo "test address" | npx tsx scripts/run-local-arv.ts
# Note job ID: baseline-job-id

# Test changes
git checkout feature-branch
echo "test address" | npx tsx scripts/run-local-arv.ts
# Note job ID: feature-job-id

# Compare
./scripts/download-job-logs.sh baseline-job-id
./scripts/download-job-logs.sh feature-job-id

# Diff analysis
diff <(jq -r '.[] | .jsonPayload.probe' logs/job-baseline-job-id.json | sort) \
     <(jq -r '.[] | .jsonPayload.probe' logs/job-feature-job-id.json | sort)
```

## Understanding the Output

### Console Output Structure

```
═══════════════════════════════════════════════════════════
  🏠 Local ARV Analysis Runner
═══════════════════════════════════════════════════════════

🆔 Job ID: ea9e9232-b4a3-4b5d-8676-72e7e4c0fb0b  # <-- Save this!

Configuration:
  RPS: 6                    # Requests per second limit
  Concurrency: 4            # Parallel request limit
  Max Attempts: 7           # Retry limit
  Cache TTL: 604800s        # 7 days cache expiration

📍 Address: 2835 tyler dewayne ct, snellville ga 30078

[Analysis phases with real-time progress...]

═══════════════════════════════════════════════════════════
  ✅ ANALYSIS COMPLETE
═══════════════════════════════════════════════════════════

📊 Results:
  Subject: 2835 Tyler Dewayne Ct, Snellville, GA 30078
  Property: 4BR/2.5BA, 2500 sqft, Built 2004

  Base ARV: $385,000 (high confidence, 12 comps)
  2-Bath ARV: $425,000 (medium confidence, 8 comps)
  Value Add: $40,000 (10.4%)

📈 Cache Performance:
  Total Calls: 48
  Cache Hits: 42 (87.5%)    # <-- High hit rate = good!
  Cache Misses: 6 (12.5%)

Duration: 245.3s

═══════════════════════════════════════════════════════════
✅ Done! To download logs, run:
   ./scripts/download-job-logs.sh ea9e9232-b4a3-4b5d-8676-72e7e4c0fb0b
═══════════════════════════════════════════════════════════
```

### Probe Types in Logs

Common probe types you'll see:

- `COMPARABLE_SEARCH_CALL`: Vertex AI search initiated
- `VERTEX_RESULT_CACHE_CHECK`: Checking if result is cached
- `VERTEX_RESULT_CACHE_HIT`: Found in cache (fast!)
- `VERTEX_RESULT_CACHE_MISS`: Not in cache (slow)
- `DEDUP_CALL`: Deduplication processing
- `VERTEX_HTTP_ATTEMPT`: HTTP request to Vertex AI
- `VERTEX_HTTP_RESPONSE`: Got response from Vertex AI
- `VERTEX_HTTP_RETRY`: Retrying after 429/error

## Next Steps

1. **Run your first test** following the Quick Start guide
2. **Download and analyze logs** to understand the analysis flow
3. **Test cache performance** by running the same address twice
4. **Experiment with different addresses** to see edge cases
5. **Compare results** with production to verify accuracy

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review downloaded logs for error details
3. Search Cloud Logging for related errors
4. Check Redis connection and Vertex AI quotas
