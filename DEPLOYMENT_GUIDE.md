# PropertyVision Deployment Guide

## Complete Docker + Google Cloud Run + Firebase Hosting Deployment Process

### Prerequisites
- Docker Desktop running
- Google Cloud SDK (`gcloud`) configured
- Firebase CLI installed (`firebase` command available)
- Service account JSON file: `agile-device-472202-i8-319f002d9438.json`

### Architecture Overview

**What gets deployed:**
- **Next.js Application** (`frontend/`) → Cloud Run service `propertyvision-frontend` (us-central1)
- **Firebase Hosting** → Routes `enohomebuyers.com` to Cloud Run service
- **Next.js API Routes** (`frontend/src/app/api/`) → Handle backend requests
- **Backend Logic** (`frontend/src/server/`) → Used by API routes (ComprehensiveComparableSearchV5)

⚠️ **CRITICAL**:
- The Next.js app includes both frontend AND backend code
- Backend code is in `frontend/src/server/` (NOT root `server/` directory)
- API routes in `frontend/src/app/api/` use the backend logic
- Root `/server/` directory is **NOT DEPLOYED** (old code)

### Step-by-Step Deployment Process

#### 1. Make Code Changes

When updating the backend:
1. Edit files in `frontend/src/server/` for backend logic
2. Edit files in `frontend/src/app/api/` for API endpoints
3. Ensure it uses `ComprehensiveComparableSearchV5` (the latest version)
4. Make sure logging is integrated in API routes

When updating the frontend:
1. Edit files in `frontend/src/app/` or `frontend/src/components/`
2. Test locally with `npm run dev` in the `frontend/` directory

#### 2. Update Environment Configuration

**`frontend/Dockerfile`** should have:
```dockerfile
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json
ENV GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8

# Start the Next.js application
CMD ["npm", "start"]
```

**`firebase.json`** should route to Cloud Run:
```json
{
  "hosting": {
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "propertyvision-frontend",
          "region": "us-central1"
        }
      }
    ]
  }
}
```

#### 3. Build Docker Image for linux/amd64

```bash
cd frontend

# Set PATH to include Docker and gcloud
export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/google-cloud-sdk/bin:$PATH"

# Build and push (replace 'latest' with version tag if needed)
docker buildx build --platform linux/amd64 \
  -t gcr.io/agile-device-472202-i8/propertyvision-frontend:latest \
  --push .
```

**Why linux/amd64?** Cloud Run requires this platform even if you're on Apple Silicon (ARM).

#### 4. Deploy to Cloud Run

```bash
~/google-cloud-sdk/bin/gcloud run deploy propertyvision-frontend \
  --image gcr.io/agile-device-472202-i8/propertyvision-frontend:latest \
  --platform managed \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,GOOGLE_MAPS_API_KEY=AIzaSyC0XOe09roqupMmu7iN6ABU29mMVx_qI7A,RAPIDAPI_KEY=a333066a74mshdaf44401e38cdc0p1a0c57jsndc06091fcd30,TAVILY_API_KEY=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
```

**Environment variables needed**:
- `NODE_ENV=production` - Enables Google Cloud Logging
- `GOOGLE_MAPS_API_KEY` - Required by the search service
- `RAPIDAPI_KEY` - For external API calls
- `TAVILY_API_KEY` - For Tavily API

#### 5. Deploy Firebase Hosting Configuration

```bash
cd /Users/eobodoechine/PropertyVision1
firebase deploy --only hosting --project agile-device-472202-i8
```

This updates Firebase Hosting to route all traffic from `enohomebuyers.com` to the Cloud Run service.

#### 6. Verify Deployment

```bash
# Check service status
gcloud run services describe propertyvision-frontend \
  --region us-central1 \
  --project agile-device-472202-i8

# Test the Cloud Run URL directly
curl https://propertyvision-frontend-839845580521.us-central1.run.app

# Test the production domain
curl https://enohomebuyers.com
```

#### 7. Test the Live API

```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"185 Jordan Pl, Fayetteville, GA 30215"}'
```

#### 8. Verify Logging in Google Cloud

Wait 1-2 minutes after a search, then:

```bash
# View all API logs
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' \
  --limit 10 \
  --format="table(timestamp, jsonPayload.metadata.eventType, jsonPayload.metadata.address, severity)"

# View search requests only
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.eventType="SEARCH_REQUEST"' \
  --limit 5 \
  --format="table(timestamp, jsonPayload.metadata.address, jsonPayload.metadata.ip)"

# View errors only
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' \
  --limit 10
```

You should see:
- `SEARCH_REQUEST` - When search starts (with address, IP, userId, sessionId)
- `SEARCH_RESULT` - When search completes (with ARV, comps count, execution time)
- `SEARCH_ERROR` - If search fails (with error message and stack trace)

## Common Issues & Solutions

### Issue: "Container failed to start"

**Check logs**:
```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-frontend"' \
  --limit 20 \
  --format="table(timestamp, textPayload)"
```

**Common causes**:
1. **Missing environment variable** (e.g., `GOOGLE_MAPS_API_KEY`)
   - Solution: Add it with `--set-env-vars` in deploy command

2. **Hardcoded file paths** (e.g., `/Users/eobodoechine/...`)
   - Solution: Use environment variables or `/app/` prefix
   - Check: `grep -r "/Users/" src/`

3. **Wrong port** - Container must listen on `$PORT` (8080)
   - Solution: Ensure `PORT=8080` in Dockerfile

