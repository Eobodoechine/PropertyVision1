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
- **Revision**: frontend-00017-9hh
- **Date**: 2025-09-27
- **Changes**:
  - **MAJOR**: Fixed outlier detection system to use consistent 7.5% threshold
  - Removed aggressive 25% PPSF filter that was excluding high-value comparables ($394k, $425k, $375k)
  - Archived complex z-score and median-ratio outlier detection methods
  - Enhanced progressive search strategy with proper propertyType parameter passing
  - Added comprehensive debug logging for duplex verification process
  - Improved property type detection with fallback methods
  - Added search history functionality and UI improvements
  - **RESULT**: ARV calculations now properly include high-value comparables instead of ~$320k undervaluation

### Testing
After deployment, test with problematic address:
```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "2462 McAlpine terrace, Eastpoint, GA, 30344"}'
```