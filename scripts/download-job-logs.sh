#!/bin/bash

###############################################################################
# Download Job Logs Script
#
# Downloads all logs for a specific job ID (trace ID) from Google Cloud Logging
# in batches of 10,000 to avoid API limits and timeout issues.
#
# Usage:
#   ./scripts/download-job-logs.sh <JOB_ID> [OUTPUT_FILE]
#
# Examples:
#   ./scripts/download-job-logs.sh d0a6e4a0                          # Short format (8 chars)
#   ./scripts/download-job-logs.sh d0a6e4a0-8e29-4ca2-99de-d927f5e5530e  # Full UUID
#   ./scripts/download-job-logs.sh d0a6e4a0 my-logs.json             # Custom output file
#
# The script will:
# - Download logs in batches of 10,000 entries
# - Use pagination tokens to fetch all logs
# - Merge all batches into a single JSON file
# - Show progress as it downloads
###############################################################################

set -e  # Exit on error

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-durable-ring-475417-g0}"
BATCH_SIZE=10000
MAX_BATCHES=100  # Safety limit to prevent infinite loops (100 batches = 1M logs max)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_usage() {
  echo ""
  echo "Usage: $0 <JOB_ID> [OUTPUT_FILE]"
  echo ""
  echo "Arguments:"
  echo "  JOB_ID       - The job ID (used as trace ID) to download logs for"
  echo "  OUTPUT_FILE  - (Optional) Output file path. Default: logs/job-<JOB_ID>.json"
  echo ""
  echo "Examples:"
  echo "  $0 d0a6e4a0-8e29-4ca2-99de-d927f5e5530e"
  echo "  $0 d0a6e4a0-8e29-4ca2-99de-d927f5e5530e my-custom-logs.json"
  echo ""
  exit 1
}

log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

