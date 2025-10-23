#!/bin/bash
cd /Users/eobodoechine/PropertyVision1/frontend

# Load environment variables from .env.local
set -a
source .env.local 2>/dev/null || true
set +a
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
