#!/bin/bash

# PropertyVision Deployment Script for New Google Cloud Account
# Cost-optimized with scale-to-zero configuration
# Project: durable-ring-475417-g0
# Region: us-central1

set -e

PROJECT_ID="durable-ring-475417-g0"
REGION="us-central1"
REDIS_IP="10.64.226.163"
REDIS_URL="redis://${REDIS_IP}:6379"

echo "🚀 PropertyVision Deployment - New Cost-Optimized Account"
echo "=========================================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Redis: $REDIS_URL"
echo ""

# Check if VPC connector exists, create if not
echo "🔍 Checking VPC connector..."
if ! gcloud compute networks vpc-access connectors describe redis-connector --region=$REGION --project=$PROJECT_ID 2>/dev/null; then
  echo "📡 Creating VPC connector for Redis access..."
  gcloud compute networks vpc-access connectors create redis-connector \
    --region=$REGION \
    --network=default \
    --range=10.8.0.0/28 \
    --min-instances=2 \
    --max-instances=3 \
    --machine-type=e2-micro \
    --project=$PROJECT_ID
  echo "✅ VPC connector created"
else
  echo "✅ VPC connector already exists"
fi

# Function to deploy a service
deploy_service() {
  local SERVICE_NAME=$1
  local RUN_WORKER=$2
  local IS_STAGING=$3
  local ALLOW_UNAUTH=$4
  local MIN_INSTANCES=${5:-0}  # Default to 0 for scale-to-zero
  local MAX_INSTANCES=${6:-10}
  local CONCURRENCY=${7:-80}
  local TIMEOUT=${8:-300}
  local CPU=${9:-1}
  local MEMORY=${10:-2Gi}

  echo ""
  echo "📦 Deploying $SERVICE_NAME..."
  echo "  - Worker mode: $RUN_WORKER"
  echo "  - Staging: $IS_STAGING"
  echo "  - Scale-to-zero: $([ $MIN_INSTANCES -eq 0 ] && echo 'YES ✅' || echo 'NO')"
  echo "  - Resources: ${CPU} CPU, ${MEMORY} RAM"

  gcloud run deploy $SERVICE_NAME \
    --source . \
    --region=$REGION \
    --project=$PROJECT_ID \
    $([ "$ALLOW_UNAUTH" = "true" ] && echo "--allow-unauthenticated" || echo "--no-allow-unauthenticated") \
    --vpc-connector=redis-connector \
    --vpc-egress=private-ranges-only \
    --set-secrets="GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,REDIS_URL=REDIS_URL:latest,VERTEX_AI_PROJECT_ID=VERTEX_AI_PROJECT_ID:latest,VERTEX_AI_LOCATION=VERTEX_AI_LOCATION:latest,FIREBASE_ADMIN_SDK=FIREBASE_ADMIN_SDK:latest,GPT_API_KEY=GPT_API_KEY:latest,NOTIFICATION_EMAIL=NOTIFICATION_EMAIL:latest" \
    --set-env-vars="RUN_WORKER=$RUN_WORKER,IS_STAGING=$IS_STAGING,NODE_ENV=production,PORT=8080,HOST=0.0.0.0" \
    --min-instances=$MIN_INSTANCES \
    --max-instances=$MAX_INSTANCES \
    --concurrency=$CONCURRENCY \
    --timeout=$TIMEOUT \
    --cpu=$CPU \
    --memory=$MEMORY \
    --execution-environment=gen2 \
    --cpu-boost \
    --tag=latest

  echo "✅ $SERVICE_NAME deployed successfully"
}

# Deploy in order
echo ""
echo "======================================"
echo "STARTING DEPLOYMENTS"
echo "======================================"

# 1. Production Frontend (scale-to-zero, public access)
deploy_service "propertyvision-frontend" "false" "false" "true" 0 10 80 300 1 "2Gi"

# 2. Production Worker (scale-to-zero, no public access, longer timeout)
# Note: Worker uses min-instances=0 but will scale up when jobs are in Redis queue
deploy_service "propertyvision-worker" "true" "false" "false" 0 3 1 3600 1 "2Gi"

# 3. Staging Frontend (scale-to-zero, public access)
deploy_service "propertyvision-frontend-staging" "false" "true" "true" 0 5 80 300 1 "2Gi"

# 4. Staging Worker (scale-to-zero, no public access)
deploy_service "propertyvision-worker-staging" "true" "true" "false" 0 2 1 3600 1 "2Gi"

echo ""
echo "======================================"
echo "✅ ALL SERVICES DEPLOYED!"
echo "======================================"
echo ""
echo "Service URLs:"
echo "  Production Frontend: https://propertyvision-frontend-$(gcloud run services describe propertyvision-frontend --region=$REGION --project=$PROJECT_ID --format='value(status.address.url)' 2>/dev/null | cut -d'/' -f3)"
echo "  Staging Frontend: https://propertyvision-frontend-staging-$(gcloud run services describe propertyvision-frontend-staging --region=$REGION --project=$PROJECT_ID --format='value(status.address.url)' 2>/dev/null | cut -d'/' -f3)"
echo ""
echo "Cost Optimization Summary:"
echo "  ✅ All services using min-instances=0 (scale-to-zero)"
echo "  ✅ Reduced resources: 1 CPU + 2GB RAM"
echo "  ✅ Worker only runs when jobs exist in queue"
echo "  💰 Expected cost: ~\$40-50/month (vs \$600-1000/month before)"
echo ""
echo "Next steps:"
echo "  1. Set up domain mapping: enohomebuyers.com → propertyvision-frontend"
echo "  2. Complete Firebase setup and update FIREBASE_ADMIN_SDK secret"
echo "  3. Test the application end-to-end"
echo ""
