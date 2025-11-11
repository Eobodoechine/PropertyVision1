# Local Testing Process with Playwright MCP

## Overview
This document provides step-by-step instructions for running local tests of the PropertyVision backend using Playwright MCP for browser automation and Cloud Logging integration for diagnostics.

## Prerequisites

### 1. Environment Setup
- Node.js installed (v18+)
- Claude Code with MCP support
- Google Cloud credentials configured
- Redis running locally on port 6379

### 2. Install Playwright MCP
```bash
claude mcp add playwright -s user -- npx -y @playwright/mcp@latest
```

**Note**: Restart Claude Code after installing MCP server to activate it.

### 3. Required Environment Variables

Create or verify `.env.local` in the project root:

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Google Cloud (uses Application Default Credentials)
GOOGLE_CLOUD_PROJECT_ID=<your-project-id>
GOOGLE_CLOUD_PROJECT=<your-project-id>

# Vertex AI
VERTEX_AI_LOCATION=us-central1
VERTEX_LOCATION=us-central1
VERTEX_MODEL=gemini-2.0-flash-001

# Google Maps
GOOGLE_MAPS_API_KEY=<your-api-key>

# Worker
RUN_WORKER=true
NODE_ENV=development
```

**Authentication Setup**: Ensure you have authenticated with Google Cloud:
```bash
gcloud auth application-default login
```

## Critical Code Changes Made

### 1. Timeout Fix (Primary Issue)

**Problem**: OAuth token acquisition timing out after 20 seconds locally.

**Files Modified**:
- `src/server/vertex-freeform.js:70`
- `src/server/step3-find-comparables.ts:1421`

**Change**: Increased timeout from `20000ms` → `60000ms`

```javascript
// Before
const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);

// After
const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 60000);
```

### 2. Firebase Removal (Local Testing)

**Problem**: Missing firebase packages causing build errors.

**Files Modified**:
- `src/contexts/AuthContext.tsx` - Replaced with mock authentication
- `src/services/searchHistory.ts` - Replaced with in-memory Map storage

**Why**: Firebase not needed for backend worker testing, only frontend functionality.

### 3. Instrumentation Added (Previous Session)

**Purpose**: Track Vertex AI call flow and identify exit paths.

**Files with instrumentation**:
- `src/server/vertex-freeform.js` - 5 exit path labels, caller tracking
- `src/server/vertex-details.ts` - Complete call instrumentation
- `src/server/vertexDeduplicator.ts` - Pre-parse logging

**Exit path labels**:
- `VERTEX_EXIT_NULL_RESPONSE`
- `VERTEX_EXIT_NO_CANDIDATES`
- `VERTEX_EXIT_NO_FIRST_CANDIDATE`
- `VERTEX_EXIT_NO_CONTENT`
- `VERTEX_EXIT_NO_PARTS`

## Step-by-Step Testing Process

### Step 1: Start Redis

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it
redis-server
```

### Step 2: Start Next.js Dev Server

```bash
# In project root
npm run dev
```

**Expected output**:
```
✓ Ready in 2.3s
○ Local:        http://localhost:3000
```

**Common Issues**:
- Port 3000 already in use: `lsof -ti:3000 | xargs kill -9`
- Build errors: Check that Firebase was removed from imports

### Step 3: Start Worker Process

```bash
# In project root
cd /Users/eobodoechine/PropertyVision1
export RUN_WORKER=true
npm run worker
```

**Expected output**:
```
🚀 Starting job worker...
🚀 PARALLEL SEARCH ORCHESTRATOR initialized:
   Vertex concurrency: 80
   Geocode concurrency: 20
   Levels: 1,2,3,4
✅ Worker health check server listening on 0.0.0.0:8080
✅ Redis connected
🔄 Worker started: <hostname>:<pid>
⏱️  No messages received (timeout or empty queue)
```

**Common Issues**:
- Port 8080 already in use: `lsof -ti:8080 | xargs kill -9`
- Redis connection failed: Ensure Redis is running on port 6379
- Authentication errors: Run `gcloud auth application-default login`

### Step 4: Submit Test Job via Playwright MCP

Use Claude Code's Playwright MCP tools:

**4.1 Navigate to localhost**:
```javascript
mcp__playwright__browser_navigate({ url: "http://localhost:3000" })
```

**4.2 Take snapshot to find element refs**:
```javascript
mcp__playwright__browser_snapshot()
```

**4.3 Fill address form**:
```javascript
mcp__playwright__browser_type({
  element: "Street address textbox",
  ref: "e32",  // Use ref from snapshot
  text: "185 Jordan Pl, Fayetteville, GA 30215"
})
```

**4.4 Submit form**:
```javascript
mcp__playwright__browser_click({
  element: "Analyze Property button",
  ref: "e33"  // Use ref from snapshot
})
```