# Parse arguments
if [ $# -lt 1 ]; then
  log_error "Missing required argument: JOB_ID"
  print_usage
fi

JOB_ID="$1"
OUTPUT_FILE="${2:-logs/job-${JOB_ID}.json}"

# Validate JOB_ID format (UUID or short 8-char format)
if ! [[ "$JOB_ID" =~ ^[0-9a-f]{8}(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$ ]]; then
  log_error "Invalid JOB_ID format. Expected UUID (e.g., d0a6e4a0-8e29-4ca2-99de-d927f5e5530e) or short format (e.g., d0a6e4a0)"
  exit 1
fi

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  log_error "gcloud CLI is not installed. Please install it from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
  log_error "jq is not installed. Please install it:"
  echo "  macOS: brew install jq"
  echo "  Linux: sudo apt-get install jq"
  exit 1
fi

# Create output directory if it doesn't exist
OUTPUT_DIR=$(dirname "$OUTPUT_FILE")
mkdir -p "$OUTPUT_DIR"

# Temporary directory for batch files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log_info "Starting log download for Job ID: $JOB_ID"
log_info "Project: $PROJECT_ID"
log_info "Output file: $OUTPUT_FILE"
echo ""

# Build the query filter
# Try multiple query patterns to catch logs from different sources

# Detect if short ID (8 chars) or full UUID
if [[ "$JOB_ID" =~ ^[0-9a-f]{8}$ ]]; then
  # Short ID format - search for job ID in text (matches [shortid] format logs)
  log_info "Detected short job ID format, searching for ${JOB_ID}"
  QUERY_TEXT="textPayload=~\"${JOB_ID}\""
  # Skip trace and jsonPayload queries for short IDs (they won't match)
  FILTER="${QUERY_TEXT}"
else
  # Full UUID format - use all query types
  TRACE_PATH="projects/${PROJECT_ID}/traces/${JOB_ID}"

  # Query 1: By trace field (for structured logs with trace context)
  QUERY_TRACE="trace=\"${TRACE_PATH}\""

  # Query 2: By jsonPayload.jobId (for logs with jobId in payload)
  QUERY_JOB_ID="jsonPayload.jobId=\"${JOB_ID}\""

  # Query 3: By text containing jobId (for unstructured logs)
  QUERY_TEXT="textPayload=~\"${JOB_ID}\""

  # Combine queries with OR
  FILTER="(${QUERY_TRACE}) OR (${QUERY_JOB_ID}) OR (${QUERY_TEXT})"
fi

log_info "Using filter: $FILTER"
echo ""

# Function to download a batch
download_batch() {
  local batch_num=$1
  local page_token=$2
  local batch_file="${TEMP_DIR}/batch_${batch_num}.json"

  log_info "Downloading batch ${batch_num}..."

  # Build gcloud command
  local cmd="gcloud logging read '$FILTER' \
    --project=$PROJECT_ID \
    --limit=$BATCH_SIZE \
    --format=json"

  # Add page token if provided
  if [ -n "$page_token" ]; then
    cmd="$cmd --page-token='$page_token'"
  fi

  # Execute and capture output
  if eval "$cmd" > "$batch_file" 2>&1; then
    local count=$(jq 'length' "$batch_file" 2>/dev/null || echo "0")
    log_success "Batch ${batch_num}: Downloaded ${count} log entries"
    echo "$count"
  else
    log_error "Batch ${batch_num}: Download failed"
    echo "0"
  fi
}

# Function to extract next page token from gcloud output
# Note: gcloud logging read doesn't provide pagination tokens in JSON output
# We'll use timestamp-based pagination instead
get_oldest_timestamp() {
  local batch_file=$1
  jq -r 'if length > 0 then .[-1].timestamp else empty end' "$batch_file" 2>/dev/null || echo ""
}

# Download first batch
batch_num=1
total_logs=0
batch_count=$(download_batch $batch_num "")
total_logs=$((total_logs + batch_count))

# If first batch is empty, exit early
if [ "$batch_count" -eq 0 ]; then
  log_warning "No logs found for Job ID: $JOB_ID"
  echo "[]" > "$OUTPUT_FILE"
  exit 0
fi

# Continue downloading batches if we got a full batch
while [ "$batch_count" -ge "$BATCH_SIZE" ] && [ "$batch_num" -lt "$MAX_BATCHES" ]; do
  # Get the oldest timestamp from the last batch for pagination
  oldest_timestamp=$(get_oldest_timestamp "${TEMP_DIR}/batch_${batch_num}.json")

  if [ -z "$oldest_timestamp" ]; then
    log_warning "No more logs to fetch (empty timestamp)"
    break
  fi

  # Add timestamp filter to get logs older than the last batch
  batch_num=$((batch_num + 1))
  FILTER_WITH_TIME="${FILTER} AND timestamp<\"${oldest_timestamp}\""

  # Download next batch
  batch_file="${TEMP_DIR}/batch_${batch_num}.json"

  log_info "Downloading batch ${batch_num} (logs before ${oldest_timestamp})..."

  if gcloud logging read "$FILTER_WITH_TIME" \
      --project="$PROJECT_ID" \
      --limit="$BATCH_SIZE" \
      --format=json > "$batch_file" 2>&1; then

    batch_count=$(jq 'length' "$batch_file" 2>/dev/null || echo "0")
    total_logs=$((total_logs + batch_count))
    log_success "Batch ${batch_num}: Downloaded ${batch_count} log entries (Total: ${total_logs})"
  else
    log_error "Batch ${batch_num}: Download failed"
    break
  fi

  # Safety check: if we get the same timestamp again, we're in a loop
  if [ "$batch_count" -eq 0 ]; then
    log_info "No more logs to fetch (empty batch)"
    break
  fi
done

# Check if we hit the max batch limit
if [ "$batch_num" -ge "$MAX_BATCHES" ]; then
  log_warning "Reached maximum batch limit (${MAX_BATCHES}). Some logs may not be downloaded."
fi

echo ""
log_info "Merging ${batch_num} batches into single file..."

# Merge all batches into a single JSON array
if [ "$batch_num" -eq 1 ]; then
  # Only one batch, just copy it
  cp "${TEMP_DIR}/batch_1.json" "$OUTPUT_FILE"
else
  # Multiple batches, merge them
  jq -s 'add' "${TEMP_DIR}"/batch_*.json > "$OUTPUT_FILE"
fi

# Get final count
final_count=$(jq 'length' "$OUTPUT_FILE" 2>/dev/null || echo "0")

echo ""
log_success "Download complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Job ID:       $JOB_ID"
echo "  Batches:      $batch_num"
echo "  Total logs:   $final_count"
echo "  Output file:  $OUTPUT_FILE"
echo "  File size:    $(du -h "$OUTPUT_FILE" | cut -f1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Show sample of the logs
log_info "Sample of downloaded logs:"
echo ""
jq -r '.[:3] | .[] | "\(.timestamp) [\(.severity)] \(.textPayload // .jsonPayload.message // "")"' "$OUTPUT_FILE" 2>/dev/null || true
echo ""

# Offer to analyze the logs
echo "To analyze these logs, you can use:"
echo "  • View all messages:     jq -r '.[] | .textPayload // .jsonPayload.message' $OUTPUT_FILE"
echo "  • View errors only:      jq -r '.[] | select(.severity==\"ERROR\") | .textPayload // .jsonPayload.message' $OUTPUT_FILE"
echo "  • View by timestamp:     jq -r '.[] | \"\\(.timestamp) \\(.textPayload // .jsonPayload.message)\"' $OUTPUT_FILE"
echo "  • Count by severity:     jq -r '.[] | .severity' $OUTPUT_FILE | sort | uniq -c"
echo ""

log_success "Done!"
