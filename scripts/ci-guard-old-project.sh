#!/bin/bash
# CI Guard: Prevent deployment to old GCP project (agile-device-472202-i8)
# This script should be run in CI/CD pipelines before any gcloud deployment commands

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

OLD_PROJECT_ID="agile-device-472202-i8"
NEW_PROJECT_ID="durable-ring-475417-g0"

echo "🔒 CI Guard: Checking GCP project configuration..."

# Get current gcloud project
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")

if [ -z "$CURRENT_PROJECT" ]; then
  echo -e "${YELLOW}⚠️  WARNING: No gcloud project configured${NC}"
  echo "Please set the correct project: gcloud config set project $NEW_PROJECT_ID"
  exit 1
fi

echo "📋 Current project: $CURRENT_PROJECT"

# Check if trying to deploy to old project
if [ "$CURRENT_PROJECT" == "$OLD_PROJECT_ID" ]; then
  echo -e "${RED}❌ DEPLOYMENT BLOCKED!${NC}"
  echo ""
  echo "You are attempting to deploy to the OLD project: $OLD_PROJECT_ID"
  echo "This project has been migrated to: $NEW_PROJECT_ID"
  echo ""
  echo "To fix this:"
  echo "  gcloud config set project $NEW_PROJECT_ID"
  echo ""
  echo "If you REALLY need to deploy to the old project (NOT recommended):"
  echo "  Set environment variable: ALLOW_OLD_PROJECT=true"
  echo ""

  # Check for override
  if [ "${ALLOW_OLD_PROJECT:-false}" == "true" ]; then
    echo -e "${YELLOW}⚠️  Override enabled - proceeding with old project (NOT RECOMMENDED)${NC}"
    exit 0
  fi

  exit 1
fi

# Verify we're on the new project
if [ "$CURRENT_PROJECT" == "$NEW_PROJECT_ID" ]; then
  echo -e "${GREEN}✅ CI Guard passed: Deploying to correct project ($NEW_PROJECT_ID)${NC}"
  exit 0
fi

# Unknown project
echo -e "${YELLOW}⚠️  WARNING: Unknown project: $CURRENT_PROJECT${NC}"
echo "Expected project: $NEW_PROJECT_ID"
echo "Proceeding anyway, but please verify this is correct."
exit 0
