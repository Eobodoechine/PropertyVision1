#!/bin/bash
# Local test script for Vertex result caching
# Tests cache behavior by running the same job twice

set -e

echo "🧪 Local Cache Test - PropertyVision Worker"
echo "============================================"
echo ""

# Check if Redis is accessible
echo "📡 Checking Redis connection..."
if ! redis-cli ping > /dev/null 2>&1; then
  echo "❌ Redis is not running or not accessible"
  echo "   Start Redis with: redis-server"
  exit 1
fi
echo "✅ Redis connection OK"
echo ""

# Set local env vars for testing
export RUN_WORKER=true
export USE_PUBSUB=false  # Disable Pub/Sub for local testing
export IS_STAGING=false
export NODE_ENV=development

# Vertex cache settings
export PV_VERTEX_RPS=6
export PV_VERTEX_MAX_CONCURRENCY=4
export PV_VERTEX_MAX_ATTEMPTS=7
export PV_VERTEX_TIMEOUT_MS=120000
export PV_VERTEX_BASE_DELAY_MS=500
export PV_VERTEX_CACHE_TTL=604800  # 7 days

# Dedup settings
export PV_DEDUP_MAXTOKENS=4096

echo "⚙️  Configuration:"
echo "   RPS: $PV_VERTEX_RPS"
echo "   CONCURRENCY: $PV_VERTEX_MAX_CONCURRENCY"
echo "   MAX_ATTEMPTS: $PV_VERTEX_MAX_ATTEMPTS"
echo "   CACHE_TTL: $PV_VERTEX_CACHE_TTL seconds"
echo ""

# Test address
TEST_ADDRESS="123 Main St, San Francisco, CA"

echo "🏠 Test Address: $TEST_ADDRESS"
echo ""

# Create a minimal test job payload
TEST_PAYLOAD=$(cat <<EOF
{
  "address": "$TEST_ADDRESS",
  "searchRadius": 0.5,
  "timeWindowMonths": 6,
  "adjustmentLevel": "standard"
}
EOF
)

echo "📝 Test Payload:"
echo "$TEST_PAYLOAD"
echo ""

# Function to extract cache hit rate from logs
extract_cache_stats() {
  local log_file=$1
  echo ""
  echo "📊 Cache Statistics from $log_file:"

  # Count cache hits and misses
  local hits=$(grep -c '"source":"cache"' "$log_file" 2>/dev/null || echo 0)
  local misses=$(grep -c '"source":"vertex"' "$log_file" 2>/dev/null || echo 0)
  local total=$((hits + misses))

  if [ $total -gt 0 ]; then
    local hit_rate=$(awk "BEGIN {printf \"%.1f\", ($hits/$total)*100}")
    echo "   Cache Hits: $hits"
    echo "   Cache Misses: $misses"
    echo "   Total Calls: $total"
    echo "   Hit Rate: ${hit_rate}%"
  else
    echo "   No cache probe data found"
  fi

  # Extract probe names
  echo ""
  echo "   Probe Summary:"
  grep '"probe":' "$log_file" 2>/dev/null | \
    jq -r '.probe' | \
    sort | uniq -c | \
    awk '{printf "   - %-40s %3d\n", $2, $1}' || echo "   No probes found"
}

echo "═══════════════════════════════════════════"
echo "🔄 RUN 1: Cold Cache (should be all misses)"
echo "═══════════════════════════════════════════"
echo ""

# Clear Redis cache for clean test
echo "🗑️  Clearing Redis cache..."
redis-cli FLUSHDB > /dev/null
echo "✅ Cache cleared"
echo ""

# Run first job (cold cache)
RUN1_LOG="/tmp/pv-cache-test-run1-$(date +%s).log"
echo "🚀 Starting first run (logging to $RUN1_LOG)..."
echo ""

# Note: This assumes you have a way to trigger a job programmatically
# You may need to adapt this to your actual worker interface
echo "⚠️  Manual Step Required:"
echo "   1. Start the worker: npm run worker"
echo "   2. Submit a job with address: $TEST_ADDRESS"
echo "   3. Wait for completion"
echo "   4. Check logs with: ./scripts/download-job-logs.sh <job-id>"
echo ""
echo "   Alternatively, use the canary test:"
echo "   ./scripts/test-canary-stabilization.sh"
echo ""

read -p "Press Enter when first run is complete..."

extract_cache_stats "$RUN1_LOG"

echo ""
echo "═══════════════════════════════════════════"
echo "🔄 RUN 2: Warm Cache (should be 80-90% hits)"
echo "═══════════════════════════════════════════"
echo ""

# Run second job (warm cache)
RUN2_LOG="/tmp/pv-cache-test-run2-$(date +%s).log"
echo "🚀 Starting second run (logging to $RUN2_LOG)..."
echo ""

read -p "Press Enter when second run is complete..."

extract_cache_stats "$RUN2_LOG"

echo ""
echo "✅ Local cache test complete!"
echo ""
echo "Expected results:"
echo "  Run 1: 0-5% cache hit rate (cold cache)"
echo "  Run 2: 80-95% cache hit rate (warm cache)"
echo ""
echo "To inspect cache keys in Redis:"
echo "  redis-cli KEYS 'vertex:result:*'"
echo ""
echo "To view a specific cache entry:"
echo "  redis-cli GET 'vertex:result:<key>'"
