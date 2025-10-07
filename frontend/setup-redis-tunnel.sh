#!/bin/bash

# Setup SSH Tunnel to Staging Redis for Local Testing
#
# This creates an SSH tunnel through a GCP compute instance to access
# the staging Redis instance (10.94.52.139:6379) locally on port 6379

echo "🔧 Setting up Redis tunnel for local testing..."
echo ""

# Check if we need a bastion/jump host
echo "Step 1: Finding a GCP VM to use as SSH jump host..."

# List all VMs that could act as jump hosts
gcloud compute instances list \
  --project agile-device-472202-i8 \
  --format="table(name,zone,status)" \
  --filter="status=RUNNING"

echo ""
echo "Which VM should we use as jump host? (or press Enter to create a temporary one)"
read -r VM_NAME

if [ -z "$VM_NAME" ]; then
  echo ""
  echo "Creating temporary bastion host..."

  VM_NAME="redis-tunnel-bastion"
  ZONE="us-central1-a"

  gcloud compute instances create "$VM_NAME" \
    --project=agile-device-472202-i8 \
    --zone="$ZONE" \
    --machine-type=e2-micro \
    --network-interface=network-tier=PREMIUM,subnet=default \
    --maintenance-policy=MIGRATE \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --image-family=debian-11 \
    --image-project=debian-cloud \
    --boot-disk-size=10GB \
    --boot-disk-type=pd-standard

  echo ""
  echo "⏳ Waiting for VM to be ready..."
  sleep 10
else
  # Get zone for the selected VM
  ZONE=$(gcloud compute instances list \
    --project agile-device-472202-i8 \
    --filter="name=$VM_NAME" \
    --format="value(zone)")
fi

echo ""
echo "Step 2: Creating SSH tunnel..."
echo "  Jump Host: $VM_NAME (zone: $ZONE)"
echo "  Redis Target: 10.94.52.139:6379"
echo "  Local Port: 6379"
echo ""

# Create SSH tunnel
# -N: Don't execute remote command
# -L: Local port forwarding (localhost:6379 -> 10.94.52.139:6379)
# -f: Run in background
gcloud compute ssh "$VM_NAME" \
  --project=agile-device-472202-i8 \
  --zone="$ZONE" \
  -- -N -L 6379:10.94.52.139:6379 -f

if [ $? -eq 0 ]; then
  echo "✅ SSH tunnel established!"
  echo ""
  echo "Redis is now accessible at: localhost:6379"
  echo ""
  echo "Update your .env.local:"
  echo "  REDIS_URL=redis://localhost:6379"
  echo ""
  echo "To close the tunnel later:"
  echo "  pkill -f '6379:10.94.52.139:6379'"
else
  echo "❌ Failed to create tunnel"
  exit 1
fi
