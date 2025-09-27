# Deployment Process

## Docker & Cloud Run Deployment

### Prerequisites
- Docker Desktop running: `/Applications/Docker.app/Contents/MacOS/Docker`
- gcloud CLI: `/Users/eobodoechine/google-cloud-sdk/bin/gcloud`
- Project: `agile-device-472202-i8`
- Region: `us-east1`

### Build Process
```bash
# Set Docker path
export PATH="/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:$PATH"

# Build for AMD64 Linux (required for Cloud Run)
docker build --platform linux/amd64 -t gcr.io/agile-device-472202-i8/frontend:latest .

# Push to Google Container Registry
export PATH="/Users/eobodoechine/google-cloud-sdk/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:$PATH"
docker push gcr.io/agile-device-472202-i8/frontend:latest
```

### Deploy Process
```bash
# Deploy to Cloud Run
/Users/eobodoechine/google-cloud-sdk/bin/gcloud run deploy frontend \
  --image gcr.io/agile-device-472202-i8/frontend:latest \
  --region us-east1 \
  --platform managed \
  --allow-unauthenticated
```

### Production URLs
- **Main Domain**: https://enohomebuyers.com/
- **Cloud Run URL**: https://frontend-839845580521.us-east1.run.app

### Latest Deployment
- **Revision**: frontend-00005-56w
- **Date**: 2025-09-27
- **Changes**:
  - Fixed geocoding timeout implementation (3s timeout)
  - Added address normalization for cache consistency
  - Implemented property type detection and filtering
  - Enhanced Vertex AI prompts for duplex property matching
  - **CRITICAL**: Fixed missing environment variables in production
    - Added GCP_SA_JSON_B64 (base64 encoded service account)
    - Added GOOGLE_MAPS_API_KEY environment variable
    - Increased Cloud Run timeout to 15 minutes (900s)
    - Increased memory to 1Gi and CPU to 2 cores

### Testing
After deployment, test with problematic address:
```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "2462 McAlpine terrace, Eastpoint, GA, 30344"}'
```