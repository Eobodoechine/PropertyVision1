#!/bin/bash

# Geo-Proxy Service Deployment
# Lightweight proxy service for geocoding requests
# Project: durable-ring-475417-g0

set -e

PROJECT_ID="durable-ring-475417-g0"
REGION="us-central1"
SERVICE_NAME="geo-proxy"

echo "🌍 Deploying Geo-Proxy Service"
echo "==============================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Create geo-proxy directory if it doesn't exist
mkdir -p geo-proxy
cd geo-proxy

# Create package.json
cat > package.json << 'EOF'
{
  "name": "geo-proxy",
  "version": "1.0.0",
  "description": "Lightweight proxy for geocoding requests",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "node-fetch": "^2.6.7"
  }
}
EOF

# Create server.js
cat > server.js << 'EOF'
const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'healthy', service: 'geo-proxy' });
});

// Geocoding proxy endpoint
app.get('/geocode', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Address parameter required' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    res.json(data);
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: 'Geocoding request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🌍 Geo-proxy listening on port ${PORT}`);
});
EOF

# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
EOF

echo "✅ Geo-proxy files created"
echo ""
echo "📦 Deploying to Cloud Run..."

# Deploy the service
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region=$REGION \
  --project=$PROJECT_ID \
  --no-allow-unauthenticated \
  --set-secrets="GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest" \
  --set-env-vars="NODE_ENV=production,PORT=8080" \
  --min-instances=0 \
  --max-instances=3 \
  --concurrency=80 \
  --timeout=60 \
  --cpu=1 \
  --memory=512Mi \
  --execution-environment=gen2

cd ..

echo ""
echo "======================================"
echo "✅ GEO-PROXY DEPLOYED!"
echo "======================================"
echo ""
echo "Service URL:"
gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --format='value(status.address.url)' 2>/dev/null
echo ""
echo "Configuration:"
echo "  - Scale-to-zero: YES ✅"
echo "  - Resources: 1 CPU, 512MB RAM"
echo "  - Private (no public access)"
echo "  - Cost: ~\$1-2/month"
echo ""
