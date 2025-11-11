#!/bin/bash
# Download complete logs for a specific job
# Usage: ./download-job-logs.sh <JOB_ID> [TIMESTAMP] [ENV]
#   ENV: staging (default), production, local

JOB_ID="${1:-ad73a79c}"
TIMESTAMP="${2:-2025-10-27T00:00:00Z}"
ENV="${3:-staging}"
OUTPUT_FILE="logs/job-${JOB_ID}-logs.txt"

# Determine service name based on environment
case "$ENV" in
  production|prod)
    SERVICE_NAME="propertyvision-worker"
    echo "📥 Downloading PRODUCTION logs for job ${JOB_ID} since ${TIMESTAMP}..."
    ;;
  staging|stage)
    SERVICE_NAME="propertyvision-worker-staging"
    echo "📥 Downloading STAGING logs for job ${JOB_ID} since ${TIMESTAMP}..."
    ;;
  local)
    echo "📥 Searching LOCAL logs for job ${JOB_ID}..."
    echo "🔍 Checking Cloud Logging (propertyvision-api with environment=development)..."

    # Try Cloud Logging for local dev logs
    gcloud logging read \
      "logName=\"projects/durable-ring-475417-g0/logs/propertyvision-api\" AND jsonPayload.metadata.jobId=\"${JOB_ID}\" AND timestamp>=\"${TIMESTAMP}\"" \
      --project durable-ring-475417-g0 \
      --format="value(timestamp,jsonPayload.message)" \
      --order asc \
      > "${OUTPUT_FILE}"

    CLOUD_LINES=$(wc -l < "${OUTPUT_FILE}" | tr -d ' ')

    if [ "$CLOUD_LINES" -gt 0 ]; then
      echo "✅ Found ${CLOUD_LINES} lines in Cloud Logging"
      echo "✅ Logs saved to: ${OUTPUT_FILE}"
      echo ""
      echo "Preview (first 30 lines):"
      head -30 "${OUTPUT_FILE}"
      exit 0
    fi

    echo "⚠️  No logs found in Cloud Logging, trying local worker.log..."

    # Fallback to local worker.log file
    if [ -f "worker.log" ]; then
      grep "${JOB_ID}" worker.log > "${OUTPUT_FILE}"
      LOCAL_LINES=$(wc -l < "${OUTPUT_FILE}" | tr -d ' ')

      if [ "$LOCAL_LINES" -gt 0 ]; then
        echo "✅ Found ${LOCAL_LINES} lines in local worker.log"
        echo "✅ Logs saved to: ${OUTPUT_FILE}"
        echo ""
        echo "Preview (first 30 lines):"
        head -30 "${OUTPUT_FILE}"
        exit 0
      else
        echo "❌ No logs found in worker.log for job ${JOB_ID}"
        exit 1
      fi
    else
      echo "❌ No logs found in Cloud Logging or local worker.log"
      exit 1
    fi
    ;;
  *)
    echo "❌ Invalid environment: $ENV"
    echo "Usage: ./download-job-logs.sh <JOB_ID> [TIMESTAMP] [ENV]"
    echo "  ENV: staging (default), production, local"
    exit 1
    ;;
esac

# Download from Cloud Logging
gcloud logging read \
  "resource.labels.service_name=\"${SERVICE_NAME}\" AND textPayload:\"${JOB_ID}\" AND timestamp>=\"${TIMESTAMP}\"" \
  --project durable-ring-475417-g0 \
  --format="value(timestamp,textPayload)" \
  --order asc \
  > "${OUTPUT_FILE}"

echo "✅ Logs saved to: ${OUTPUT_FILE}"
echo "📊 Total lines: $(wc -l < "${OUTPUT_FILE}")"
echo ""
echo "Preview (first 30 lines):"
head -30 "${OUTPUT_FILE}"