**4.5 Note the Job ID**:
The job ID appears in the worker logs:
```
[89412d28] ⚙️  Processing job 89412d28-d852-4f25-852f-f2a19026d1eb: 185 Jordan Pl...
```

Job ID format: `89412d28-d852-4f25-852f-f2a19026d1eb`

### Step 5: Monitor Worker Logs

Watch for key instrumentation messages:

**Subject Property Phase (Should Succeed)**:
```
📞 SPD_VERTEX_CALL from subject_property_primary
✅ SPD_VERTEX_SUCCESS: caller=subject_property_primary, textLength=1522
📞 SPD_VERTEX_CALL from subject_property_parse_json
✅ SPD_VERTEX_SUCCESS: caller=subject_property_parse_json, textLength=239
```

**Comparable Search Phase (Currently Failing Locally)**:
```
🔍 FETCH DEBUG: About to call vertexGenerate with timeout 60000ms
🔍 RAW RESPONSE: Raw Vertex AI response: "${r}"
🤖 GEMINI: Parsing raw Vertex response with Gemini API...
```

**Error Indicators**:
```
❌ VERTEX_EXIT_*: <exit path details>
❌ GeminiParser: Failed to parse data: Error: Vertex AI Gemini request failed: No content returned
❌ Job <id> completed but failed validation: ARV unavailable (ARV=$0, comps=0)
```

### Step 6: Verify Cloud Logging Integration

**Check if logs were sent to Cloud Logging**:

1. Job logs are automatically sent to Cloud Logging via Winston logger
2. Log entries include structured metadata:
   - `jobId`: The job identifier
   - `environment`: "development" for local
   - `service`: "propertyvision-backend"
   - `source`: "jobLog"

**Expected Cloud Logging behavior**:
- Local jobs send logs to Cloud Logging if GCP credentials are configured
- Job ID `89412d28-d852-4f25-852f-f2a19026d1eb` logs should appear with all instrumentation

## Downloading Cloud Logs

### Method 1: Using diagRaw() Function (Recommended)

The project includes a Cloud Logging download utility in `diag-raw.js`:

```bash
node diag-raw.js <jobId>
```

**Example**:
```bash
node diag-raw.js 89412d28-d4e3-40f9-981c-b6a33104dcab
```

**Output**:
- Creates file: `logs-<jobId>-<timestamp>.json`
- Contains all log entries for the specified job
- Includes stdout, stderr, and all instrumentation messages

### Method 2: Using gcloud CLI

```bash
gcloud logging read "
  resource.type=cloud_run_revision
  AND jsonPayload.jobId=\"89412d28-d852-4f25-852f-f2a19026d1eb\"
  AND timestamp>=\"2025-10-23T21:23:00Z\"
" \
  --limit 10000 \
  --format json \
  --project agile-device-472202-i8 \
  > logs-89412d28.json
```

### Method 3: Cloud Console

1. Navigate to: https://console.cloud.google.com/logs
2. Query builder:
   ```
   resource.type="cloud_run_revision"
   jsonPayload.jobId="89412d28-d852-4f25-852f-f2a19026d1eb"
   timestamp>="2025-10-23T21:23:00Z"
   ```
3. Click "Download logs" → JSON format

## Analyzing Downloaded Logs

### Key Log Entries to Search For

**1. Instrumentation Success Messages**:
```bash
grep "SPD_VERTEX_SUCCESS" logs-89412d28.json
grep "VERTEX_SUCCESS" logs-89412d28.json
```

**2. Exit Path Labels**:
```bash
grep "VERTEX_EXIT" logs-89412d28.json
```

**3. Raw Responses**:
```bash
grep "RAW RESPONSE" logs-89412d28.json
grep "VERTEX DEBUG 13: Full response" logs-89412d28.json
```

**4. Error Messages**:
```bash
grep "GeminiParser: Failed" logs-89412d28.json
grep "MAIN CATCH" logs-89412d28.json
```

### Expected Log Flow (Successful Job)

```
1. Job claimed: "Claiming ownership of job..."
2. Subject property phase:
   - SPD_VERTEX_CALL from subject_property_primary
   - VERTEX_CALL_START: type=GROUNDED
   - VERTEX_CALL_COMPLETE: duration=<ms>, success=true
   - SPD_VERTEX_SUCCESS: textLength=<chars>
3. Comparable search phase:
   - FETCH DEBUG: About to call vertexGenerate
   - VERTEX_CALL_START: type=GROUNDED
   - RAW RESPONSE: Raw Vertex AI response: "<data>"
   - GEMINI: Parsing raw Vertex response
   - VERTEX_CALL_START: type=NON-GROUNDED (GeminiParser call)
4. Job completion:
   - "Job <id> completed successfully"
```

### Expected Log Flow (Failed Job - Local Issue)

