#!/bin/bash
# debug-job.sh - Debug a specific job from Cloud Run logs
# Usage: ./debug-job.sh <jobId> <startTime> <endTime>
# Example: ./debug-job.sh efd459c1-a840-4b63-b85c-83d6717e252a "2025-10-05T23:34:00Z" "2025-10-05T23:37:00Z"

JOB_ID=$1
START_TIME=$2
END_TIME=$3

if [ -z "$JOB_ID" ] || [ -z "$START_TIME" ] || [ -z "$END_TIME" ]; then
  echo "Usage: $0 <jobId> <startTime> <endTime>"
  echo "Example: $0 efd459c1-a840-4b63-b85c-83d6717e252a \"2025-10-05T23:34:00Z\" \"2025-10-05T23:37:00Z\""
  exit 1
fi

echo "=== Debugging Job: $JOB_ID ==="
echo ""

# Export logs
echo "Fetching logs from Cloud Run..."
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
echo "Processing started: $(grep -c 'Processing job' /tmp/job-$JOB_ID.log || echo 0)"
echo "Job completed: $(grep -c 'Job.*completed' /tmp/job-$JOB_ID.log || echo 0)"
echo "ARV calculated: $(grep -c 'Conservative ARV' /tmp/job-$JOB_ID.log || echo 0)"
echo "Subject fetched: $(grep -c 'Subject property details fetched' /tmp/job-$JOB_ID.log || echo 0)"
echo "Total log lines: $(wc -l < /tmp/job-$JOB_ID.log)"
echo ""

# Show ARV
echo "=== ARV Result ==="
grep "Conservative ARV\|ARV:" /tmp/job-$JOB_ID.log | head -1 || echo "No ARV found"
echo ""

# Show timestamps
echo "=== Timeline ==="
grep "Processing job\|completed" /tmp/job-$JOB_ID.log | head -10 || echo "No timeline events found"
echo ""

# Show any errors
echo "=== Errors ==="
grep -i "error\|ERROR\|failed\|FAILED" /tmp/job-$JOB_ID.log | head -10 || echo "No errors found"
echo ""

# Open in VS Code
echo "Opening log in VS Code..."
code /tmp/job-$JOB_ID.log
