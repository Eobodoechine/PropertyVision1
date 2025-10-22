#!/bin/bash

###############################################################################
# Verify Stabilization Probes
#
# Analyzes job logs to verify the stabilization deployment is working:
# - No 429 errors
# - No MAX_TOKENS truncation
# - Circuit breaker never opened
# - All expected probes present
#
# Usage:
#   ./scripts/verify-stabilization-probes.sh <JOB_ID> [LOG_FILE]
#
# Examples:
#   ./scripts/verify-stabilization-probes.sh d0a6e4a0-8e29-4ca2-99de-d927f5e5530e
#   ./scripts/verify-stabilization-probes.sh d0a6e4a0 logs/my-logs.json
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
if [ $# -lt 1 ]; then
  echo -e "${RED}❌ Missing required argument: JOB_ID${NC}"
  echo ""
  echo "Usage: $0 <JOB_ID> [LOG_FILE]"
  exit 1
fi

JOB_ID="$1"
LOG_FILE="${2:-logs/job-${JOB_ID}.json}"

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
  echo -e "${RED}❌ Log file not found: $LOG_FILE${NC}"
  echo ""
  echo "Download logs first:"
  echo "  ./scripts/download-job-logs.sh $JOB_ID"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ jq is not installed${NC}"
  echo "Install: brew install jq"
  exit 1
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🔍 Verifying Stabilization Probes${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Job ID:    $JOB_ID"
echo "Log File:  $LOG_FILE"
echo ""

# Extract all JSON probes from logs
PROBES_FILE="/tmp/probes-${JOB_ID}.json"
jq -r '.[] | select(.textPayload | tostring | contains("\"probe\":")) | .textPayload' "$LOG_FILE" 2>/dev/null > "$PROBES_FILE" || true

# Count total log entries
TOTAL_LOGS=$(jq 'length' "$LOG_FILE")
echo -e "${BLUE}📊 Log Statistics:${NC}"
echo "  Total log entries: $TOTAL_LOGS"
echo ""

# Initialize test results
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# Helper function to report test result
test_result() {
  local name="$1"
  local status="$2"  # PASS, FAIL, WARN
  local message="$3"

  if [ "$status" == "PASS" ]; then
    echo -e "  ${GREEN}✅ $name${NC}"
    [ -n "$message" ] && echo -e "     ${message}"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [ "$status" == "FAIL" ]; then
    echo -e "  ${RED}❌ $name${NC}"
    [ -n "$message" ] && echo -e "     ${RED}${message}${NC}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else  # WARN
    echo -e "  ${YELLOW}⚠️  $name${NC}"
    [ -n "$message" ] && echo -e "     ${YELLOW}${message}${NC}"
    WARN_COUNT=$((WARN_COUNT + 1))
  fi
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🧪 Test Results${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Test 1: DEDUP_CALL probe exists
DEDUP_CALL_COUNT=$(grep -c '"probe":"DEDUP_CALL"' "$PROBES_FILE" 2>/dev/null || echo "0")
if [ "$DEDUP_CALL_COUNT" -gt 0 ]; then
  # Extract maxOutputTokens from first DEDUP_CALL
  MAX_TOKENS=$(grep '"probe":"DEDUP_CALL"' "$PROBES_FILE" | head -1 | jq -r '.maxOutputTokens' 2>/dev/null || echo "0")
  if [ "$MAX_TOKENS" == "4096" ]; then
    test_result "DEDUP_CALL probe" "PASS" "maxOutputTokens=4096 (correct)"
  else
    test_result "DEDUP_CALL probe" "FAIL" "maxOutputTokens=$MAX_TOKENS (expected 4096)"
  fi
else
  test_result "DEDUP_CALL probe" "FAIL" "Probe not found in logs"
fi

# Test 2: DEDUP_RESULT probe exists and no MAX_TOKENS
DEDUP_RESULT_COUNT=$(grep -c '"probe":"DEDUP_RESULT"' "$PROBES_FILE" 2>/dev/null || echo "0")
if [ "$DEDUP_RESULT_COUNT" -gt 0 ]; then
  FINISH_REASON=$(grep '"probe":"DEDUP_RESULT"' "$PROBES_FILE" | head -1 | jq -r '.finishReason' 2>/dev/null || echo "")
  if [ "$FINISH_REASON" == "COMPLETE" ]; then
    test_result "DEDUP_RESULT probe" "PASS" "finishReason=COMPLETE (no truncation)"
  elif [ "$FINISH_REASON" == "MAX_TOKENS" ]; then
    test_result "DEDUP_RESULT probe" "FAIL" "finishReason=MAX_TOKENS (JSON truncated!)"
  else
    test_result "DEDUP_RESULT probe" "WARN" "finishReason=$FINISH_REASON"
  fi
else
  test_result "DEDUP_RESULT probe" "FAIL" "Probe not found in logs"
fi

# Test 3: DEDUP_ERROR probe - check for 429 errors
DEDUP_ERROR_COUNT=$(grep -c '"probe":"DEDUP_ERROR"' "$PROBES_FILE" 2>/dev/null || echo "0")
if [ "$DEDUP_ERROR_COUNT" -eq 0 ]; then
  test_result "DEDUP_ERROR (429 check)" "PASS" "No dedup errors found"
else
  # Check if any errors are 429
  ERROR_429_COUNT=$(grep '"probe":"DEDUP_ERROR"' "$PROBES_FILE" | grep -c '"code":429' 2>/dev/null || echo "0")
  if [ "$ERROR_429_COUNT" -eq 0 ]; then
    test_result "DEDUP_ERROR (429 check)" "WARN" "$DEDUP_ERROR_COUNT errors, but none are 429"
  else
    test_result "DEDUP_ERROR (429 check)" "FAIL" "$ERROR_429_COUNT x 429 errors found!"
  fi
fi

# Test 4: ARV_INPUT probe exists
ARV_INPUT_COUNT=$(grep -c '"probe":"ARV_INPUT"' "$PROBES_FILE" 2>/dev/null || echo "0")
if [ "$ARV_INPUT_COUNT" -gt 0 ]; then
  COMPS_IN=$(grep '"probe":"ARV_INPUT"' "$PROBES_FILE" | head -1 | jq -r '.compsIn' 2>/dev/null || echo "0")
  if [ "$COMPS_IN" -gt 0 ]; then
    test_result "ARV_INPUT probe" "PASS" "compsIn=$COMPS_IN"
  else
    test_result "ARV_INPUT probe" "WARN" "compsIn=0 (no comps found?)"
  fi
else
  test_result "ARV_INPUT probe" "FAIL" "Probe not found in logs"
fi

# Test 5: ARV_OUTPUT probe exists
ARV_OUTPUT_COUNT=$(grep -c '"probe":"ARV_OUTPUT"' "$PROBES_FILE" 2>/dev/null || echo "0")
if [ "$ARV_OUTPUT_COUNT" -gt 0 ]; then
  ARV_METHOD=$(grep '"probe":"ARV_OUTPUT"' "$PROBES_FILE" | head -1 | jq -r '.method' 2>/dev/null || echo "")
  CONSERVATIVE=$(grep '"probe":"ARV_OUTPUT"' "$PROBES_FILE" | head -1 | jq -r '.conservativePrice' 2>/dev/null || echo "0")
  AGGRESSIVE=$(grep '"probe":"ARV_OUTPUT"' "$PROBES_FILE" | head -1 | jq -r '.aggressivePrice' 2>/dev/null || echo "0")

  if [ "$CONSERVATIVE" != "null" ] && [ "$CONSERVATIVE" != "0" ]; then
    test_result "ARV_OUTPUT probe" "PASS" "method=$ARV_METHOD, price=\$$CONSERVATIVE"
  elif [ "$AGGRESSIVE" != "null" ] && [ "$AGGRESSIVE" != "0" ]; then
    test_result "ARV_OUTPUT probe" "PASS" "method=$ARV_METHOD, price=\$$AGGRESSIVE"
  else
    test_result "ARV_OUTPUT probe" "WARN" "method=$ARV_METHOD, but no valid price"
  fi
else
  test_result "ARV_OUTPUT probe" "FAIL" "Probe not found in logs"
fi

# Test 6: Circuit breaker never opened
BREAKER_OPEN_COUNT=$(jq -r '.[] | select(.textPayload | tostring | contains("Circuit breaker OPEN")) | .textPayload' "$LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$BREAKER_OPEN_COUNT" -eq 0 ]; then
  test_result "Circuit Breaker" "PASS" "Never opened"
else
  test_result "Circuit Breaker" "FAIL" "Opened $BREAKER_OPEN_COUNT times"
fi

# Test 7: Rate limiter working
RATE_LIMIT_COUNT=$(jq -r '.[] | select(.textPayload | tostring | contains("Vertex rate limiter initialized")) | .textPayload' "$LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$RATE_LIMIT_COUNT" -gt 0 ]; then
  test_result "Rate Limiter" "PASS" "Initialized"
else
  test_result "Rate Limiter" "WARN" "Not found in logs (may be in different log stream)"
fi

# Test 8: No 429 errors in general logs
GENERAL_429_COUNT=$(jq -r '.[] | select(.textPayload | tostring | contains("429")) | .textPayload' "$LOG_FILE" 2>/dev/null | grep -c "429" || echo "0")
if [ "$GENERAL_429_COUNT" -eq 0 ]; then
  test_result "General 429 Errors" "PASS" "None found"
else
  test_result "General 429 Errors" "FAIL" "$GENERAL_429_COUNT occurrences"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  📊 Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}✅ Passed:  $PASS_COUNT${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: $WARN_COUNT${NC}"
echo -e "  ${RED}❌ Failed:  $FAIL_COUNT${NC}"
echo ""

# Cleanup
rm -f "$PROBES_FILE"

# Exit with appropriate code
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo -e "${RED}Verification FAILED${NC}"
  exit 1
elif [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}Verification PASSED with warnings${NC}"
  exit 0
else
  echo -e "${GREEN}Verification PASSED${NC}"
  exit 0
fi
