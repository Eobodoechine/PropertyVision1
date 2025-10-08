# Fast Deployment Guide: Using Pack for Local Builds

## Overview

This guide documents the deployment optimization journey for PropertyVision staging environment, from 10-15 minute Cloud Build deployments to **3-6 minute local pack builds**.

## Problems We Faced

### 1. Slow Cloud Build Deployments (10-15 minutes)
**Issue:** Every staging deployment using `gcloud run deploy --source .` took 10-15 minutes because:
- Code was uploaded to Google Cloud Storage
- Cloud Build triggered remotely
- Docker image built in the cloud
- Image pushed to Artifact Registry
- Finally deployed to Cloud Run

**Impact:** During active development with timeout optimizations and bug fixes, waiting 10-15 minutes per deployment was extremely slow for iteration.

### 2. Docker Build Multi-Platform Manifest Issues
**Issue:** Standard Docker builds with `--platform linux/amd64` created OCI image indexes (multi-platform manifests) that Cloud Run rejected:
```
ERROR: Cloud Run does not support image 'gcr.io/...':
Container manifest type 'application/vnd.oci.image.index.v1+json' must support amd64/linux.
```

**Root Cause:** Modern Docker Desktop (v4.31.1+) creates multi-platform manifests by default, even when specifying a single platform.

**Failed Attempts:**
- `docker build --platform linux/amd64` - Still created multi-platform manifest
- `docker buildx build --platform linux/amd64 --output type=docker` - Incompatible with newer Docker
- No Docker flag exists to force Docker v2.2 manifest format

### 3. Docker Desktop Containerd Storage Issues with Pack
**Issue:** Initial pack builds failed with:
```
ERROR: failed to build: failed to fetch base layers: saving image with ID "sha256:..."
from the docker daemon: Error response from daemon: unable to create manifests file:
NotFound: content digest sha256:...: not found
```

**Root Cause:** Docker Desktop v4.34.0+ uses containerd image store by default. Pack buildpacks had compatibility issues with untrusted builders when using containerd storage.

**Fix:** Added `--trust-builder` flag to pack build command.

### 4. Missing GOOGLE_MAPS_API_KEY Secret
**Issue:** Frontend deployment failed during testing with "GOOGLE_MAPS_API_KEY environment variable is required" error.

**Root Cause:** Code expects `GOOGLE_MAPS_API_KEY` but staging only had `GMAPS_KEY` secret configured.

**Fix:** Added `GOOGLE_MAPS_API_KEY=GMAPS_KEY:latest` secret mapping to staging services.

## Why We Chose Pack (Cloud Native Buildpacks)

After extensive research and testing multiple approaches, we chose **pack with Google Cloud Buildpacks** because:

1. **Cloud Run Compatibility:** Google Cloud Buildpacks create the exact same Docker images that Cloud Build produces - guaranteed Cloud Run compatibility.

2. **Official Google Solution:** Pack with `gcr.io/buildpacks/builder` is Google's official recommended approach for local builds.

3. **Single-Platform Manifests:** Unlike standard Docker builds, pack creates proper single-platform Docker v2.2 manifests that Cloud Run accepts.

4. **No Infrastructure Changes:** Uses existing Dockerfile and project structure - no code changes required.

5. **Significant Time Savings:** 3-6 minute local builds vs 10-15 minute Cloud Build deployments.

## Implementation

### Prerequisites

1. **Install Pack CLI:**
```bash
brew install buildpacks/tap/pack
```

2. **Verify Docker Desktop Running:**
Docker must be running for pack to work.

### Pack Build Command

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

pack build gcr.io/agile-device-472202-i8/propertyvision-frontend-staging:latest \
  --builder=gcr.io/buildpacks/builder \
  --trust-builder
```

**Key Flags:**
- `--builder=gcr.io/buildpacks/builder`: Uses Google's official Cloud Buildpacks builder
- `--trust-builder`: Fixes Docker Desktop containerd storage compatibility issues

### Deployment Script: deploy-staging-pack.sh

Created automated deployment script at `/Users/eobodoechine/PropertyVision1/deploy-staging-pack.sh`:

```bash
#!/bin/bash
# Fast staging deployment using pack (Google Cloud Buildpacks)
# This creates Cloud Run-compatible images locally

set -e

PROJECT_ID="agile-device-472202-i8"
REGION="us-central1"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Add Docker to PATH
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

