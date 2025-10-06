# Debugging "ARV Unavailable" Issue

## The Problem
Job `efd459c1-a840-4b63-b85c-83d6717e252a` for address "5860 Sheldon Ct Atlanta, GA 30349" completed successfully with ARV=$337,330 but frontend showed "ARV unavailable".

## How to Debug from Logs

### Step 1: Find the Job ID
When user reports an issue, get the job ID from frontend or search logs:
```bash
# Search by address
gcloud logging read 'resource.labels.service_name=propertyvision-worker AND textPayload=~"5860 Sheldon"' \
  --limit 10 --format json --project agile-device-472202-i8 | \
  jq -r '.[] | .textPayload' | grep -o 'efd459c1-[a-z0-9-]*'
```

### Step 2: Export Full Job Timeline
```bash
# Export all logs for the job to a file
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=propertyvision-worker \
  AND timestamp>=\"2025-10-05T23:34:00Z\" \
  AND timestamp<=\"2025-10-05T23:37:00Z\"" \
  --limit 10000 --format json --project agile-device-472202-i8 | \
  jq -r 'sort_by(.timestamp) | .[] | "\(.timestamp) \(.textPayload // .jsonPayload.message // "")"' | \
  grep -E "efd459c1|5860 Sheldon|Processing job|completed|ARV|Redis" > /tmp/job-debug.log
```

### Step 3: Open in VS Code for Analysis
```bash
code /tmp/job-debug.log
```

### Step 4: Look for Key Events (in chronological order)

#### A. Job Start
Search for: `⚙️  Processing job`
```
Example: ⚙️  Processing job efd459c1-a840-4b63-b85c-83d6717e252a: 5860 Sheldon Ct Atlanta, GA 30349
```
**What to check:**
- Is this log present? If not, job was never picked up from Redis Stream
- Is there more than one "Processing job" line? Means job was processed multiple times (autoclaim issue)

#### B. Subject Property Fetch
Search for: `Step 1: Subject Property Research`
```
Example: 📋 Step 1: Subject Property Research
```
**What to check:**
- Did it succeed? Look for `✅ Subject property details fetched`
- Any errors? Look for `❌ Could not fetch subject property details`

#### C. Comparable Search
Search for: `Level 0`, `Level 1`, `Level 2`
```
Example: 🔍 Level 0 added 15 raw comps
```
**What to check:**
- How many comps found at each level?
- If 0 comps found, ARV can't be calculated

#### D. ARV Calculation
Search for: `ARV Calculation`, `Conservative ARV`
```
Example: ARV: $337,330 (CentralUpperChain)
Example: 💰 Conservative ARV: $337,330
```
**What to check:**
- Is ARV calculated? What's the value?
- What method was used? (CentralUpperChain, SimpleAverage, etc.)
- How many comps used? (dataPoints)

#### E. Job Completion
Search for: `✅ Job.*completed`
```
Example: ✅ Job efd459c1-a840-4b63-b85c-83d6717e252a completed
```
**What to check:**
- How many times does this appear? Should be ONCE
- If appears multiple times → job was processed multiple times
- Check timestamps - if > 30 seconds apart, XAUTOCLAIM reclaimed the job

#### F. Redis Save
Search for: `Redis`, `setJob`, `updateJob`
```
Example: Setting job status to completed
```
**What to check:**
- Was result saved to Redis?
- Any Redis connection errors?
- Any Redis timeout errors?

### Step 5: Check Redis Directly
```bash
# Check if job result still exists
curl -s https://propertyvision-frontend-839845580521.us-central1.run.app/api/analyze/status/efd459c1-a840-4b63-b85c-83d6717e252a | jq '.'
```

**Possible responses:**
1. `{"error": "Job not found"}` → Result never saved OR expired (TTL=1 hour)
2. `{"status": "processing"}` → Job still running (stuck)
3. `{"status": "completed", "result": {...}}` → Result is there, frontend issue
4. `{"status": "failed", "error": "..."}` → Job failed

### Step 6: Common Issues and Patterns

#### Issue 1: Job Processed Twice
**Pattern in logs:**
```
23:35:10 ✅ Job efd459c1 completed
23:36:26 ✅ Job efd459c1 completed  ← 76 seconds later
```
**Root cause:** XAUTOCLAIM reaper reclaimed the job (30s idle threshold)
**Why it happens:** Job takes >30s, heartbeat fails or doesn't update stream message
**Fix:** Reduce XAUTOCLAIM idle threshold or increase heartbeat frequency

#### Issue 2: Subject Property as Comp (Distance=0)
**Pattern in logs:**
```
🔍 Enriched comp C5: address="5860 Sheldon Ct, Atlanta, GA 30349", distance=0
```
**Root cause:** Vertex AI returned subject property as a comparable
**Why it happens:** Grounded search finds recent sale of subject property
**Fix:** Filter out comps with distance < 0.05 miles OR exact address match

