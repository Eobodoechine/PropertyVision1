#!/bin/bash
# Fast staging deployment using pack (Google Cloud Buildpacks)
# This creates Cloud Run-compatible images locally

set -e

PROJECT_ID="agile-device-472202-i8"
REGION="us-central1"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "=== Pack-based Staging Deployment ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Build Docker images locally using pack
echo "Building images with pack (Cloud Native Buildpacks)..."
cd /Users/eobodoechine/PropertyVision1/frontend

pack build gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  --builder=gcr.io/buildpacks/builder \
  --trust-builder

# Tag as latest
docker tag gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest

echo ""
echo "Pushing images to Container Registry..."
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest

echo ""
echo "Deploying frontend to staging..."
gcloud run deploy propertyvision-frontend-staging \
  --image gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  --region $REGION \
  --project $PROJECT_ID

echo ""
echo "=== Deployment Complete ==="
echo "Frontend image: gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP"
