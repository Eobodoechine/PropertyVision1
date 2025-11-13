#!/bin/bash
# Verify concurrency fix by analyzing downloaded cloud logs
# Checks for custom HTTP agent, semaphore, and absence of memory leak warnings

echo "========================================"
echo "CONCURRENCY FIX VERIFICATION REPORT"
echo "========================================"
echo "Date: $(date)"
echo "Test: 10 concurrent jobs for address 1395 Athens Ave SW, Atlanta, GA 30310"
echo ""

# Combine all job logs for analysis
combined_logs="/tmp/all-test-logs-combined.txt"
> "$combined_logs"

echo "📂 Combining all job logs..."
for logfile in logs/job-*-cloud.json; do
  if [ -f "$logfile" ]; then
    # Extract message field from JSON logs
    jq -r '.[] | .jsonPayload.message // .textPayload // ""' "$logfile" 2>/dev/null >> "$combined_logs"
  fi
done

total_lines=$(wc -l < "$combined_logs" | tr -d ' ')
echo "✅ Combined ${total_lines} log lines from all jobs"
echo ""

# Verification checks
echo "🔍 VERIFICATION CHECKS"
echo "========================================"

# 1. Check for custom HTTP agent
agent_config=$(grep -c "\[AGENT_CONFIG\] maxSockets=10" "$combined_logs")
if [ "$agent_config" -gt 0 ]; then
  echo "✅ Custom HTTP Agent Active (found ${agent_config} occurrences)"
  grep "\[AGENT_CONFIG\]" "$combined_logs" | head -1
else
  echo "❌ Custom HTTP Agent NOT FOUND"
fi
echo ""

# 2. Check for concurrency config
concurrency_config=$(grep -c "\[CONCURRENCY_CONFIG\] Max concurrent jobs: 3" "$combined_logs")
if [ "$concurrency_config" -gt 0 ]; then
  echo "✅ Semaphore Concurrency Control Active (found ${concurrency_config} occurrences)"
  grep "\[CONCURRENCY_CONFIG\]" "$combined_logs" | head -1
else
  echo "❌ Semaphore Concurrency Config NOT FOUND"
fi
echo ""

# 3. Check for semaphore slot acquisition
semaphore_acquired=$(grep -c "\[SEMAPHORE_ACQUIRED\]" "$combined_logs")
if [ "$semaphore_acquired" -ge 10 ]; then
  echo "✅ Semaphore Slot Acquisition Working (${semaphore_acquired} acquisitions for 10 jobs)"
else
  echo "⚠️  Semaphore Acquisitions: ${semaphore_acquired} (expected ≥10)"
fi
echo ""

# 4. Check for semaphore waiting (jobs had to wait for slots)
semaphore_waiting=$(grep -c "\[SEMAPHORE_WAITING\]" "$combined_logs")
if [ "$semaphore_waiting" -gt 0 ]; then
  echo "✅ Semaphore Queue Working (${semaphore_waiting} jobs waited for slots)"
  echo "   This proves max concurrency limit (3) was enforced"
else
  echo "ℹ️  No jobs waited for slots (all 3 slots were available)"
fi
echo ""

# 5. Check for semaphore release
semaphore_released=$(grep -c "\[SEMAPHORE_RELEASE\]" "$combined_logs")
echo "📊 Semaphore Releases: ${semaphore_released}"
echo ""

# 6. CRITICAL: Check for MaxListenersExceededWarning
max_listeners_warning=$(grep -c "MaxListenersExceededWarning" "$combined_logs")
if [ "$max_listeners_warning" -eq 0 ]; then
  echo "✅ NO MaxListenersExceededWarning Found (MEMORY LEAK ELIMINATED)"
else
  echo "❌ MaxListenersExceededWarning STILL PRESENT (${max_listeners_warning} occurrences)"
  grep "MaxListenersExceededWarning" "$combined_logs" | head -5
fi
echo ""

# 7. Check for VERTEX_EMPTY_RESPONSE errors
empty_response=$(grep -c "VERTEX_EMPTY_RESPONSE" "$combined_logs")
if [ "$empty_response" -gt 0 ]; then
  echo "⚠️  Vertex Empty Responses: ${empty_response} (may indicate rate limiting)"
else
  echo "✅ No Vertex Empty Responses"
fi
echo ""

# 8. Check for job completions
job_completed=$(grep -c "Job.*completed successfully" "$combined_logs")
echo "📊 Job Completions: ${job_completed}/10"
echo ""

# Summary
echo "========================================"
echo "SUMMARY"
echo "========================================"

success=true

if [ "$agent_config" -eq 0 ]; then
  echo "❌ FAIL: Custom HTTP agent not found"
  success=false
fi

if [ "$concurrency_config" -eq 0 ]; then
  echo "❌ FAIL: Concurrency config not found"
  success=false
fi

if [ "$semaphore_acquired" -lt 10 ]; then
  echo "⚠️  WARNING: Not all jobs acquired semaphore slots"
  success=false
fi

if [ "$max_listeners_warning" -gt 0 ]; then
  echo "❌ FAIL: Memory leak warning still present"
  success=false
fi

if $success && [ "$max_listeners_warning" -eq 0 ]; then
  echo ""
  echo "✅ ✅ ✅ CONCURRENCY FIX VERIFIED ✅ ✅ ✅"
  echo ""
  echo "🎉 Memory leak eliminated!"
  echo "🎉 Semaphore concurrency control working!"
  echo "🎉 Custom HTTP agent active!"
  echo ""
fi

echo "========================================"
echo "DETAILED LOGS"
echo "========================================"
echo "Agent initialization:"
grep "\[AGENT_" "$combined_logs" | head -5
echo ""
echo "Semaphore activity:"
grep "\[SEMAPHORE_" "$combined_logs" | head -10
echo ""

echo "Full combined logs saved to: ${combined_logs}"
