#!/usr/bin/env bash
set -euo pipefail

# ---------- CONFIG ----------
PROJECT="agile-device-472202-i8"
JOB_ID="26c9b2a7-b6da-49d1-818b-25053eeafaac"
FRESHNESS="72h"   # widen if needed: 168h, 14d, etc.
SERVICES=( "propertyvision-frontend" "propertyvision-worker" "geo-proxy" "vertex-proxy" )
# ----------------------------

echo "Project: $PROJECT"
echo "Job ID : $JOB_ID"
echo "Freshness: $FRESHNESS"
echo

# Build a reusable filter fragment for this job ID that hits text + common JSON fields.
JOB_FILTER=$(
  cat <<EOF2
(
  textPayload:"$JOB_ID"
  OR jsonPayload.message:"$JOB_ID"
  OR jsonPayload.jobId="$JOB_ID"
  OR jsonPayload.job_id="$JOB_ID"
)
EOF2
)

# Export each service
found_any=0
for SVC in "${SERVICES[@]}"; do
  out="logs-${SVC}-${JOB_ID}.json"
  echo "Exporting $SVC …"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\"
     AND resource.labels.service_name=\"$SVC\"
     AND ${JOB_FILTER}" \
    --project "$PROJECT" \
    --freshness "$FRESHNESS" \
    --format=json \
    --limit=5000 > "$out" || true

  count=$(jq 'length' "$out" 2>/dev/null || echo 0)
  echo "  -> ${count} entries -> $out"
  if [[ "$count" -gt 0 ]]; then
    found_any=1
  fi
done

# If we found nothing, do a wider, "last ditch" sweep for the worker only (often where the ID appears).
if [[ "$found_any" -eq 0 ]]; then
  echo
  echo "No direct matches found. Doing a worker-only sweep within $FRESHNESS to locate an anchor..."
  gcloud logging read \
    "resource.type=\"cloud_run_revision\"
     AND resource.labels.service_name=\"propertyvision-worker\"
     AND ${JOB_FILTER}" \
    --project "$PROJECT" \
    --freshness "$FRESHNESS" \
    --format=json \
    --limit=5000 > "logs-worker-${JOB_ID}.json" || true

  count=$(jq 'length' "logs-worker-${JOB_ID}.json" 2>/dev/null || echo 0)
  echo "  -> ${count} entries -> logs-worker-${JOB_ID}.json"
  if [[ "$count" -gt 0 ]]; then
    found_any=1
  fi
fi

# Merge everything we captured (even if one or two files are empty).
jq -s '[.[][]] | sort_by(.timestamp)' logs-*-"${JOB_ID}".json > "logs-merged-${JOB_ID}.json" || echo "Nothing to merge."
if [[ -s "logs-merged-${JOB_ID}.json" ]]; then
  echo "Created logs-merged-${JOB_ID}.json (entries: $(jq 'length' "logs-merged-${JOB_ID}.json"))"
  zip -9 "logs-${JOB_ID}.zip" logs-*-"${JOB_ID}".json >/dev/null 2>&1 || true
  echo "Zipped raw files to logs-${JOB_ID}.zip"
else
  echo "No entries found for Job ID ${JOB_ID} within ${FRESHNESS}."
  echo "Tips:"
  echo "  • Confirm the job actually started (look for 'Processing job <id>' in worker logs)."
  echo "  • If your code doesn't attach jobId to structured logs, the text search is the only hit."
  echo "  • Increase FRESHNESS (e.g., 168h or 14d)."
fi
