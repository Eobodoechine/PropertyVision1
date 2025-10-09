#!/bin/bash
# Update Cloud Run config for V10 Parallel Search optimizations
# Based on v12.1 spec: CPU always allocated, 2-4 vCPU, 4-8 GiB RAM, concurrency 2-6, min instances 4-12

set -e

SERVICE_NAME="${1:-propertyvision-worker-staging-v2}"
REGION="${2:-us-central1}"

echo "📦 Updating Cloud Run service: $SERVICE_NAME in region $REGION"

gcloud run services update "$SERVICE_NAME" \
  --region="$REGION" \
  --cpu=4 \
  --memory=8Gi \
  --concurrency=6 \
  --min-instances=4 \
  --max-instances=50 \
  --cpu-boost \
  --cpu-throttling \
  --no-cpu-throttling \
  --execution-environment=gen2 \
  --update-env-vars="VERTEX_CONCURRENCY=6,UV_THREADPOOL_SIZE=64,NODE_OPTIONS=--max-old-space-size=8192,USE_VERTEX_CLIENT=true,GEOCODE_NEGATIVE_CACHE_TTL_SECONDS=1800,NEW_ORCHESTRATOR_V12=true" \
  --update-labels="version=v12-optimized,vertex-client=enabled,redis-singleton=enabled"

echo "✅ Cloud Run service updated successfully"
echo ""
echo "📊 Current configuration:"
gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="yaml(spec.template.spec.containers[0].resources,spec.template.spec.containerConcurrency,spec.template.metadata.annotations)"
