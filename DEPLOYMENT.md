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

#### Option 1: Deploy from Source (Recommended)
```bash
# Deploy directly from source with automatic build
gcloud run deploy propertyvision-frontend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --set-env-vars "REDIS_URL=redis://10.85.154.187:6379,GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8,GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json,GOOGLE_MAPS_API_KEY=AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc,GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json" \
  --timeout 300
```

#### Option 2: Deploy from Container Image
```bash
# Deploy to Cloud Run from pre-built image
/Users/eobodoechine/google-cloud-sdk/bin/gcloud run deploy propertyvision-frontend \
  --image gcr.io/agile-device-472202-i8/frontend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --update-env-vars "REDIS_URL=redis://10.85.154.187:6379"
```

### Production URLs
- **Main Domain**: https://enohomebuyers.com/
- **Cloud Run URL**: https://propertyvision-frontend-839845580521.us-central1.run.app

## Redis Cache Infrastructure

### One-Time Setup (Already Completed)

If you need to set up Redis infrastructure from scratch:

```bash
# 1. Enable required APIs
gcloud services enable redis.googleapis.com --project=agile-device-472202-i8
gcloud services enable vpcaccess.googleapis.com --project=agile-device-472202-i8

# 2. Create Memorystore Redis instance
gcloud redis instances create propertyvision-cache \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=basic \
  --network=default \
  --project=agile-device-472202-i8

# 3. Get Redis host (will be something like 10.85.154.187)
gcloud redis instances describe propertyvision-cache \
  --region=us-central1 \
  --project=agile-device-472202-i8 \
  --format="get(host)"

# 4. Create VPC Connector
gcloud compute networks vpc-access connectors create redis-connector \
  --region=us-central1 \
  --network=default \
  --range=10.8.0.0/28 \
  --project=agile-device-472202-i8
```

### Memorystore Redis Setup
- **Instance Name**: `propertyvision-cache`
- **Host**: `10.85.154.187`
- **Port**: `6379`
- **Region**: `us-central1`
- **Tier**: Basic
- **Size**: 1GB
- **Version**: Redis 7.0
- **Network**: default VPC

### VPC Connector Configuration
- **Connector Name**: `redis-connector`
- **Region**: `us-central1`
- **Network**: `default`
- **IP Range**: `10.8.0.0/28`
- **Purpose**: Enables Cloud Run to access Memorystore Redis on private network

### Environment Variables (Production)
Required environment variables for Cloud Run:
- `REDIS_URL`: `redis://10.85.154.187:6379`
- `GOOGLE_CLOUD_PROJECT_ID`: `agile-device-472202-i8`
- `GOOGLE_APPLICATION_CREDENTIALS`: `/app/agile-device-472202-i8-319f002d9438.json`
- `GOOGLE_MAPS_API_KEY`: `AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc`
- `GCP_SA_JSON`: `/app/agile-device-472202-i8-319f002d9438.json`

### Cache Features
- **Dual-layer caching**: Redis (persistent) + in-memory (fast)
- **Automatic fallback**: If Redis fails, gracefully falls back to in-memory cache
- **Cache key format**: `raw_comps:{address}`
- **Purpose**: Stores raw comparable properties to speed up repeat searches

### Latest Deployment
- **Revision**: propertyvision-frontend-00020-m4h
- **Date**: 2025-10-02
- **Changes**:
  - **MAJOR**: Deployed Redis cache integration to production
  - Added Google Cloud Memorystore Redis instance for persistent caching
  - Configured VPC connector for Cloud Run → Memorystore communication
  - Added all required environment variables (REDIS_URL, GCP_SA_JSON, etc.)
  - Implemented dual-layer caching (Redis + in-memory) with graceful fallback
  - Redis successfully connected in production (verified in logs)

### Testing
After deployment, test with address:
```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "185 Jordan Pl, Fayetteville, GA 30215"}'
```

### Monitoring & Troubleshooting

