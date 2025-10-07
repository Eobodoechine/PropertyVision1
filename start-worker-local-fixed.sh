#!/bin/bash
cd /Users/eobodoechine/PropertyVision1/frontend

# Export env vars from .env.local manually
export GCP_SA_JSON="/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json"
export GOOGLE_CLOUD_PROJECT_ID="agile-device-472202-i8"
export GOOGLE_MAPS_API_KEY="AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc"
export REDIS_URL="redis://localhost:6379"
export EMAIL_USER="lopez.b.mikaela@gmail.com"
export EMAIL_PASS="dudnzaafegqjzfci"
export EMAIL_FROM="PropertyVision Alerts <alerts@propertyvision.app>"
export USE_VERTEX_PROXY="true"
export FORCE_VERTEX_PROXY="true"
export VERTEX_PROXY_URL="https://vertex-proxy-839845580521.us-central1.run.app"
export PROXY_SHARED_KEY="GnbM4TK7RRhsDqvPU9alb/QtGr6sTnEuzma4ZNczJAc="
export RUN_WORKER="true"
export NODE_ENV="production"

echo "✅ Environment variables loaded from .env.local"
echo "🚀 Starting worker..."

npx tsx src/server/worker.ts
