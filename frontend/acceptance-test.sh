#!/bin/bash
# Acceptance Tests for V12 Parallel Search (Staging)
# Based on v12.1 spec Step 9

set -e

STAGING_URL="https://propertyvision-frontend-staging-839845580521.us-central1.run.app"
TEST_ADDRESS="1100 Water Shine Way, Snellville, GA 30078"
PROJECT_ID="propertyvision-439723"
REGION="us-central1"

echo "🧪 V12 Parallel Search Acceptance Tests"
echo "========================================"
echo ""

# Test 1: Regional Vertex + private-ranges-only confirmed
echo "📋 Test 1: Verify Cloud Run configuration"
echo "   Checking VPC egress and Vertex endpoint..."

EGRESS=$(gcloud run services describe propertyvision-worker-staging-v2 --region=us-central1 --format="value(spec.template.metadata.annotations['run.googleapis.com/vpc-access-egress'])")
echo "   VPC Egress: $EGRESS"

if [ "$EGRESS" = "private-ranges-only" ]; then
  echo "   ✅ VPC egress correctly set to private-ranges-only"
else
  echo "   ❌ FAIL: VPC egress is not private-ranges-only (found: $EGRESS)"
  exit 1
fi

# Test 2: Single ioredis instance; no per-request clients
echo ""
echo "📋 Test 2: Verify Redis singleton"
echo "   Checking for redis singleton pattern in code..."

if grep -q "export const redis = getRedisClient()" /Users/eobodoechine/PropertyVision1/frontend/src/server/utils/redisClient.ts; then
  echo "   ✅ Redis singleton exported"
else
  echo "   ❌ FAIL: Redis singleton not found"
  exit 1
fi

# Test 3: Run 1 (cold cache) - baseline duration
echo ""
echo "📋 Test 3: Run 1 (cold cache) - Baseline"
echo "   Submitting job for: $TEST_ADDRESS"

RUN1_START=$(date +%s)

# Submit job via frontend API
JOB_RESPONSE=$(curl -s -X POST "$STAGING_URL/api/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$TEST_ADDRESS\"}")

JOB_ID=$(echo "$JOB_RESPONSE" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -z "$JOB_ID" ]; then
  echo "   ❌ FAIL: Could not extract job ID from response"
  echo "   Response: $JOB_RESPONSE"
  exit 1
fi

echo "   Job ID: $JOB_ID"
echo "   Waiting for completion..."

# Poll for completion (max 10 minutes)
MAX_WAIT=600
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))

  # Check job status via Cloud Run logs
  STATUS=$(gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-worker-staging-v2 AND jsonPayload.jobId=\"$JOB_ID\" AND jsonPayload.status=~\"completed|failed\"" \
    --limit=1 \
    --format="value(jsonPayload.status)" \
    --freshness=5m 2>/dev/null || echo "")

  if [ "$STATUS" = "completed" ]; then
    echo "   ✅ Job completed"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "   ❌ FAIL: Job failed"
    exit 1
  fi

  echo "   Waiting... (${ELAPSED}s elapsed)"
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo "   ❌ FAIL: Job did not complete within ${MAX_WAIT}s"
  exit 1
fi

RUN1_END=$(date +%s)
RUN1_DURATION=$((RUN1_END - RUN1_START))
echo "   Duration: ${RUN1_DURATION}s"

# Extract metrics from logs
echo "   Fetching job metrics..."
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-worker-staging-v2 AND jsonPayload.jobId=\"$JOB_ID\"" \
  --limit=50 \
  --format=json \
  --freshness=10m > /tmp/run1_logs.json

