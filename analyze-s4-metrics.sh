#!/bin/bash
# Phase A Metrics Analysis Script
# Usage: ./analyze-s4-metrics.sh <LOG_FILE>
# Computes 429%, first-429 lag, QPS from structured JSON logs

LOG_FILE="$1"

if [ -z "$LOG_FILE" ] || [ ! -f "$LOG_FILE" ]; then
  echo "Usage: ./analyze-s4-metrics.sh <LOG_FILE>"
  echo "Example: ./analyze-s4-metrics.sh logs/job-abc123-logs.txt"
  exit 1
fi

echo "=== Phase A Metrics Analysis ==="
echo "Log file: $LOG_FILE"
echo ""

# Extract all JSON lines
JSON_LINES=$(grep -oE '\{.*"t":[0-9]+.*"kind":"[^"]+.*\}' "$LOG_FILE")

if [ -z "$JSON_LINES" ]; then
  echo "❌ No structured JSON logs found in $LOG_FILE"
  echo "   Make sure the job was run with Phase A code changes."
  exit 1
fi

# Count API attempts (ATTEMPT_START or VERTEX_CALL_START)
ATTEMPT_COUNT=$(echo "$JSON_LINES" | grep -E '"kind":"(ATTEMPT_START|VERTEX_CALL_START)"' | wc -l | tr -d ' ')

# Count 429 errors
ERROR_429_COUNT=$(echo "$JSON_LINES" | grep '"kind":"429_DIAG"' | wc -l | tr -d ' ')

# Calculate 429%
if [ "$ATTEMPT_COUNT" -gt 0 ]; then
  ERROR_429_PCT=$(echo "scale=2; ($ERROR_429_COUNT / $ATTEMPT_COUNT) * 100" | bc)
else
  ERROR_429_PCT="0.00"
fi

# Extract first attempt timestamp (earliest t value)
FIRST_ATTEMPT_T=$(echo "$JSON_LINES" | grep -E '"kind":"(ATTEMPT_START|VERTEX_CALL_START)"' | head -1 | grep -oE '"t":[0-9]+' | cut -d: -f2)

# Extract first 429 timestamp
FIRST_429_T=$(echo "$JSON_LINES" | grep '"kind":"429_DIAG"' | head -1 | grep -oE '"t":[0-9]+' | cut -d: -f2)

# Calculate first-429 lag (in seconds)
if [ -n "$FIRST_429_T" ] && [ -n "$FIRST_ATTEMPT_T" ]; then
  FIRST_429_LAG_MS=$((FIRST_429_T - FIRST_ATTEMPT_T))
  FIRST_429_LAG_SEC=$(echo "scale=2; $FIRST_429_LAG_MS / 1000" | bc)
else
  FIRST_429_LAG_SEC="N/A"
fi

# Calculate total duration and QPS
LAST_ATTEMPT_T=$(echo "$JSON_LINES" | grep -E '"kind":"(ATTEMPT_START|VERTEX_CALL_START)"' | tail -1 | grep -oE '"t":[0-9]+' | cut -d: -f2)
if [ -n "$LAST_ATTEMPT_T" ] && [ -n "$FIRST_ATTEMPT_T" ]; then
  DURATION_MS=$((LAST_ATTEMPT_T - FIRST_ATTEMPT_T))
  DURATION_SEC=$(echo "scale=2; $DURATION_MS / 1000" | bc)
  if [ "$DURATION_SEC" != "0" ]; then
    QPS=$(echo "scale=2; $ATTEMPT_COUNT / $DURATION_SEC" | bc)
  else
    QPS="N/A"
  fi
else
  DURATION_SEC="N/A"
  QPS="N/A"
fi

# Output results
echo "📊 Metrics Summary:"
echo "  Total API Attempts:  $ATTEMPT_COUNT"
echo "  429 Errors:          $ERROR_429_COUNT"
echo "  429% Rate:           $ERROR_429_PCT%"
echo ""
echo "  First 429 Lag:       $FIRST_429_LAG_SEC seconds"
echo "  Test Duration:       $DURATION_SEC seconds"
echo "  Average QPS:         $QPS"
echo ""

# Pass/fail criteria
echo "🎯 Phase A Pass Criteria:"
PASS_429_RATE=false
PASS_FIRST_429_LAG=false

if [ "$ATTEMPT_COUNT" -gt 0 ]; then
  # Check 429% ≤ 5%
  if (( $(echo "$ERROR_429_PCT <= 5.0" | bc -l) )); then
    echo "  ✅ 429% ≤ 5%: PASS (actual: $ERROR_429_PCT%)"
    PASS_429_RATE=true
  else
    echo "  ❌ 429% ≤ 5%: FAIL (actual: $ERROR_429_PCT%)"
  fi

  # Check first-429 lag ≥ 60s (or no 429s at all)
  if [ "$FIRST_429_LAG_SEC" = "N/A" ]; then
    echo "  ✅ First-429 lag ≥ 60s: PASS (no 429 errors!)"
    PASS_FIRST_429_LAG=true
  elif (( $(echo "$FIRST_429_LAG_SEC >= 60.0" | bc -l) )); then
    echo "  ✅ First-429 lag ≥ 60s: PASS (actual: ${FIRST_429_LAG_SEC}s)"
    PASS_FIRST_429_LAG=true
  else
    echo "  ❌ First-429 lag ≥ 60s: FAIL (actual: ${FIRST_429_LAG_SEC}s)"
  fi
else
  echo "  ⚠️  No API attempts found - cannot evaluate criteria"
fi

echo ""
if [ "$PASS_429_RATE" = true ] && [ "$PASS_FIRST_429_LAG" = true ]; then
  echo "🎉 Overall: PASS"
else
  echo "❌ Overall: FAIL"
fi