#### Issue 3: ARV Calculated but Not Saved
**Pattern in logs:**
```
✅ ARV Success: CentralUpperChain
ARV: $337,330
✅ Job completed
[no Redis save logs]
```
**Root cause:** updateJob() failed silently or Redis connection issue
**Why it happens:** Redis timeout, connection closed, or serialization error
**Fix:** Add error handling around updateJob(), log Redis errors explicitly

#### Issue 4: Result Expired from Redis
**Pattern:**
- Logs show successful completion
- Redis query returns "Job not found"
- Time since completion > 1 hour
**Root cause:** JOB_TTL = 3600 seconds (1 hour)
**Fix:** Increase TTL or add persistent storage (Firestore)

#### Issue 5: ARV Structure Mismatch
**Pattern in logs:**
```
ARV: $337,330
[but frontend shows "ARV unavailable"]
```
**What to check:**
```typescript
// Expected structure:
result.arv = {
  method: "CentralUpperChain",
  estimate: 337330,
  confidence: "low",
  dataPoints: 2
}

// Frontend expects:
result.arv.estimate  // number
```
**Fix:** Ensure ARV is saved as object with `estimate` property

### Step 7: Create Debugging Script

Save this for quick debugging:
```bash
#!/bin/bash
# debug-job.sh <jobId> <startTime> <endTime>

JOB_ID=$1
START_TIME=$2
END_TIME=$3

echo "=== Debugging Job: $JOB_ID ==="
echo ""

# Export logs
gcloud logging read "resource.type=cloud_run_revision \
  AND resource.labels.service_name=propertyvision-worker \
  AND timestamp>=\"$START_TIME\" \
  AND timestamp<=\"$END_TIME\"" \
  --limit 10000 --format json --project agile-device-472202-i8 | \
  jq -r 'sort_by(.timestamp) | .[] | "\(.timestamp) \(.textPayload // .jsonPayload.message // "")"' | \
  grep -E "$JOB_ID" > /tmp/job-$JOB_ID.log

echo "Logs saved to: /tmp/job-$JOB_ID.log"
echo ""

# Check Redis
echo "=== Redis Status ==="
curl -s https://propertyvision-frontend-839845580521.us-central1.run.app/api/analyze/status/$JOB_ID | jq '.'
echo ""

# Count key events
echo "=== Event Summary ==="
echo "Processing started: $(grep -c 'Processing job' /tmp/job-$JOB_ID.log)"
echo "Job completed: $(grep -c 'Job.*completed' /tmp/job-$JOB_ID.log)"
echo "ARV calculated: $(grep -c 'Conservative ARV' /tmp/job-$JOB_ID.log)"
echo "Subject fetched: $(grep -c 'Subject property details fetched' /tmp/job-$JOB_ID.log)"
echo ""

# Show ARV
echo "=== ARV Result ==="
grep "Conservative ARV\|ARV:" /tmp/job-$JOB_ID.log | head -1
echo ""

# Show timestamps
echo "=== Timeline ==="
grep "Processing job\|completed" /tmp/job-$JOB_ID.log | head -10
echo ""

# Open in VS Code
code /tmp/job-$JOB_ID.log
```

Usage:
```bash
chmod +x debug-job.sh
./debug-job.sh efd459c1-a840-4b63-b85c-83d6717e252a "2025-10-05T23:34:00Z" "2025-10-05T23:37:00Z"
```

## Findings for This Specific Issue

### Job: efd459c1-a840-4b63-b85c-83d6717e252a

1. **Job completed TWICE:**
   - First: 23:35:10 UTC
   - Second: 23:36:26 UTC (76 seconds later)
   - **Diagnosis:** XAUTOCLAIM reclaimed job thinking it was stuck

2. **ARV calculated successfully:**
   - ARV: $337,330
   - Method: CentralUpperChain
   - Subject sqft: 2088
   - PPSF: $161.56

3. **Subject property appeared as comp:**
   - Address: "5860 Sheldon Ct, Atlanta, GA 30349"
   - Distance: 0 miles
   - **Problem:** Should be filtered out

4. **Redis result not available:**
   - Query returns: `{"error": "Job not found"}`
   - **Possible causes:**
     - Result expired (>1 hour old)
     - Result never saved due to double-processing
     - Redis connection issue during save

## Recommended Fixes

1. **Add address filtering** to prevent subject as comp
2. **Fix XAUTOCLAIM timing** to prevent double processing
3. **Add explicit Redis save logging** to track when results are stored
4. **Increase TTL** or add Firestore persistence for job results
5. **Add retry logic** for Redis saves with error logging
