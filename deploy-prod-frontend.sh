#!/bin/bash
set -e
cd ~/PropertyVision1
gcloud run deploy propertyvision-frontend --source . --region=us-central1 --project=durable-ring-475417-g0 --allow-unauthenticated --vpc-connector=redis-connector --vpc-egress=private-ranges-only --set-secrets="GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest,REDIS_URL=REDIS_URL:latest,VERTEX_AI_PROJECT_ID=VERTEX_AI_PROJECT_ID:latest,VERTEX_AI_LOCATION=VERTEX_AI_LOCATION:latest,FIREBASE_ADMIN_SDK=FIREBASE_ADMIN_SDK:latest,GPT_API_KEY=GPT_API_KEY:latest,NOTIFICATION_EMAIL=NOTIFICATION_EMAIL:latest" --set-env-vars="RUN_WORKER=false,USE_PUBSUB=true,IS_STAGING=false,NODE_ENV=production" --min-instances=0 --max-instances=10 --concurrency=80 --timeout=300 --cpu=1 --memory=2Gi --execution-environment=gen2 --cpu-boost
