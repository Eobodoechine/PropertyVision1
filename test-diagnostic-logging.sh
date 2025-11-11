#!/bin/bash
# Test diagnostic logging with the address from job-b330d7e4
# Address: 2612 Clairmont Rd, Atlanta, GA, 30329

set -e

echo "🧪 Testing with Diagnostic Logging Enabled"
echo "=========================================="
echo ""
echo "Test Address: 2612 Clairmont Rd, Atlanta, GA, 30329"
echo "(Same address from job-b330d7e4 that had ECONNRESET errors)"
echo ""

# Make POST request to analyze endpoint
echo "📤 Sending analyze request..."
RESPONSE=$(curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "address": "2612 Clairmont Rd, Atlanta, GA, 30329"
  }')

echo ""
echo "📩 Response:"
echo "$RESPONSE"
echo ""

# Extract job ID from response
JOB_ID=$(echo "$RESPONSE" | jq -r '.jobId // .id // empty')

if [ -z "$JOB_ID" ]; then
  echo "❌ Failed to extract job ID from response"
  echo "Response was: $RESPONSE"
  exit 1
fi

echo "✅ Job created: $JOB_ID"
echo ""
echo "⏳ Waiting for job to complete (checking every 10 seconds)..."
echo ""

# Poll job status
MAX_WAIT=600  # 10 minutes
ELAPSED=0
INTERVAL=10

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS_RESPONSE=$(curl -s "http://localhost:3000/api/status?jobId=$JOB_ID")
  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // empty')

  echo "[$(date +%H:%M:%S)] Status: $STATUS"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "COMPLETED" ]; then
    echo ""
    echo "✅ Job completed successfully!"
    echo ""
    echo "Final response:"
    echo "$STATUS_RESPONSE" | jq '.'
    echo ""
    echo "📥 Downloading logs with diagnostic data..."
    echo ""
    ./download-job-logs.sh "$JOB_ID" "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" "local"
    echo ""
    echo "✅ Test complete! Check logs/job-${JOB_ID}-logs.txt for diagnostic output"
    exit 0
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "FAILED" ]; then
    echo ""
    echo "❌ Job failed"
    echo ""
    echo "Response:"
    echo "$STATUS_RESPONSE" | jq '.'
    echo ""
    echo "📥 Downloading logs to investigate..."
    ./download-job-logs.sh "$JOB_ID" "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" "local"
    exit 1
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo ""
echo "⏰ Timeout waiting for job to complete"
echo "📥 Downloading partial logs..."
./download-job-logs.sh "$JOB_ID" "$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" "local"
exit 1
