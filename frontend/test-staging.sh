#!/bin/bash

# Test Progress Tracking on Staging
#
# Usage:
#   ./test-staging.sh

export API_BASE="https://propertyvision-frontend-staging-839845580521.us-central1.run.app"

echo "🧪 Testing Progress Tracking on Staging"
echo "API: $API_BASE"
echo ""

# Run the API test script
./test-progress-api.sh
