#!/bin/bash

# Start Local Redis for Development
#
# This starts a local Redis instance in Docker for testing progress tracking

echo "🚀 Starting local Redis for development..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop."
  exit 1
fi

# Check if Redis container already exists
if docker ps -a --format '{{.Names}}' | grep -q '^propertyvision-redis-local$'; then
  echo "Existing Redis container found."

  # Check if it's running
  if docker ps --format '{{.Names}}' | grep -q '^propertyvision-redis-local$'; then
    echo "✅ Redis is already running on localhost:6379"
    exit 0
  else
    echo "Starting existing container..."
    docker start propertyvision-redis-local
    echo "✅ Redis started on localhost:6379"
    exit 0
  fi
fi

# Start new Redis container
echo "Creating new Redis container..."
docker run -d \
  --name propertyvision-redis-local \
  -p 6379:6379 \
  redis:7-alpine

if [ $? -eq 0 ]; then
  echo "✅ Redis started successfully on localhost:6379"
  echo ""
  echo "Update your .env.local:"
  echo "  REDIS_URL=redis://localhost:6379"
  echo ""
  echo "To stop Redis:"
  echo "  docker stop propertyvision-redis-local"
  echo ""
  echo "To remove Redis:"
  echo "  docker rm propertyvision-redis-local"
else
  echo "❌ Failed to start Redis"
  exit 1
fi