4. **Wrong CMD in Dockerfile** - Must start Next.js, not Express
   - Solution: Ensure `CMD ["npm", "start"]` in Dockerfile

### Issue: "Platform not supported"

**Error**: `Container manifest type must support amd64/linux`

**Solution**: Always use `--platform linux/amd64`:
```bash
docker buildx build --platform linux/amd64 ...
```

### Issue: "No logs appearing in Google Cloud"

**Possible causes**:
1. `NODE_ENV` not set to `production`
2. Logger not imported/used in API routes
3. Wrong log name in query

**Solution**: Verify environment and check both:
```bash
# Check Cloud Run logs
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-frontend"'

# Check our custom logs
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"'
```

### Issue: "Website shows 'Cannot GET /'"

**Cause**: Dockerfile is running Express backend instead of Next.js

**Solution**: Update Dockerfile CMD to:
```dockerfile
CMD ["npm", "start"]
```

Then rebuild and redeploy.

### Issue: "Firebase Hosting not routing to Cloud Run"

**Check firebase.json**:
```json
{
  "hosting": {
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "propertyvision-frontend",
          "region": "us-central1"
        }
      }
    ]
  }
}
```

**Redeploy**:
```bash
firebase deploy --only hosting --project agile-device-472202-i8
```

## File Structure Reference

```
PropertyVision1/
├── frontend/                              # THIS IS WHAT GETS DEPLOYED
│   ├── Dockerfile                         # Docker configuration (runs Next.js)
│   ├── package.json                       # Dependencies and scripts
│   ├── next.config.js                     # Next.js configuration
│   ├── src/
│   │   ├── app/                           # Next.js App Router
│   │   │   ├── page.tsx                   # Homepage
│   │   │   ├── layout.tsx                 # Root layout
│   │   │   └── api/                       # API Routes (Backend endpoints)
│   │   │       ├── analyze/route.ts       # Main analysis endpoint ⭐
│   │   │       ├── health/route.ts        # Health check
│   │   │       └── ...
│   │   ├── components/                    # React components
│   │   └── server/                        # Backend logic (used by API routes)
│   │       ├── comprehensive-comp-search-v5.ts  # Latest algorithm ⭐
│   │       ├── utils/
│   │       │   └── logger.ts              # Google Cloud Logging ⭐
│   │       └── ...
│   └── .next/                             # Build output (auto-generated)
│
├── firebase.json                          # Firebase Hosting config (routes to Cloud Run)
├── server/                                # NOT DEPLOYED (old code)
│   └── ...                                # Don't edit these files
│
└── agile-device-472202-i8-319f002d9438.json  # Service account
```

## Quick Deploy Script

Save this as `deploy.sh` in the `frontend/` directory:

```bash
#!/bin/bash
set -e

echo "🚀 Starting PropertyVision Deployment"

# Set PATH
export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/google-cloud-sdk/bin:$PATH"

# Navigate to frontend directory
cd "$(dirname "$0")"

# Build and push
echo "🔨 Building Docker image for linux/amd64..."
docker buildx build --platform linux/amd64 \
  -t gcr.io/agile-device-472202-i8/propertyvision-frontend:latest \
  --push .

# Deploy to Cloud Run
echo "📤 Deploying to Cloud Run..."
~/google-cloud-sdk/bin/gcloud run deploy propertyvision-frontend \
  --image gcr.io/agile-device-472202-i8/propertyvision-frontend:latest \
  --platform managed \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,GOOGLE_MAPS_API_KEY=AIzaSyC0XOe09roqupMmu7iN6ABU29mMVx_qI7A,RAPIDAPI_KEY=a333066a74mshdaf44401e38cdc0p1a0c57jsndc06091fcd30,TAVILY_API_KEY=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

# Deploy Firebase Hosting
echo "🔥 Deploying Firebase Hosting..."
cd ..
firebase deploy --only hosting --project agile-device-472202-i8

echo "✅ Deployment complete!"
echo "🔍 Cloud Run URL: https://propertyvision-frontend-839845580521.us-central1.run.app"
echo "🌐 Production URL: https://enohomebuyers.com"
```

Make it executable:
```bash
chmod +x deploy.sh
```

Then deploy with:
```bash
./deploy.sh
```

## Rollback

If deployment fails:
```bash
# List revisions
gcloud run revisions list --service propertyvision-frontend --region us-central1

# Rollback to previous revision
gcloud run services update-traffic propertyvision-frontend \
  --to-revisions REVISION_NAME=100 \
  --region us-central1
```

## Monitoring

### Real-time logs
```bash
gcloud logging tail 'resource.type="cloud_run_revision" AND resource.labels.service_name="propertyvision-frontend"' \
  --project agile-device-472202-i8
```

### Search logs
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' \
  --limit 50 \
  --format=json
```

### Errors only
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' \
  --limit 20
```

### Query specific addresses
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.address:"185 Jordan Pl"' \
  --limit 10
```

## Services Overview

- **Cloud Run Service**: `propertyvision-frontend` (us-central1)
  - Runs the Next.js application
  - Serves both frontend UI and API routes
  - Direct URL: https://propertyvision-frontend-839845580521.us-central1.run.app

- **Firebase Hosting**: `agile-device-472202-i8`
  - Routes `enohomebuyers.com` to Cloud Run service
  - No static files served (all handled by Cloud Run)

- **Google Cloud Logging**: `projects/agile-device-472202-i8/logs/propertyvision-api`
  - All search requests, results, and errors are logged here
  - Logs include: address, IP, userId, sessionId, ARV, comps, errors, stack traces