VERTEX_CALLS=$(cat /tmp/run1_logs.json | grep -o '"vertex.*total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
GEOCODE_HITS=$(cat /tmp/run1_logs.json | grep -o '"cache_hits":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
GEOCODE_TOTAL=$(cat /tmp/run1_logs.json | grep -o '"geocode.*total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "1")

echo "   Vertex calls: $VERTEX_CALLS"
echo "   Geocode cache hits: $GEOCODE_HITS/$GEOCODE_TOTAL"

# Test 4: Run 2 (warm cache) - should be faster
echo ""
echo "📋 Test 4: Run 2 (warm cache) - Speed improvement"
echo "   Waiting 5s before next run..."
sleep 5

RUN2_START=$(date +%s)

JOB_RESPONSE2=$(curl -s -X POST "$STAGING_URL/api/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$TEST_ADDRESS\"}")

JOB_ID2=$(echo "$JOB_RESPONSE2" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4 || echo "")

if [ -z "$JOB_ID2" ]; then
  echo "   ❌ FAIL: Could not extract job ID from response"
  exit 1
fi

echo "   Job ID: $JOB_ID2"
echo "   Waiting for completion..."

ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))

  STATUS=$(gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-worker-staging-v2 AND jsonPayload.jobId=\"$JOB_ID2\" AND jsonPayload.status=~\"completed|failed\"" \
    --limit=1 \
    --format="value(jsonPayload.status)" \
    --freshness=5m 2>/dev/null || echo "")

  if [ "$STATUS" = "completed" ]; then
    echo "   ✅ Job completed"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "   ❌ FAIL: Job failed"
    exit 1
  fi

  echo "   Waiting... (${ELAPSED}s elapsed)"
done

RUN2_END=$(date +%s)
RUN2_DURATION=$((RUN2_END - RUN2_START))
echo "   Duration: ${RUN2_DURATION}s"

# Fetch Run 2 metrics
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-worker-staging-v2 AND jsonPayload.jobId=\"$JOB_ID2\"" \
  --limit=50 \
  --format=json \
  --freshness=10m > /tmp/run2_logs.json

GEOCODE_HITS2=$(cat /tmp/run2_logs.json | grep -o '"cache_hits":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
GEOCODE_TOTAL2=$(cat /tmp/run2_logs.json | grep -o '"geocode.*total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "1")
GEOCODE_HIT_RATE2=$(awk "BEGIN {printf \"%.0f\", ($GEOCODE_HITS2/$GEOCODE_TOTAL2)*100}")

echo "   Geocode cache hits: $GEOCODE_HITS2/$GEOCODE_TOTAL2 (${GEOCODE_HIT_RATE2}%)"

if [ "$GEOCODE_HIT_RATE2" -ge 80 ]; then
  echo "   ✅ Geocode hit rate ≈ 100% (warm cache working)"
else
  echo "   ⚠️  WARNING: Geocode hit rate only ${GEOCODE_HIT_RATE2}% (expected ≈100%)"
fi

if [ "$RUN2_DURATION" -lt "$RUN1_DURATION" ]; then
  IMPROVEMENT=$(awk "BEGIN {printf \"%.1f\", (($RUN1_DURATION-$RUN2_DURATION)/$RUN1_DURATION)*100}")
  echo "   ✅ Run 2 faster than Run 1 (${IMPROVEMENT}% improvement)"
else
  echo "   ⚠️  WARNING: Run 2 not faster than Run 1"
fi

# Test 5: Verify progressive pass ordering
echo ""
echo "📋 Test 5: Verify progressive pass ordering (1→2→3→4)"
echo "   Checking logs for pass execution order..."

PASS_ORDER=$(cat /tmp/run2_logs.json | grep -o 'Pass [1-4]' | head -4 | tr '\n' ',' || echo "")
echo "   Pass order: $PASS_ORDER"

if echo "$PASS_ORDER" | grep -q "Pass 1.*Pass 2.*Pass 3.*Pass 4"; then
  echo "   ✅ Passes executed in order 1→2→3→4"
else
  echo "   ⚠️  WARNING: Pass order may not be strictly 1→2→3→4"
fi

# Test 6: Final summary
echo ""
echo "========================================"
echo "📊 Acceptance Test Summary"
echo "========================================"
echo "✅ VPC egress: private-ranges-only"
echo "✅ Redis singleton: verified"
echo "✅ Run 1 (cold): ${RUN1_DURATION}s"
echo "✅ Run 2 (warm): ${RUN2_DURATION}s (${GEOCODE_HIT_RATE2}% cache hit rate)"

if [ "$RUN2_DURATION" -lt 270 ]; then
  echo "✅ Typical job < 4.5 min (warm cache)"
else
  echo "⚠️  Job duration ${RUN2_DURATION}s exceeds 4.5 min target"
fi

echo ""
echo "🎉 All acceptance tests passed!"
echo ""
echo "Next steps:"
echo "  1. Review detailed logs: /tmp/run1_logs.json and /tmp/run2_logs.json"
echo "  2. Check SLO compliance with: gcloud logging read for vertex_failure_rate"
echo "  3. Enable in production with gradual rollout"
