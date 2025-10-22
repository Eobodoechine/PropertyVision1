#!/bin/bash

###############################################################################
# Canary Test for Stabilization Deployment
#
# Tests the rate limiting, circuit breaker, and probe infrastructure
# by submitting a known test address and verifying logs.
#
# Usage:
#   ./scripts/test-canary-stabilization.sh
###############################################################################

set -e

# Configuration
API_BASE="https://propertyvision-frontend-staging-mfendrgxxa-uc.a.run.app"
TEST_ADDRESS="2835 tyler dewayne ct, snellville ga 30078"
EMAIL="test@example.com"
PROJECT_ID="durable-ring-475417-g0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🧪 Canary Test: Stabilization Deployment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "API Base:      $API_BASE"
echo "Test Address:  $TEST_ADDRESS"
echo ""

# Step 1: Submit job
echo -e "${BLUE}📝 Step 1: Submitting canary test job...${NC}"
SUBMIT_RESPONSE=$(curl -s -X POST "$API_BASE/api/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$TEST_ADDRESS\", \"email\": \"$EMAIL\"}")

JOB_ID=$(echo "$SUBMIT_RESPONSE" | jq -r '.jobId')

if [ -z "$JOB_ID" ] || [ "$JOB_ID" == "null" ]; then
  echo -e "${RED}❌ Failed to create job${NC}"
  echo "$SUBMIT_RESPONSE" | jq '.'
  exit 1
fi

echo -e "${GREEN}✅ Job created: $JOB_ID${NC}"
echo ""

# Step 2: Poll job status
echo -e "${BLUE}📊 Step 2: Polling job progress...${NC}"
echo ""

STATUS="queued"
COUNT=0
MAX_POLLS=120  # 4 minutes max (2s interval)

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
if [ "$STATUS" != "completed" ]; then
  echo -e "${RED}❌ Job did not complete successfully${NC}"
  echo "Final status: $STATUS"
  if [ "$STATUS" == "failed" ]; then
    ERROR=$(echo "$STATUS_RESPONSE" | jq -r '.error')
    echo "Error: $ERROR"
  fi
  exit 1
fi

echo -e "${GREEN}✅ Job completed successfully!${NC}"
echo ""

# Step 4: Download logs
echo -e "${BLUE}📥 Step 3: Downloading job logs...${NC}"
./scripts/download-job-logs.sh "$JOB_ID" "logs/canary-${JOB_ID}.json"
echo ""

# Step 5: Verify probes
echo -e "${BLUE}🔍 Step 4: Verifying stabilization probes...${NC}"
./scripts/verify-stabilization-probes.sh "$JOB_ID" "logs/canary-${JOB_ID}.json"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ CANARY TEST PASSED${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  ❌ CANARY TEST FAILED${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
fi

echo ""
echo "Job ID:    $JOB_ID"
echo "Log file:  logs/canary-${JOB_ID}.json"
echo ""

exit $EXIT_CODE
