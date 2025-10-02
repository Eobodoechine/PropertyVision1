# Deployment Process

## Docker & Cloud Run Deployment

### Prerequisites
- Docker Desktop running: `/Applications/Docker.app/Contents/MacOS/Docker`
- gcloud CLI: `/Users/eobodoechine/google-cloud-sdk/bin/gcloud`
- Project: `agile-device-472202-i8`
- Region: `us-central1`
- Service: `propertyvision-frontend`

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
/Users/eobodoechine/google-cloud-sdk/bin/gcloud run deploy propertyvision-frontend \
  --image gcr.io/agile-device-472202-i8/frontend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated
```

### Production URLs
- **Main Domain**: https://enohomebuyers.com/
- **Cloud Run URL**: https://propertyvision-frontend-839845580521.us-central1.run.app

### Latest Deployment
- **Revision**: propertyvision-frontend-00016-4gb
- **Date**: 2025-10-02
- **Changes**:
  - **MAJOR**: Fixed progressive comp accumulation to use raw comps instead of qualified comps
  - Now properly accumulates ALL discovered properties across search levels before filtering
  - Level 1: 10 raw comps, Level 2: +14 unique raw comps (5 duplicates) = 24 total accumulated
  - Filtering applied to accumulated set: 24 → 16 (bedroom/size/time) → 6 (distance)
  - Fixed deduplication logic using Map with compound key (address|price|sqft)

### Testing
After deployment, test with problematic address:
```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "2462 McAlpine terrace, Eastpoint, GA, 30344"}'
```