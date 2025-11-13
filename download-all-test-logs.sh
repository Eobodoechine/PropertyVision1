#!/bin/bash
# Download cloud logs for all 10 concurrent test jobs
# Test ran at: 2025-11-11T22:11:06Z

PROJECT_ID="durable-ring-475417-g0"
TIMESTAMP="2025-11-11T22:10:00Z"

# Full job IDs from test
JOBS=(
  "9655e20c-62b0-44a1-89e7-dad821479371"
  "61262621-6a5c-4efe-89e0-ebbb7231adb1"
  "8555f352-a3df-4aa1-8e56-28a38095e33f"
  "6e3e9275-e3ab-49e8-8917-9c79fbfae4b5"
  "7e9c039a-a7aa-484e-a3ed-a8829974d79e"
  "ddd8436c-a4ce-4b8c-b25d-f4c5d7768d99"
  "506e7f30-91e5-4a5f-9dc5-9bd835b6d8bb"
  "66711777-b0a5-4c5e-8bb5-b2ad91e13ea0"
  "04499b97-f21a-4cc3-abd5-87f9c74cd0f6"
  "70cf7ec7-cf02-4c79-bedb-09b92afeb8a0"
)

echo "========================================"
echo "CLOUD LOGS DOWNLOAD - CONCURRENCY TEST"
echo "========================================"
echo "Project: ${PROJECT_ID}"
echo "Timestamp: ${TIMESTAMP}"
echo "Jobs: ${#JOBS[@]}"
echo ""

for jobid in "${JOBS[@]}"; do
  short_id="${jobid:0:8}"
  output_file="logs/job-${short_id}-cloud.json"

  echo "📥 Downloading logs for job ${short_id}..."

  gcloud logging read \
    "logName=\"projects/${PROJECT_ID}/logs/propertyvision-api\" AND jsonPayload.metadata.jobId=\"${jobid}\" AND timestamp>=\"${TIMESTAMP}\"" \
    --project "${PROJECT_ID}" \
    --format=json \
    --order asc \
    > "${output_file}"

  lines=$(wc -l < "${output_file}" | tr -d ' ')

  if [ "$lines" -gt 0 ]; then
    echo "  ✅ Saved ${lines} log entries to ${output_file}"
  else
    echo "  ⚠️  No logs found for job ${short_id}"
  fi
done

echo ""
echo "✅ Download complete! All logs saved to logs/ folder"
echo ""
echo "Next step: Run ./verify-concurrency-fix.sh to analyze logs"
