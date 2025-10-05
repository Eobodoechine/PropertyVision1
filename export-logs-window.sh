#!/usr/bin/env bash
set -euo pipefail

PROJECT="agile-device-472202-i8"
START="2025-10-04T04:39:46Z"     # inclusive
END="2025-10-04T04:56:30Z"       # inclusive
SERVICES=( "propertyvision-frontend" "propertyvision-worker" "geo-proxy" "vertex-proxy" )

echo "Project : $PROJECT"
echo "Window  : $START  →  $END"

FILTER_TIME="timestamp>=\"$START\" AND timestamp<=\"$END\""

# ---- 1) APP LOGS (your console/structured logs) ----
for SVC in "${SERVICES[@]}"; do
  OUT="logs-app-${SVC}-${START//[:]/_}-${END//[:]/_}.json"
  echo "Exporting APP logs for ${SVC} → ${OUT}"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\"
     AND resource.labels.service_name=\"$SVC\"
     AND ${FILTER_TIME}" \
    --project "$PROJECT" \
    --format=json \
    --order=asc \
    --limit=100000 \
    > "$OUT"
done

# ---- 2) REQUEST LOGS (HTTP request entries) ----
for SVC in "${SERVICES[@]}"; do
  OUT_REQ="logs-req-${SVC}-${START//[:]/_}-${END//[:]/_}.json"
  echo "Exporting REQUEST logs for ${SVC} → ${OUT_REQ}"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\"
     AND logName=\"projects/${PROJECT}/logs/run.googleapis.com%2Frequests\"
     AND resource.labels.service_name=\"$SVC\"
     AND ${FILTER_TIME}" \
    --project "$PROJECT" \
    --format=json \
    --order=asc \
    --limit=100000 \
    > "$OUT_REQ"
done

# ---- 3) Merge + sort everything ----
jq -s '[.[][]] | sort_by(.timestamp)' \
   logs-app-*-"${START//[:]/_}"-"${END//[:]/_}".json \
   logs-req-*-"${START//[:]/_}"-"${END//[:]/_}".json \
   > "logs-merged-${START//[:]/_}-${END//[:]/_}.json"

# Optional: zip raw exports
zip -9 "logs-${START//[:]/_}-${END//[:]/_}.zip" \
    logs-app-*-"${START//[:]/_}"-"${END//[:]/_}".json \
    logs-req-*-"${START//[:]/_}"-"${END//[:]/_}".json >/dev/null 2>&1 || true

echo "Merged: logs-merged-${START//[:]/_}-${END//[:]/_}.json"
echo "Zipped: logs-${START//[:]/_}-${END//[:]/_}.zip"
