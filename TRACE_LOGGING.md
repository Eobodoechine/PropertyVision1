# Trace Logging and Vertex AI Retry Fix

**Date:** 2025-10-08
**Issue:** SPD extraction was failing with missing beds/baths, and logs were difficult to correlate in Google Cloud Logging

---

## Problems Identified

### Problem 1: Missing Trace IDs in Cloud Logs
**What was wrong:**
- All console logs were being sent to Google Cloud Logging via Winston
- However, logs didn't include trace IDs, making it difficult to correlate logs from a single job
- When debugging failures, we had to search by timestamp or text patterns
- No easy way to see ALL logs for a specific job ID

**Why it mattered:**
- When investigating the SPD failure for job `d0a6e4a0-8e29-4ca2-99de-d927f5e5530e`, we had to:
  - Query by timestamp ranges
  - Search for text like "2369 Three Bars Dr"
  - Manually piece together which logs belonged to which job
- Google Cloud Logging supports trace correlation, but we weren't using it

### Problem 2: Vertex AI Retry Logic Didn't Handle Partial Data
**What was wrong:**
- The `parseTextToJSON()` function in `vertex-details.ts` only retried when `JSON.parse()` **threw an error**
- If Vertex AI returned valid JSON with missing fields (e.g., `{sqft: 2231, yearBuilt: 1980}`), the function returned immediately
- No validation of required fields before returning
- Missing fields were only caught later in reconciliation, which was too late to retry

**What happened:**
```
✅ Vertex AI response received in 27815ms (2074 chars)
✅ JSON.parse() successful: parsed 2 fields
✅ Loser parsed in 27815ms: sqft=2231, beds=undefined, baths=undefined, yearBuilt=1980
❌ Validation failed - Missing critical fields: beds, baths
```

The 2074-character response contained data, but JSON extraction only parsed 2 fields. No retry was attempted.

**Why it mattered:**
- Vertex AI sometimes needs multiple attempts to extract all fields correctly
- Without retries, jobs failed unnecessarily when Vertex could have succeeded on retry
- We had no visibility into what the 2074-character response actually contained

### Problem 3: No Logging of Vertex AI Response Content
**What was wrong:**
- Logs showed response length (`2074 chars`) but not the actual content
- We couldn't debug WHY Vertex AI failed to extract beds/baths
- No way to see what grounded search returned or what JSON extraction produced

---

## Solutions Implemented

### Solution 1: Add Trace ID Support to Logging

**File:** `src/server/utils/logger.ts`

#### What we did:

1. **Added AsyncLocalStorage for trace context propagation** (lines 5, 11-18)
   ```typescript
   import { AsyncLocalStorage } from 'async_hooks';

   interface TraceContext {
     traceId?: string;
     spanId?: string;
     jobId?: string;
     address?: string;
   }

   const traceStorage = new AsyncLocalStorage<TraceContext>();
   ```

2. **Added functions to parse trace headers** (lines 124-136)
   ```typescript
   function parseTraceHeader(header: string | undefined): { traceId: string; spanId?: string } | null {
     if (!header) return null;
     const [traceId, spanId] = header.split('/');
     return traceId ? { traceId, spanId: spanId?.split(';')[0] } : null;
   }

   function getTracePath(traceId: string): string {
     const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'agile-device-472202-i8';
     return `projects/${projectId}/traces/${traceId}`;
   }
   ```

3. **Added trace context management functions** (lines 138-167)
   ```typescript
   export function setTraceContext(req: any, additionalContext?: Partial<TraceContext>): void {
     const traceHeader = req.headers?.['x-cloud-trace-context'] || req.headers?.['traceparent'];
     const parsed = parseTraceHeader(traceHeader);

     const context: TraceContext = {
       traceId: parsed?.traceId,
       spanId: parsed?.spanId,
       ...additionalContext
     };

     traceStorage.enterWith(context);
   }

   export function updateTraceContext(updates: Partial<TraceContext>): void {
     const current = traceStorage.getStore() || {};
     traceStorage.enterWith({ ...current, ...updates });
   }

   export function getTraceContext(): TraceContext | undefined {
     return traceStorage.getStore();
   }
   ```