```
1. Job claimed: "Claiming ownership of job..."
2. Subject property phase: ✅ SUCCEEDS
3. Comparable search phase:
   - FETCH DEBUG: About to call vertexGenerate
   - VERTEX_CALL_START: type=GROUNDED
   - ❌ One of:
     a) VERTEX_EXIT_NULL_RESPONSE
     b) VERTEX_EXIT_NO_CANDIDATES
     c) Request timeout (if 60s not enough)
   - RAW RESPONSE: Raw Vertex AI response: "" (empty)
   - GeminiParser: Failed to parse data: No content returned
4. Job completion:
   - "Job <id> completed but failed validation: ARV unavailable"
```

## Troubleshooting Common Issues

### Issue 1: Port Conflicts

**Symptom**: `Error: listen EADDRINUSE: address already in use`

**Solution**:
```bash
# Kill processes on specific ports
lsof -ti:3000 | xargs kill -9  # Next.js dev server
lsof -ti:8080 | xargs kill -9  # Worker health check
lsof -ti:6379 | xargs kill -9  # Redis (if needed)
```

### Issue 2: Worker Not Processing Jobs

**Symptom**: Worker logs show "No messages received (timeout or empty queue)"

**Diagnosis**:
1. Check Redis is running: `redis-cli ping`
2. Check Redis has job stream: `redis-cli XLEN jobs`
3. Check job was created: `redis-cli GET job:<jobId>`

**Solution**:
- Ensure `RUN_WORKER=true` is set
- Verify Redis connection in worker logs
- Check job queue initialization message

### Issue 3: Cloud Logging Not Receiving Logs

**Symptom**: `diagRaw()` returns no logs for local job

**Diagnosis**:
1. Check GCP credentials: `gcloud auth application-default login`
2. Verify authenticated user has Logging Write permissions
3. Check Winston logger configuration in `src/server/utils/jobLogger.ts`

**Solution**:
- Ensure you've run `gcloud auth application-default login`
- Verify your account has `roles/logging.logWriter` role
- Check Cloud Logging quota limits

### Issue 4: Playwright MCP Connection Issues

**Symptom**: `TimeoutError: page.goto: Timeout 60000ms exceeded`

**Diagnosis**:
1. Check Next.js dev server is running on localhost:3000
2. Verify Playwright MCP is installed: `claude mcp list`
3. Check for stale browser processes

**Solution**:
```bash
# Restart Next.js dev server
pkill -f "next dev"
npm run dev

# Restart Claude Code to reconnect MCP
# Or use Playwright MCP's browser_close and navigate again
```

### Issue 5: Firebase Build Errors (If Not Removed)

**Symptom**: `Module not found: Can't resolve 'firebase/auth'`

**Solution**: Verify Firebase was removed from:
- `src/contexts/AuthContext.tsx`
- `src/services/searchHistory.ts`
- All import statements

## Testing Checklist

- [ ] Redis running on port 6379
- [ ] Next.js dev server on port 3000
- [ ] Worker started with `RUN_WORKER=true`
- [ ] GCP credentials configured (`gcloud auth application-default login`)
- [ ] Playwright MCP installed and connected
- [ ] Timeout fix applied (20s → 60s) in both files
- [ ] Firebase removed from AuthContext and searchHistory
- [ ] Test job submitted via Playwright
- [ ] Job ID captured from worker logs
- [ ] Worker logs monitored for instrumentation
- [ ] Cloud logs downloaded for analysis

## Next Steps After Testing

1. **If local test succeeds**: Document success, compare to production logs
2. **If local test fails**: Analyze Cloud Logging to identify exact exit path
3. **Compare local vs production**: Identify environment-specific differences
4. **Original issue (e09cffd3)**: Apply learnings to diagnose deduplication failure

## Files Modified Summary

| File | Change | Reason |
|------|--------|--------|
| `src/server/vertex-freeform.js:70` | 20000 → 60000 | OAuth timeout fix |
| `src/server/step3-find-comparables.ts:1421` | 20000 → 60000 | OAuth timeout fix |
| `src/contexts/AuthContext.tsx` | Firebase → Mock | Local testing without Firebase |
| `src/services/searchHistory.ts` | Firestore → Map | Local testing without Firestore |

## Important Notes

1. **Timeout values**: 60 seconds matches existing Vertex API timeouts (lines 190, 646)
2. **Local vs Production**: These changes are for local testing; production may have different network characteristics
3. **Instrumentation**: All VERTEX_EXIT_* and SPD_VERTEX_* messages were added in previous session
4. **Job ID format**: Always 8-4-4-4-12 hex digits (UUID v4)
5. **Cloud Logging delay**: Logs may take 10-30 seconds to appear in Cloud Logging

## Reference Job IDs

- **Local test job (with timeout fix)**: `89412d28-d852-4f25-852f-f2a19026d1eb`
- **Previous local test (failed with timeout)**: `14ddb232-d4e3-40f9-981c-b6a33104dcab`
- **Original production issue**: `e09cffd3` (deduplication failure)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-23
**Author**: Claude Code Session (Timeout Diagnosis)
