#!/bin/bash

# Test Progress Tracking via API
# Tests the new progress tracking endpoints locally or on staging

# Configuration
API_BASE="${API_BASE:-http://localhost:3000}"
ADDRESS="430 Burgundy Drive, Madison, AL 35758"
EMAIL="test@example.com"

echo "🧪 Testing Progress Tracking API"
echo "API Base: $API_BASE"
echo ""

# Step 1: Submit job
echo "📝 Step 1: Submitting analysis job..."
SUBMIT_RESPONSE=$(curl -s -X POST "$API_BASE/api/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$ADDRESS\", \"email\": \"$EMAIL\"}")

JOB_ID=$(echo "$SUBMIT_RESPONSE" | jq -r '.jobId')

if [ -z "$JOB_ID" ] || [ "$JOB_ID" == "null" ]; then
  echo "❌ Failed to create job"
  echo "$SUBMIT_RESPONSE" | jq '.'
  exit 1
fi

echo "✅ Job created: $JOB_ID"
echo ""

# Step 2: Poll job status
echo "📊 Step 2: Polling job progress..."
echo ""

STATUS="queued"
COUNT=0
MAX_POLLS=60

while [ "$STATUS" != "completed" ] && [ "$STATUS" != "failed" ] && [ $COUNT -lt $MAX_POLLS ]; do
  sleep 2

  STATUS_RESPONSE=$(curl -s "$API_BASE/api/analyze/status/$JOB_ID")
  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status')
  PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress // 0')
  PHASE=$(echo "$STATUS_RESPONSE" | jq -r '.phase // "Unknown"')
  MESSAGE=$(echo "$STATUS_RESPONSE" | jq -r '.phaseMessage // ""')
  ETA=$(echo "$STATUS_RESPONSE" | jq -r '.estimatedTimeRemaining // 0')

  TIMESTAMP=$(date "+%H:%M:%S")
  printf "[%s] %3d%% | %-30s | %s | ETA: %ds\n" "$TIMESTAMP" "$PROGRESS" "$PHASE" "$MESSAGE" "$ETA"

  COUNT=$((COUNT + 1))
done

echo ""

# Step 3: Check final result
if [ "$STATUS" == "completed" ]; then
  echo "✅ Job completed successfully!"
  echo ""
  echo "Final Result:"
  curl -s "$API_BASE/api/analyze/status/$JOB_ID" | jq '.result | {subject: .subject.address, comps: (.qualified_comps | length), arv: .arv.estimate}'
elif [ "$STATUS" == "failed" ]; then
  echo "❌ Job failed"
  ERROR=$(echo "$STATUS_RESPONSE" | jq -r '.error')
  echo "Error: $ERROR"
else
  echo "⏱️  Timeout after ${COUNT} polls (${COUNT}s)"
fi

echo ""
echo "🧪 Test complete"