4. **Added trace metadata extraction** (lines 172-195)
   ```typescript
   function getTraceMetadata(): any {
     const context = getTraceContext();
     if (!context) return {};

     const metadata: any = {};

     if (context.traceId) {
       metadata['logging.googleapis.com/trace'] = getTracePath(context.traceId);
     }

     if (context.spanId) {
       metadata['logging.googleapis.com/spanId'] = context.spanId;
     }

     if (context.jobId) {
       metadata.jobId = context.jobId;
     }

     if (context.address) {
       metadata.address = context.address;
     }

     return metadata;
   }
   ```

5. **Updated console overrides to include trace metadata** (lines 202-224)
   ```typescript
   console.log = (...args: any[]) => {
     originalConsoleLog(...args); // Keep stdout output
     const message = args.map(arg =>
       typeof arg === 'string' ? arg : JSON.stringify(arg)
     ).join(' ');
     logger.info(message, { source: 'console.log', ...getTraceMetadata() });
   };

   console.error = (...args: any[]) => {
     originalConsoleError(...args);
     const message = args.map(arg =>
       typeof arg === 'string' ? arg : JSON.stringify(arg)
     ).join(' ');
     logger.error(message, { source: 'console.error', ...getTraceMetadata() });
   };

   console.warn = (...args: any[]) => {
     originalConsoleWarn(...args);
     const message = args.map(arg =>
       typeof arg === 'string' ? arg : JSON.stringify(arg)
     ).join(' ');
     logger.warn(message, { source: 'console.warn', ...getTraceMetadata() });
   };
   ```

#### How it works:

- **AsyncLocalStorage** preserves trace context across all async operations (callbacks, promises, async/await)
- When a job starts processing, we call `updateTraceContext({ jobId, address, traceId })`
- All subsequent `console.log` calls automatically include the trace metadata
- Winston sends logs to Google Cloud Logging with the special `logging.googleapis.com/trace` field
- Google Cloud Logging recognizes this field and correlates all logs with that trace ID

**File:** `src/server/utils/jobQueue.ts`

#### What we did:

Added trace context initialization in the `processJob()` method (lines 331-340):

```typescript
private async processJob(jobId: string, address: string, messageId: string): Promise<void> {
  // Import trace context helpers
  const { updateTraceContext } = await import('./logger.js');

  // Set trace context for this job (propagates to all console.log calls)
  updateTraceContext({
    jobId,
    address,
    traceId: jobId // Use jobId as traceId for worker jobs
  });

  console.log(`⚙️  [${messageId}] Processing job ${jobId}: ${address}`);
  // ... rest of job processing
}
```

#### Why this approach:

- Uses `jobId` as the trace ID since worker jobs don't have HTTP request trace headers
- All logs within the job processing flow automatically include:
  - `logging.googleapis.com/trace`: `projects/agile-device-472202-i8/traces/{jobId}`
  - `jobId`: The job ID
  - `address`: The property address being analyzed
- Context propagates through all async operations without manual passing

---

### Solution 2: Add Retry Logic for Missing Fields

**File:** `src/server/vertex-details.ts`

#### What we did:

Added validation inside the retry loop to check for missing critical fields (lines 230-252):

