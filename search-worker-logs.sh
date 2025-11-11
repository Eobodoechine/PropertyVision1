#!/bin/bash
# Search worker stderr for job-specific errors

echo "Searching worker logs for job IDs..."
echo ""

# Job IDs
JOBS=(
  "0b0f81be"
  "ab410fb3"
  "752f3b95"
  "685576b7"
  "c85ea054"
)

# Extract last 20000 lines from worker process (covers our time window)
echo "Extracting worker logs..."
tail -20000 /proc/$(pgrep -f "npm run worker" | tail -1)/fd/2 2>/dev/null > /tmp/worker-recent.log || echo "Could not access /proc, using alternative method"

# Alternative: use our captured output
echo "Job ID mentions in worker logs:"
echo ""

for job in "${JOBS[@]}"; do
  echo "=== Job $job ==="
  grep -i "$job" /tmp/worker-recent.log 2>/dev/null | head -5 || echo "Not found in logs"
  echo ""
done

echo "Searching for MaxListenersExceededWarning..."
grep "MaxListenersExceededWarning" /tmp/worker-recent.log 2>/dev/null | head -10
echo ""

echo "Searching for GeminiParser failures..."
grep "GeminiParser: Failed" /tmp/worker-recent.log 2>/dev/null | head -10

