#!/bin/bash
# Fast staging deployment using pre-built Docker images
# This skips Cloud Build and deploys directly from local images

set -e

PROJECT_ID="agile-device-472202-i8"
REGION="us-central1"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Add Docker to PATH
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

echo "=== Fast Staging Deployment ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Build Docker images locally
echo "Building Docker images..."
cd /Users/eobodoechine/PropertyVision1/frontend

docker build \
  --platform linux/amd64 \
  -t gcr.io/$PROJECT_ID/propertyvision-worker-staging:latest \
  -t gcr.io/$PROJECT_ID/propertyvision-worker-staging:$TIMESTAMP \
  -t gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest \
  -t gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  .

echo ""
echo "Pushing images to Container Registry..."
docker push gcr.io/$PROJECT_ID/propertyvision-worker-staging:latest
docker push gcr.io/$PROJECT_ID/propertyvision-worker-staging:$TIMESTAMP
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP

echo ""
echo "Deploying worker to staging..."
gcloud run deploy propertyvision-worker-staging \
  --image gcr.io/$PROJECT_ID/propertyvision-worker-staging:latest \
  --region $REGION \
  --project $PROJECT_ID \
  --update-secrets "GOOGLE_MAPS_API_KEY=GMAPS_KEY:latest"

echo ""
echo "Deploying frontend to staging..."
gcloud run deploy propertyvision-frontend-staging \
  --image gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest \
  --region $REGION \
  --project $PROJECT_ID \
  --update-secrets "GOOGLE_MAPS_API_KEY=GMAPS_KEY:latest"

echo ""
echo "=== Deployment Complete ==="
echo "Worker image: gcr.io/$PROJECT_ID/propertyvision-worker-staging:$TIMESTAMP"
echo "Frontend image: gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP"
echo "Latest tags available for both services"