echo "=== Pack-based Staging Deployment ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# Build Docker images locally using pack
echo "Building images with pack (Cloud Native Buildpacks)..."
cd /Users/eobodoechine/PropertyVision1/frontend

pack build gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  --builder=gcr.io/buildpacks/builder \
  --trust-builder

# Tag as latest
docker tag gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest

echo ""
echo "Pushing images to Container Registry..."
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP
docker push gcr.io/$PROJECT_ID/propertyvision-frontend-staging:latest

echo ""
echo "Deploying frontend to staging..."
gcloud run deploy propertyvision-frontend-staging \
  --image gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP \
  --region $REGION \
  --project $PROJECT_ID

echo ""
echo "=== Deployment Complete ==="
echo "Frontend image: gcr.io/$PROJECT_ID/propertyvision-frontend-staging:$TIMESTAMP"
```

### Usage

```bash
cd /Users/eobodoechine/PropertyVision1
chmod +x deploy-staging-pack.sh
./deploy-staging-pack.sh
```

## Time Savings

### Before (Cloud Build):
- **Total Time:** 10-15 minutes
- **Breakdown:**
  - Upload source: 1-2 min
  - Cloud Build: 8-10 min
  - Deploy: 1-2 min

### After (Pack):
- **Total Time:** 3-6 minutes
- **Breakdown:**
  - Pack build: 3-5 min
  - Docker push: 30-60 sec
  - Deploy: 30-60 sec

### Time Saved Per Deployment: **5-10 minutes (50-67% faster)**

### Real-World Impact:
During the optimization session where we:
1. Fixed timeout issues in SPD code
2. Added instrumentation.ts for auto-worker startup
3. Fixed GOOGLE_MAPS_API_KEY secret
4. Tested and iterated multiple times

**With Cloud Build:** Would have taken ~40-60 minutes (4-6 deployments × 10-15 min)

**With Pack:** Took ~12-18 minutes (4-6 deployments × 3-6 min)

**Time Saved:** **28-42 minutes in a single development session**

## Build Performance Details

### Pack Build Phases (Example from actual build):

```
===> ANALYZING (0-5s)
- Checks for existing image layers

===> DETECTING (5-10s)
- Detects buildpacks: nodejs.runtime, nodejs.npm, utils.label-image

===> RESTORING (10-15s)
- Restores cached layers (node_modules on subsequent builds)

===> BUILDING (3-4 minutes)
- Installs Node.js v22.20.0
- Runs npm ci (40-50s)
- Runs npm run build (1m45s)
- Runs npm prune --production (3-5s)