```typescript
try {
  const parsed = JSON.parse(responseText);
  console.log(`   ✅ JSON.parse() successful: parsed ${Object.keys(parsed).length} fields`);
  console.log(`   📋 PARSED FIELDS: ${JSON.stringify(parsed, null, 2)}`);

  // Validate critical fields - retry if missing
  const missingFields: string[] = [];
  if (!parsed.sqft) missingFields.push('sqft');
  if (!parsed.beds) missingFields.push('beds');
  if (!parsed.baths) missingFields.push('baths');
  if (!parsed.yearBuilt) missingFields.push('yearBuilt');

  if (missingFields.length > 0) {
    console.error(`   ❌ Validation failed on attempt ${attempt}/${MAX_RETRIES}: missing ${missingFields.join(', ')}`);
    console.error(`   📄 Response text with missing fields (first 1000 chars): "${responseText.substring(0, 1000)}"`);
    lastError = new Error(`Missing critical fields: ${missingFields.join(', ')}`);

    // If not last attempt, retry
    if (attempt < MAX_RETRIES) {
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`   🔄 Retrying in ${backoffMs}ms due to missing fields...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      continue; // Retry the loop
    }

    // Last attempt failed - return partial data for reconciliation
    console.error(`   ⚠️  Max retries reached - returning partial data for reconciliation`);
  }

  console.log(`   ⚡ Non-grounded JSON parse completed in ${duration}ms`);
  return parsed;
} catch (jsonError) {
  // ... existing error handling
}
```

#### How it works:

1. **Parse JSON successfully** - No changes to existing JSON.parse() logic
2. **Validate critical fields** - Check if sqft, beds, baths, yearBuilt are present
3. **Retry if missing** - If fields missing and not last attempt:
   - Log the validation error
   - Log first 1000 chars of the response for debugging
   - Wait with exponential backoff (1s, 2s)
   - Continue the retry loop
4. **Graceful degradation** - If max retries exhausted, return partial data for reconciliation to handle

#### Why this approach:

- **Non-breaking** - Still returns data even if validation fails on all attempts
- **Exponential backoff** - Gives Vertex AI time to "think" differently on retry
- **Full visibility** - Logs the actual response content when validation fails
- **Reconciliation fallback** - Reconciliation can still merge partial data from primary + county

---

### Solution 3: Add Full Vertex AI Response Logging

**File:** `src/server/vertex-details.ts`

#### What we did:

1. **Log grounded search responses** (lines 784, 797):
   ```typescript
   const primaryPromise = vertexGenerate({ ...ctx, prompt: primaryPrompt, grounded: true, json: false, timeoutMs: SPD_PRIMARY_TIMEOUT_MS })
     .then(text => {
       const duration = Date.now() - primaryStart;
       console.log(`   ✅ Primary grounded search completed in ${duration}ms`);
       console.log(`   📄 PRIMARY GROUNDED RESPONSE (${text.length} chars): ${text}`);
       return { text, source: 'primary' as const, duration, error: null };
     })

   const countyPromise = vertexGenerate({ ...ctx, prompt: countyPrompt, grounded: true, json: false, timeoutMs: SPD_COUNTY_TIMEOUT_MS })
     .then(text => {
       const duration = Date.now() - countyStart;
       console.log(`   ✅ County grounded search completed in ${duration}ms`);
       console.log(`   📄 COUNTY GROUNDED RESPONSE (${text.length} chars): ${text}`);
       return { text, source: 'county' as const, duration, error: null };
     })
   ```

2. **Log JSON extraction responses** (lines 223, 228):
   ```typescript
   const duration = Date.now() - startTime;
   console.log(`   ✅ Vertex AI response received in ${duration}ms (${responseText.length} chars)`);
   console.log(`   📄 FULL VERTEX RESPONSE: ${responseText}`);

   try {
     const parsed = JSON.parse(responseText);
     console.log(`   ✅ JSON.parse() successful: parsed ${Object.keys(parsed).length} fields`);
     console.log(`   📋 PARSED FIELDS: ${JSON.stringify(parsed, null, 2)}`);
   ```

#### Why this matters:

- **Debug extraction failures** - See exactly what text Vertex AI received for parsing
- **Understand LLM behavior** - See what grounded search returned and why extraction might fail
- **Reproduce issues** - Can copy the exact prompt and response to test locally
- **Improve prompts** - Analyze patterns in responses to improve extraction prompts

---

## How to Use Trace Logging

### Querying Logs by Job ID

```bash
# Get all logs for a specific job (jobId is used as traceId)
gcloud logging read 'jsonPayload.jobId="d0a6e4a0-8e29-4ca2-99de-d927f5e5530e"' \
  --project agile-device-472202-i8 \
  --limit 500 \
  --format json

# Get all logs by trace ID
gcloud logging read 'trace="projects/agile-device-472202-i8/traces/d0a6e4a0-8e29-4ca2-99de-d927f5e5530e"' \
  --project agile-device-472202-i8 \
  --limit 500
```

### Querying Logs by Address

```bash
# Get all logs for a specific address
gcloud logging read 'jsonPayload.address="2369 Three Bars Dr, Snellville, GA 30078"' \
  --project agile-device-472202-i8 \
  --limit 500
```

### Viewing in Cloud Console

1. Go to **Cloud Logging** in Google Cloud Console
2. Use the query builder:
   - Filter by `jsonPayload.jobId`
   - Filter by `trace`
   - Filter by `jsonPayload.address`
3. Click on any log entry to see related logs (trace correlation)

---

## Expected Behavior After Fix

### Before Fix (Old Behavior)

```
✅ Vertex AI response received in 27815ms (2074 chars)
✅ JSON.parse() successful: parsed 2 fields
✅ Loser parsed in 27815ms: sqft=2231, beds=undefined, baths=undefined, yearBuilt=1980
❌ Validation failed - Missing critical fields: beds, baths
```

- No retry attempted
- No visibility into the 2074-char response
- Job failed immediately

### After Fix (New Behavior)

```
Attempt 1:
  ✅ Vertex AI response received in 14000ms (2074 chars)
  📄 FULL VERTEX RESPONSE: {"sqft": 2231, "yearBuilt": 1980}
  ✅ JSON.parse() successful: parsed 2 fields
  📋 PARSED FIELDS: {
    "sqft": 2231,
    "yearBuilt": 1980
  }
  ❌ Validation failed on attempt 1/3: missing beds, baths
  📄 Response text with missing fields (first 1000 chars): "{"sqft": 2231, "yearBuilt": 1980}"
  🔄 Retrying in 1000ms due to missing fields...

Attempt 2:
  ✅ Vertex AI response received in 15000ms (350 chars)
  📄 FULL VERTEX RESPONSE: {"sqft": 2231, "beds": 3, "baths": 2, "yearBuilt": 1980, "type": "single-family detached"}
  ✅ JSON.parse() successful: parsed 5 fields
  📋 PARSED FIELDS: {
    "sqft": 2231,
    "beds": 3,
    "baths": 2,
    "yearBuilt": 1980,
    "type": "single-family detached"
  }
  ⚡ Non-grounded JSON parse completed in 15000ms
```

- Retries up to 2 more times
- Full visibility into each response
- Job succeeds on retry

---

## Technical Details

### AsyncLocalStorage

**Why we use it:**
- Provides context propagation across async operations
- No need to manually pass trace context through every function
- Automatically works with callbacks, promises, async/await
- Node.js built-in (no external dependencies)

**How it works:**
1. Create a storage instance: `const storage = new AsyncLocalStorage<T>()`
2. Enter a context: `storage.enterWith({ traceId: '123' })`
3. Retrieve context anywhere: `storage.getStore()` returns `{ traceId: '123' }`
4. Context automatically propagates through:
   - `setTimeout/setInterval`
   - `Promise.then/catch/finally`
   - `async/await`
   - Event emitters
   - All async operations

### Google Cloud Logging Trace Format

**Required format:**
```typescript
{
  "message": "Log message",
  "severity": "INFO",
  "logging.googleapis.com/trace": "projects/{PROJECT_ID}/traces/{TRACE_ID}",
  "logging.googleapis.com/spanId": "{SPAN_ID}", // Optional
  "jobId": "{JOB_ID}",
  "address": "{ADDRESS}"
}
```

**What Cloud Logging does:**
- Extracts `logging.googleapis.com/trace` and sets as the `trace` field in LogEntry
- All logs with the same trace ID are correlated
- Clicking on a log shows all related logs
- Can filter by trace ID to see all logs for a request/job

---

## Benefits

### 1. Easy Log Correlation
- **Before:** Search by timestamp, text patterns, manual correlation
- **After:** Single query gets ALL logs for a job

### 2. Better Debugging
- **Before:** Only saw "2074 chars" - no idea what Vertex returned
- **After:** See full grounded search response and JSON extraction

### 3. Automatic Retry
- **Before:** Failed immediately on partial data
- **After:** Retries up to 2 times before failing

### 4. Context Propagation
- **Before:** Would need to pass jobId/address through every function
- **After:** Automatic via AsyncLocalStorage

### 5. Production-Ready
- Works in local development (human-readable logs)
- Works in staging/production (structured JSON logs)
- No performance impact (AsyncLocalStorage is very fast)
- Backward compatible (existing code continues to work)

---

## Related Files Changed

1. **src/server/utils/logger.ts** - Added trace context propagation
2. **src/server/utils/jobQueue.ts** - Set trace context when processing jobs
3. **src/server/vertex-details.ts** - Added retry validation and full response logging

---

## Future Enhancements

### Possible Improvements:

1. **Add trace context to API handlers** - Call `setTraceContext(req)` in API routes to correlate API requests
2. **Add custom trace spans** - Use `spanId` to track different phases (geocoding, comp search, filtering)
3. **Add trace sampling** - Only log full responses for a % of requests to reduce log volume
4. **Add OpenTelemetry integration** - Use standard tracing framework for even more visibility

### Metrics to Track:

- **Retry success rate** - How often do retries succeed vs fail?
- **Fields missing by source** - Does primary or county fail more often?
- **Response length correlation** - Do longer responses have better extraction?
- **Time to success** - How long does it take to get all fields?

---

## Testing

### Local Testing
```bash
# Start worker
cd /Users/eobodoechine/PropertyVision1/frontend
./start-worker-local-fixed.sh

# Submit a job and watch logs
# Logs will show trace context in human-readable format
```

### Production Testing
```bash
# Query recent logs with trace context
gcloud logging read 'timestamp>="2025-10-08T15:00:00Z" AND jsonPayload.jobId!=""' \
  --project agile-device-472202-i8 \
  --limit 50 \
  --format json | jq '.[] | {timestamp, jobId: .jsonPayload.jobId, message: .jsonPayload.message}'
```

---

## Automated Log Download Tool

### Overview

To make debugging easier, we created an automated script that downloads all logs for a specific job ID in batches of 10,000 entries.

**Script:** `scripts/download-job-logs.sh`

### Features

1. **Batch Downloads** - Downloads logs in configurable batches (default: 10,000) to avoid API limits
2. **Timestamp-Based Pagination** - Automatically fetches all logs using timestamp pagination
3. **Multiple Query Strategies** - Queries logs by trace ID, jobId field, and text search
4. **Smart Merging** - Combines all batches into a single JSON file
5. **Progress Tracking** - Shows download progress and provides summary statistics
6. **Safety Limits** - Prevents infinite loops with configurable max batch limit (default: 100 batches = 1M logs)

### Usage

```bash
# Basic usage - downloads to logs/job-{JOB_ID}.json
./scripts/download-job-logs.sh d0a6e4a0-8e29-4ca2-99de-d927f5e5530e

# Custom output file
./scripts/download-job-logs.sh d0a6e4a0-8e29-4ca2-99de-d927f5e5530e my-custom-logs.json
```

### Example Output

```
ℹ️  Starting log download for Job ID: d0a6e4a0-8e29-4ca2-99de-d927f5e5530e
ℹ️  Project: agile-device-472202-i8
ℹ️  Output file: logs/job-d0a6e4a0-8e29-4ca2-99de-d927f5e5530e.json

ℹ️  Downloading batch 1...
✅ Batch 1: Downloaded 10000 log entries

ℹ️  Downloading batch 2 (logs before 2025-10-08T15:07:35.826999902Z)...
✅ Batch 2: Downloaded 2345 log entries (Total: 12345)

ℹ️  Merging 2 batches into single file...

✅ Download complete!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📊 Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Job ID:       d0a6e4a0-8e29-4ca2-99de-d927f5e5530e
  Batches:      2
  Total logs:   12345
  Output file:  logs/job-d0a6e4a0-8e29-4ca2-99de-d927f5e5530e.json
  File size:    3.2M
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### How It Works

1. **Multiple Query Patterns** - The script queries logs using three patterns (ORed together):
   ```bash
   # Pattern 1: By trace field (structured logs with trace context)
   trace="projects/agile-device-472202-i8/traces/{JOB_ID}"

   # Pattern 2: By jobId in JSON payload
   jsonPayload.jobId="{JOB_ID}"

   # Pattern 3: By text search (unstructured logs)
   textPayload=~"{JOB_ID}"
   ```

2. **Batch Pagination** - Downloads logs in batches:
   - First batch: Downloads most recent 10,000 logs
   - Subsequent batches: Gets the oldest timestamp from previous batch
   - Adds filter: `timestamp<"{oldest_timestamp}"` to get older logs
   - Continues until no more logs or max batch limit reached

3. **Merge and Analyze** - Combines all batch files using `jq`:
   ```bash
   jq -s 'add' batch_*.json > final_output.json
   ```

### Analyzing Downloaded Logs

The script provides helpful commands for analyzing logs:

```bash
# View all log messages
jq -r '.[] | .textPayload // .jsonPayload.message' logs/job-xxx.json

# View errors only
jq -r '.[] | select(.severity=="ERROR") | .textPayload // .jsonPayload.message' logs/job-xxx.json

# View with timestamps
jq -r '.[] | "\(.timestamp) \(.textPayload // .jsonPayload.message)"' logs/job-xxx.json

# Count logs by severity
jq -r '.[] | .severity' logs/job-xxx.json | sort | uniq -c

# Extract Vertex AI responses
jq -r '.[] | select(.textPayload | contains("FULL VERTEX RESPONSE")) | .textPayload' logs/job-xxx.json

# Find validation failures
jq -r '.[] | select(.textPayload | contains("Validation failed")) | .textPayload' logs/job-xxx.json
```

### Requirements

- **gcloud CLI** - Installed and authenticated
  ```bash
  # Install (if needed)
  # macOS: brew install google-cloud-sdk
  # Other: https://cloud.google.com/sdk/docs/install

  # Authenticate
  gcloud auth login
  ```

- **jq** - JSON processor
  ```bash
  # Install
  # macOS: brew install jq
  # Linux: sudo apt-get install jq
  ```

### Configuration

Edit the script to customize:

```bash
# Change batch size (default: 10,000)
BATCH_SIZE=5000

# Change max batches (default: 100)
MAX_BATCHES=200

# Change project ID
PROJECT_ID="your-project-id"
```

### Troubleshooting

**Problem:** "Invalid JOB_ID format"
- **Solution:** Ensure job ID is a valid UUID format (e.g., `d0a6e4a0-8e29-4ca2-99de-d927f5e5530e`)

**Problem:** "No logs found"
- **Solution:** Check if job ID exists and logs are available in Cloud Logging
- Try querying directly: `gcloud logging read 'jsonPayload.jobId="YOUR_JOB_ID"'`

**Problem:** Download seems stuck
- **Solution:** The script may be downloading a large batch - wait for timeout or check Cloud Logging console

**Problem:** "gcloud: command not found"
- **Solution:** Install gcloud CLI from https://cloud.google.com/sdk/docs/install

---

## Conclusion

These changes provide:
- ✅ **Easy log correlation** via trace IDs
- ✅ **Automatic retry** for missing fields
- ✅ **Full visibility** into Vertex AI responses
- ✅ **Production-ready** structured logging
- ✅ **Backward compatible** with existing code

The implementation uses industry-standard practices (AsyncLocalStorage, Google Cloud Logging trace format) and provides immediate value for debugging production issues.
