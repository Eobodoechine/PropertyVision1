#!/bin/bash

# Test Progress Tracking Locally with Redis Tunnel
#
# This script:
# 1. Creates SSH tunnel to staging Redis (10.94.52.139)
# 2. Updates .env.local to use localhost:6379
# 3. Starts Next.js dev server
# 4. Runs progress tracking test
# 5. Cleans up

set -e

echo "🧪 Local Progress Tracking Test with Redis"
echo "==========================================="
echo ""

# Step 1: Find or create bastion host
echo "Step 1: Checking for bastion host..."
BASTION=$(gcloud compute instances list \
  --project=agile-device-472202-i8 \
  --filter="status=RUNNING AND zone~us-central1" \
  --format="value(name)" \
  --limit=1)

if [ -z "$BASTION" ]; then
  echo "No running VMs found. Please create a VM or use staging environment."
  exit 1
fi

ZONE=$(gcloud compute instances describe "$BASTION" \
  --project=agile-device-472202-i8 \
  --format="value(zone)")

echo "  Using bastion: $BASTION (zone: $ZONE)"
echo ""

# Step 2: Create SSH tunnel in background
echo "Step 2: Creating SSH tunnel to Redis..."
gcloud compute ssh "$BASTION" \
  --project=agile-device-472202-i8 \
  --zone="$ZONE" \
  --ssh-flag="-N" \
  --ssh-flag="-L 6380:10.94.52.139:6379" \
  --ssh-flag="-f" \
  2>/dev/null

if [ $? -eq 0 ]; then
  echo "  ✅ Tunnel established: localhost:6380 -> 10.94.52.139:6379"
else
  echo "  ❌ Failed to create tunnel"
  exit 1
fi

# Cleanup function
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  pkill -f "6380:10.94.52.139:6379" || true
  echo "  ✅ Tunnel closed"
}
trap cleanup EXIT

echo ""
echo "Step 3: Testing Redis connection..."
if command -v redis-cli &> /dev/null; then
  redis-cli -p 6380 PING > /dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "  ✅ Redis responding"
  else
    echo "  ❌ Redis not responding"
    exit 1
  fi
else
  echo "  ⚠️  redis-cli not installed, skipping connection test"
fi

echo ""
echo "Step 4: Updating .env.local..."
# Backup current .env.local
cp .env.local .env.local.backup

# Update Redis URL temporarily
sed -i '' 's|REDIS_URL=.*|REDIS_URL=redis://localhost:6380|' .env.local
echo "  ✅ Updated REDIS_URL to localhost:6380"

echo ""
echo "Step 5: Running test..."
echo ""
echo "You can now run:"
echo "  npm run dev    (in another terminal)"
echo "  ./test-progress-api.sh"
echo ""
echo "Or test directly:"
echo ""
echo "Press ENTER to run API test, or Ctrl+C to stop"
read

# Run the API test
./test-progress-api.sh

# Restore .env.local
echo ""
echo "Restoring .env.local..."
mv .env.local.backup .env.local
echo "  ✅ Restored original .env.local"
