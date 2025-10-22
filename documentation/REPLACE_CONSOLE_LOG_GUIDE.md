# Guide: Replace console.log with jobLog for Job-Aware Logging

## What Changed

Added `jobLog()` function in [frontend/src/server/utils/jobQueue.ts:74-81](frontend/src/server/utils/jobQueue.ts:74-81) that automatically prepends `[jobId]` to all logs.

## How It Works

```typescript
// Old way
console.log('🔍 LEVEL 1 SEARCH STARTING...');
// Output: 🔍 LEVEL 1 SEARCH STARTING...

// New way
import { jobLog } from '@/server/utils/jobQueue';
jobLog('🔍 LEVEL 1 SEARCH STARTING...');
// Output: [878c8ea8] 🔍 LEVEL 1 SEARCH STARTING...
```

## Files to Update (Priority Order)

### High Priority (Job Execution Flow)
1. ✅ `/frontend/src/server/utils/jobQueue.ts` - Already has jobLog function
2. `/frontend/src/server/comprehensive-comp-search-v10.ts` - 32 console.log calls
3. `/frontend/src/server/comprehensive-comp-search-v5.ts` - 72 console.log calls
4. `/frontend/src/server/arvCalculator.js` - 77 console.log calls
5. `/frontend/src/server/utils/parallelSearchOrchestrator.ts` - 46 console.log calls

### Medium Priority (Search & Processing)
6. `/frontend/src/server/vertex-details.ts` - 105 console.log calls
7. `/frontend/src/server/utils/progressiveSearchStrategy.ts` - 83 console.log calls
8. `/frontend/src/server/step3-find-comparables.ts` - 150 console.log calls

### Lower Priority (Utilities)
9. `/frontend/src/server/vertex-freeform.js` - 40 console.log calls
10. `/frontend/src/server/utils/geminiParser.ts` - 8 console.log calls

## Example: How to Replace in comprehensive-comp-search-v10.ts

### Step 1: Add import at top
```typescript
import { updateJobProgress, isJobCancelled, jobLog } from './utils/jobQueue';
```

### Step 2: Replace console.log calls
```typescript
// Before
console.log(`\n🔍 COMPREHENSIVE COMPARABLE SEARCH V10 - Parallel Immediate Mode`);
console.log(`============================================================`);
console.log(`📍 Analyzing: ${address}`);

// After
jobLog(`\n🔍 COMPREHENSIVE COMPARABLE SEARCH V10 - Parallel Immediate Mode`);
jobLog(`============================================================`);
jobLog(`📍 Analyzing: ${address}`);
```

## Search Command to Find All console.log

```bash
# Find all console.log in server files
grep -rn "console\.log" /Users/eobodoechine/PropertyVision1/frontend/src/server --include="*.ts" --include="*.js" | wc -l
```

## Benefits

1. **Easy Diagnosis**: Search logs by jobId: `gcloud logging read 'textPayload:"878c8ea8"'`
2. **Multi-Job Clarity**: When multiple jobs run simultaneously, logs stay organized
3. **Backward Compatible**: jobLog() falls back to console.log() when no job context
4. **Minimal Changes**: Just replace `console.log` with `jobLog` and add one import

## Testing

Run a job locally and verify logs show `[jobId]` prefix:
```bash
cd /Users/eobodoechine/PropertyVision1/frontend && ./start-worker-local-fixed.sh 2>&1 | grep "\[.*\]"
```
