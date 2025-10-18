#!/bin/bash
# Deployment Helper: Standardized deployment script with correct SA mapping
# This script ensures deployments use the correct service account for the new project

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project configuration
NEW_PROJECT_ID="durable-ring-475417-g0"
REGION="us-central1"

# Service account mapping (corrected for new project)
# Format: service_name:service_account_email
declare -A SERVICE_ACCOUNTS=(
  ["frontend"]="propertyvision-frontend@durable-ring-475417-g0.iam.gserviceaccount.com"
  ["worker"]="propertyvision-worker@durable-ring-475417-g0.iam.gserviceaccount.com"
  ["api"]="propertyvision-api@durable-ring-475417-g0.iam.gserviceaccount.com"
)

# Usage
usage() {
  echo "Usage: $0 <service> <environment> [options]"
  echo ""
  echo "Arguments:"
  echo "  service       Service to deploy (frontend, worker, api)"
  echo "  environment   Environment (staging, production)"
  echo ""
  echo "Options:"
  echo "  --image       Use image-based deployment (recommended for workers)"
  echo "  --source      Use source-based deployment (default)"
  echo "  --skip-guard  Skip CI guard check (NOT recommended)"
  echo ""
  echo "Examples:"
  echo "  $0 worker staging --image"
  echo "  $0 frontend production --source"
  exit 1
}

# Parse arguments
if [ $# -lt 2 ]; then
  usage
fi

SERVICE="$1"
ENVIRONMENT="$2"
shift 2

# Default options
DEPLOY_METHOD="source"
SKIP_GUARD="false"

# Parse options
while [[ $# -gt 0 ]]; do
  case $1 in
    --image)
      DEPLOY_METHOD="image"
      shift
      ;;
    --source)
      DEPLOY_METHOD="source"
      shift
      ;;
    --skip-guard)
      SKIP_GUARD="true"
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      usage
      ;;
  esac
done

# Validate service
if [ -z "${SERVICE_ACCOUNTS[$SERVICE]:-}" ]; then
  echo -e "${RED}❌ Invalid service: $SERVICE${NC}"
  echo "Valid services: ${!SERVICE_ACCOUNTS[@]}"
  exit 1
fi

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(staging|production)$ ]]; then
  echo -e "${RED}❌ Invalid environment: $ENVIRONMENT${NC}"
  echo "Valid environments: staging, production"
  exit 1
fi

# Get service account for this service
SERVICE_ACCOUNT="${SERVICE_ACCOUNTS[$SERVICE]}"
SERVICE_NAME="propertyvision-${SERVICE}-${ENVIRONMENT}"

echo -e "${BLUE}🚀 PropertyVision Deployment Helper${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Service:           $SERVICE"
echo "Environment:       $ENVIRONMENT"
echo "Service Name:      $SERVICE_NAME"
echo "Service Account:   $SERVICE_ACCOUNT"
echo "Deploy Method:     $DEPLOY_METHOD"
echo "Project:           $NEW_PROJECT_ID"
echo "Region:            $REGION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run CI guard unless skipped
if [ "$SKIP_GUARD" == "false" ]; then
  echo "🔒 Running CI guard check..."
  if ! bash "$(dirname "$0")/ci-guard-old-project.sh"; then
    echo -e "${RED}❌ CI guard check failed${NC}"
    exit 1
  fi
  echo ""
fi

# Verify gcloud is configured for correct project
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
if [ "$CURRENT_PROJECT" != "$NEW_PROJECT_ID" ]; then
  echo -e "${YELLOW}⚠️  Setting gcloud project to $NEW_PROJECT_ID${NC}"
  gcloud config set project "$NEW_PROJECT_ID"
  echo ""
fi

# Verify service account exists
echo "🔍 Verifying service account..."
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" --project="$NEW_PROJECT_ID" &>/dev/null; then
  echo -e "${RED}❌ Service account not found: $SERVICE_ACCOUNT${NC}"
  echo ""
  echo "Create the service account:"
  echo "  gcloud iam service-accounts create $(echo $SERVICE_ACCOUNT | cut -d@ -f1) \\"
  echo "    --display-name=\"PropertyVision $SERVICE service account\" \\"
  echo "    --project=$NEW_PROJECT_ID"
  exit 1
fi
echo -e "${GREEN}✅ Service account verified${NC}"
echo ""

# Build deployment command
DEPLOY_CMD="gcloud run deploy $SERVICE_NAME \
  --region=$REGION \
  --service-account=$SERVICE_ACCOUNT \
  --allow-unauthenticated"

if [ "$DEPLOY_METHOD" == "image" ]; then
  # For image-based deployment, user must specify image
  echo -e "${YELLOW}⚠️  Image-based deployment requires --image flag with image URL${NC}"
  echo ""
  echo "Example:"
  echo "  gcloud run deploy $SERVICE_NAME \\"
  echo "    --region=$REGION \\"
  echo "    --service-account=$SERVICE_ACCOUNT \\"
  echo "    --allow-unauthenticated \\"
  echo "    --image=gcr.io/$NEW_PROJECT_ID/$SERVICE:latest"
  echo ""
  echo "Build and push image first:"
  echo "  gcloud builds submit --tag gcr.io/$NEW_PROJECT_ID/$SERVICE:latest ."
  exit 0
else
  # Source-based deployment
  DEPLOY_CMD="$DEPLOY_CMD --source=."
fi

# Show deployment command
echo -e "${BLUE}📋 Deployment command:${NC}"
echo "$DEPLOY_CMD"
echo ""

# Confirm deployment
read -p "Proceed with deployment? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Deployment cancelled."
  exit 0
fi

echo ""
echo "🚀 Starting deployment..."
eval "$DEPLOY_CMD"

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
