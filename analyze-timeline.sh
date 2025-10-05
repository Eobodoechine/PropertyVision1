#!/bin/bash
echo "=== FIRST ATTEMPT TIMELINE ==="
echo ""
echo "Worker calls vertex-proxy at:"
jq -r '.[] | select(.textPayload and (.textPayload | contains("VERTEX DEBUG 4.5: ✅ Routing to vertex-proxy"))) | .timestamp' logs-merged-2025-10-04T04_39_46Z-2025-10-04T04_56_30Z.json | head -6

echo ""
echo "Worker gets TLS disconnect errors at:"
jq -r '.[] | select(.textPayload and (.textPayload | contains("Client network socket disconnected"))) | .timestamp' logs-merged-2025-10-04T04_39_46Z-2025-10-04T04_56_30Z.json | head -6

echo ""
echo "Vertex-proxy cold start:"
jq -r '.[] | select(.resource.labels.service_name == "vertex-proxy" and .textPayload and (.textPayload | contains("Starting new instance"))) | .timestamp + " | " + .textPayload' logs-merged-2025-10-04T04_39_46Z-2025-10-04T04_56_30Z.json | head -1

echo ""
echo "Vertex-proxy ready:"
jq -r '.[] | select(.resource.labels.service_name == "vertex-proxy" and .textPayload and (.textPayload | contains("STARTUP TCP probe succeeded"))) | .timestamp + " | " + .textPayload' logs-merged-2025-10-04T04_39_46Z-2025-10-04T04_56_30Z.json | head -1

echo ""
echo "First successful vertex-proxy response:"
jq -r '.[] | select(.resource.labels.service_name == "vertex-proxy" and .httpRequest.status == 200) | .timestamp + " | latency: " + .httpRequest.latency' logs-merged-2025-10-04T04_39_46Z-2025-10-04T04_56_30Z.json | head -1
