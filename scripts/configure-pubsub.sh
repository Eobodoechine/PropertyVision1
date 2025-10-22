#!/bin/bash
# Configure Pub/Sub for Stabilization Deployment
# Creates dead-letter topic and updates subscriptions with retry backoff

set -euo pipefail

PROJECT_ID="durable-ring-475417-g0"
DLQ_TOPIC="worker-dead-letter"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Pub/Sub Configuration for Stabilization ===${NC}"
echo "Project: $PROJECT_ID"
echo ""

# Step 1: Create dead-letter topic
echo -e "${BLUE}Step 1: Creating dead-letter topic...${NC}"
if gcloud pubsub topics describe "$DLQ_TOPIC" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  Topic $DLQ_TOPIC already exists, skipping creation${NC}"
else
  gcloud pubsub topics create "$DLQ_TOPIC" --project="$PROJECT_ID"
  echo -e "${GREEN}✅ Created topic: $DLQ_TOPIC${NC}"
fi
echo ""

# Step 2: Update staging subscription
echo -e "${BLUE}Step 2: Updating staging subscription...${NC}"
STAGING_SUB="property-analysis-jobs-sub-staging"
gcloud pubsub subscriptions update "$STAGING_SUB" \
  --project="$PROJECT_ID" \
  --min-retry-delay=30s \
  --max-retry-delay=600s \
  --dead-letter-topic="projects/$PROJECT_ID/topics/$DLQ_TOPIC" \
  --max-delivery-attempts=6

echo -e "${GREEN}✅ Updated subscription: $STAGING_SUB${NC}"
echo "   - Min retry delay: 30s"
echo "   - Max retry delay: 600s (10 minutes)"
echo "   - Dead-letter topic: $DLQ_TOPIC"
echo "   - Max delivery attempts: 6"
echo ""

# Step 3: Update production subscription
echo -e "${BLUE}Step 3: Updating production subscription...${NC}"
PROD_SUB="property-analysis-jobs-sub"
gcloud pubsub subscriptions update "$PROD_SUB" \
  --project="$PROJECT_ID" \
  --min-retry-delay=30s \
  --max-retry-delay=600s \
  --dead-letter-topic="projects/$PROJECT_ID/topics/$DLQ_TOPIC" \
  --max-delivery-attempts=6

echo -e "${GREEN}✅ Updated subscription: $PROD_SUB${NC}"
echo "   - Min retry delay: 30s"
echo "   - Max retry delay: 600s (10 minutes)"
echo "   - Dead-letter topic: $DLQ_TOPIC"
echo "   - Max delivery attempts: 6"
echo ""

echo -e "${GREEN}=== Pub/Sub Configuration Complete ===${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Run: ./scripts/deploy-staging.sh"
echo "2. Run: ./scripts/test-canary.sh"
