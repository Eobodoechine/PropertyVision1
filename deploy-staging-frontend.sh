#!/bin/bash
set -e
cd ~/PropertyVision1

echo "--- Preparing staging build ---"

# Create temporary .env.production file
echo "Creating temporary .env.production file..."
echo "NEXT_PUBLIC_DISABLE_AUTH=true" > .env.production

# Backup existing .gcloudignore
cp .gcloudignore .gcloudignore.backup 2>/dev/null || true

# CRITICAL FIX: Copy .gitignore to .gcloudignore as base
echo "Creating temporary .gcloudignore from .gitignore..."
cp .gitignore .gcloudignore

# Append un-ignore rule
echo "
# --- Temporary rule for staging deploy ---
!.env.production" >> .gcloudignore

echo "--- Deploying to Cloud Run ---"

# Deploy
# PHASE 2 FIX: Use dedicated service account from new project
# This is the proper architectural solution - dedicated SA with least-privilege permissions
gcloud run deploy propertyvision-frontend-staging \
  --source . \
  --region=us-central1 \
  --project=durable-ring-475417-g0 \
  --service-account=propertyvision-staging-sa@durable-ring-475417-g0.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --vpc-connector=redis-connector \
  --vpc-egress=private-ranges-only \
  --set-secrets="GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,REDIS_URL=REDIS_URL:latest,VERTEX_AI_PROJECT_ID=VERTEX_AI_PROJECT_ID:latest,VERTEX_AI_LOCATION=VERTEX_AI_LOCATION:latest,FIREBASE_ADMIN_SDK=FIREBASE_ADMIN_SDK:latest,GPT_API_KEY=GPT_API_KEY:latest,NOTIFICATION_EMAIL=NOTIFICATION_EMAIL:latest" \
  --set-env-vars="RUN_WORKER=false,USE_PUBSUB=true,NEXT_PUBLIC_DISABLE_AUTH=true,IS_STAGING=true,NODE_ENV=production,WORKER_URL_STAGING=https://propertyvision-worker-staging-mfendrgxxa-uc.a.run.app" \
  --min-instances=0 \
  --max-instances=5 \
  --concurrency=80 \
  --timeout=300 \
  --cpu=1 \
  --memory=2Gi \
  --execution-environment=gen2 \
  --cpu-boost

echo "--- Cleaning up ---"

# Clean up
rm -f .env.production
mv .gcloudignore.backup .gcloudignore 2>/dev/null || rm -f .gcloudignore

echo "--- Staging deployment complete! ---"