#### Check Redis Connection in Production
```bash
# View recent logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend AND textPayload:\"Redis\"" \
  --limit 20 \
  --project agile-device-472202-i8

# Should see: ✅ Redis connected
```

#### Check Environment Variables
```bash
gcloud run services describe propertyvision-frontend \
  --region=us-central1 \
  --format=json \
  --project=agile-device-472202-i8 | jq -r '.spec.template.spec.containers[0].env[] | "\(.name)=\(.value)"'
```

#### Common Issues
1. **"Could not fetch subject property details"**
   - Missing `GCP_SA_JSON` environment variable
   - Solution: Ensure `GCP_SA_JSON=/app/agile-device-472202-i8-319f002d9438.json` is set

2. **Redis connection timeout**
   - VPC connector not configured
   - Solution: Ensure `--vpc-connector redis-connector` and `--vpc-egress private-ranges-only` are set

3. **Analysis fails immediately**
   - Missing environment variables
   - Check all required vars are set: `REDIS_URL`, `GOOGLE_MAPS_API_KEY`, `GCP_SA_JSON`, `GOOGLE_APPLICATION_CREDENTIALS`

#### View Cache Statistics

**API endpoint** (easiest method):
```bash
curl -s https://enohomebuyers.com/api/redis-info | jq '.'
```

This returns:
- `status`: Redis connection status
- `stats.totalAddresses`: Number of unique addresses cached
- `stats.totalComps`: Total raw comps across all addresses
- `sampleKeys`: Details for up to 10 cached addresses

**Example output:**
```json
{
  "status": "connected",
  "stats": {
    "totalAddresses": 1,
    "totalComps": 54
  },
  "sampleKeys": [
    {
      "address": "185 jordan pl, fayetteville, ga 30215",
      "compsCount": 54,
      "sizeBytes": 16719
    }
  ]
}
```

**Check logs** for cache hit/miss statistics:
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend AND textPayload:\"Cache\"" \
  --limit 50 \
  --project agile-device-472202-i8
```

#### Get Analysis Run Timestamps

**Easy method - Use the helper script:**

```bash
# Latest run
python3 scripts/get-run-timestamps.py

# Specific address
python3 scripts/get-run-timestamps.py "185 Jordan Pl"

# Last 5 runs
python3 scripts/get-run-timestamps.py --all 5
```

**Manual method:**

```bash
# Get the latest run for a specific address
python3 << 'EOF'
import json
import subprocess
from datetime import datetime, timedelta

# Get the latest search completion log
result = subprocess.run([
    'gcloud', 'logging', 'read',
    'resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend AND textPayload:"Search completed" AND textPayload:"YOUR_ADDRESS"',
    '--limit', '1',
    '--format', 'json',
    '--project', 'agile-device-472202-i8'
], capture_output=True, text=True)

data = json.loads(result.stdout)
if data:
    log_entry = data[0]
    text_payload = json.loads(log_entry['textPayload'].split('Search completed ')[1])

    end_time_str = text_payload['timestamp']
    execution_ms = text_payload['executionTimeMs']

    end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
    start_time = end_time - timedelta(milliseconds=execution_ms)

    print(f"START:    {start_time.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]} UTC")
    print(f"END:      {end_time.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]} UTC")
    print(f"DURATION: {execution_ms / 1000:.2f} seconds ({int(execution_ms / 60000)}m {int((execution_ms % 60000) / 1000)}s)")
    print(f"ARV:      ${text_payload['arv']:,}")
    print(f"Comps:    {text_payload['compsCount']} total, {text_payload['qualifiedCompsCount']} qualified")
EOF
```

**Quick command** (for most recent run):
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend AND textPayload:\"Search completed\"" \
  --limit 1 \
  --format json \
  --project agile-device-472202-i8 | jq -r '.[0].textPayload'
```

This will show the execution time in milliseconds. Subtract that from the timestamp to get the start time.