===> EXPORTING (5-10s)
- Exports final image layers
```

**First Build:** ~5-6 minutes (no cache)
**Subsequent Builds:** ~3-4 minutes (with npm_modules cache)

## Comparison: Pack vs Docker vs Cloud Build

| Method | Time | Pros | Cons |
|--------|------|------|------|
| **Cloud Build** | 10-15 min | Official, no local setup | Very slow |
| **Docker Build** | 2-3 min | Fast | Multi-platform manifest issues, Cloud Run rejects |
| **Pack** | 3-6 min | Fast, Cloud Run compatible, official Google solution | Requires pack CLI install, Docker Desktop |

## Troubleshooting

### Error: "unable to create manifests file"

**Cause:** Docker Desktop containerd storage compatibility issue

**Fix:** Add `--trust-builder` flag to pack command

### Error: "docker-credential-desktop: executable file not found"

**Cause:** Docker not in system PATH

**Fix:** Add to script:
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

### Warning: "performance may be significantly degraded"

**Message:** "Exporting to docker daemon (building without --publish) and daemon uses containerd storage"

**Impact:** Pack builds may be 20-30 seconds slower with containerd, but still much faster than Cloud Build

**Optional Fix:** Disable containerd in Docker Desktop settings → General → Uncheck "Use containerd for pulling and storing images"

### Build fails with "ENOENT: no such file or directory"

**Cause:** Pack build runs Next.js build which tries to access local files that don't exist in build context

**Impact:** Warnings only - build still succeeds. These errors appear during static page generation and are expected in pack builds.

## Best Practices

1. **Trust the Builder Once:**
```bash
pack config trusted-builders add gcr.io/buildpacks/builder
```
Then you don't need `--trust-builder` flag every time.

2. **Tag with Timestamps:**
Always tag images with timestamps for easy rollback:
```bash
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
pack build gcr.io/$PROJECT_ID/app:$TIMESTAMP
```

3. **Keep Docker Running:**
Pack requires Docker Desktop to be running. Start it before running pack builds.

4. **Use for Staging Only:**
Pack is perfect for staging/development iterations. For production, use Cloud Build with CI/CD for audit trails and automated testing.

## Future Improvements

1. **Worker Service Separation:** Currently deploying frontend only. Could extend script to build/deploy worker service separately.

2. **Parallel Builds:** Could build multiple services in parallel using background processes.

3. **Build Caching:** Pack already caches npm_modules. Could explore additional caching strategies for even faster builds.

4. **CI/CD Integration:** Could integrate pack into GitHub Actions for faster CI/CD while maintaining Cloud Build for production.

## References

- [Google Cloud Buildpacks Documentation](https://cloud.google.com/docs/buildpacks)
- [Pack CLI Documentation](https://buildpacks.io/docs/for-platform-operators/how-to/integrate-ci/pack/)
- [Pack GitHub Issue #2270](https://github.com/buildpacks/pack/issues/2270) - Containerd storage fix
- [Cloud Run Image Requirements](https://cloud.google.com/run/docs/deploying#images)

## Running 24/7 Worker Services on Cloud Run

Cloud Run requires all services to listen on the `PORT` environment variable (default 8080) for health checks. For background worker processes that don't naturally listen on a port, you need a hybrid approach.

### The Challenge

Background workers typically:
- Don't listen on HTTP ports
- Fail Cloud Run health checks
- Get terminated before processing jobs

### The Solution: Health Check + Worker Pattern

Create a minimal HTTP server for health checks while running your worker process simultaneously.

#### Step 1: Create a Health Check Server

Create `healthcheck.js` in your project root:

```javascript
// healthcheck.js - Minimal HTTP server for Cloud Run health checks
const http = require('http');
const port = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  // Cloud Run health probe endpoint
  if (req.url === '/_ah/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Worker is alive and listening\n');
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(port, () => {
  console.log(`Health check server listening on port ${port}`);
});
```

#### Step 2: Install Concurrency Tool

```bash
npm install concurrently
```

#### Step 3: Update package.json Scripts

```json
{
  "scripts": {
    "healthcheck": "node healthcheck.js",
    "worker": "npx tsx src/server/worker.ts",
    "start-worker-with-healthcheck": "concurrently \"npm run healthcheck\" \"npm run worker\"",
    "start": "npm run start-worker-with-healthcheck"
  }
}
```

**Important:** Setting `"start"` to run both processes ensures Buildpacks use this command automatically.

#### Step 4: Deploy Worker Service

```bash
gcloud run deploy propertyvision-worker-staging \
  --source . \
  --min-instances 1 \
  --platform managed \
  --region us-central1
```

**Key flags:**
- `--source .`: Uses Buildpacks to build from source (executes `npm start`)
- `--min-instances 1`: Keeps worker running 24/7 (never scales to zero)

### Why This Works

1. **Health Check Server (PORT 8080):** Satisfies Cloud Run's requirement
2. **Worker Process:** Runs background job processing
3. **Concurrently:** Runs both processes in parallel
4. **Min Instances:** Ensures at least one instance always running

### Troubleshooting Worker Deployments

#### Error: "Container failed to start and listen on the port"

**Cause:** Worker process doesn't listen on PORT 8080

**Fix:** Use the health check + concurrently pattern above

#### Error: "sh: 1: npx: not found"

**Cause:** Command executed without proper Node.js PATH

**Fix:** Use `npm run` scripts instead of direct `npx` commands

## Conclusion

**For Frontend/API Services (Pack):**
Pack with Google Cloud Buildpacks provides:
- **Speed:** 50-67% faster than Cloud Build
- **Compatibility:** Guaranteed Cloud Run compatibility
- **Reliability:** Official Google solution

**For 24/7 Worker Services:**
Use health check + concurrently pattern:
- **Reliability:** Passes Cloud Run health checks
- **Simplicity:** Single `npm start` command
- **Cost Efficiency:** Min-instances=1 keeps worker running

These approaches save **5-10 minutes per deployment** and enable faster iteration cycles.
