# Circular Dependency Build Failure - Diagnosis & Resolution

**Date**: October 10, 2025
**Issue**: Next.js build failing with "Cannot access 'h' before initialization"
**Resolution Time**: ~2 hours
**Status**: ✅ Resolved

---

## Table of Contents
1. [Initial Symptoms](#initial-symptoms)
2. [Diagnosis Process](#diagnosis-process)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Solution Implementation](#solution-implementation)
5. [Verification](#verification)
6. [Lessons Learned](#lessons-learned)

---

## Initial Symptoms

### What We Observed

**Build Failure**:
```bash
npx next build
# Output:
Collecting page data ...
✅ Redis connected
ReferenceError: Cannot access 'h' before initialization
    at i (.next/server/chunks/689.js:1:9294)
    at new Q (.next/server/chunks/689.js:237:13965)
    ...

> Build error occurred
[Error: Failed to collect page data for /api/redis-info] {
  type: 'Error'
}
[Error: Failed to collect page data for /api/redis-import] {
  type: 'Error'
}
```

**Failing Routes**:
- `/api/redis-info/route.ts`
- `/api/redis-import/route.ts`

Both routes imported `getRedisCache()` which triggered the circular dependency during Next.js static analysis.

---

## Diagnosis Process

### Step 1: Circular Dependency Detection

**Command**:
```bash
npx madge --circular --extensions ts,tsx src
```

**Result**:
```
✖ Found 15 circular dependencies!

Key cycle (Root Cause):
6) server/utils/jobQueue.ts >
   server/comprehensive-comp-search-v10.ts >
   server/utils/parallelSearchOrchestrator.ts >
   server/utils/geocodeCache.ts >
   server/utils/redisCache.ts >
   [imports jobLog from] server/utils/jobQueue.ts  ← CYCLE
```

### Step 2: Import Chain Analysis

**Evidence**:
```typescript
// jobQueue.ts (line 2)
import { getRedisCache } from './redisCache';

// redisCache.ts (line 2)
import { jobLog } from '../utils/jobQueue';
```

**Observation**: `jobLog` is just a simple console.log wrapper:
```typescript
export function jobLog(...args: any[]): void {
  if (currentJobContext) {
    const shortId = currentJobContext.jobId.substring(0, 8);
    console.log(`[${shortId}]`, ...args);
  } else {
    console.log(...args);
  }
}
```

### Step 3: Scope Analysis

**Files Affected**:
```bash
grep -r "import.*jobLog" src/server/utils/*.ts | wc -l
# Result: 15 files importing jobLog from jobQueue
```

**Files importing `jobLog`**:
- `redisCache.ts`
- `redisClient.ts`
- `geocodeCache.ts`
- `googleMapsGeocoder.ts`
- `geminiParser.ts`
- `minHeap.ts`
- `metrics.ts`
- `vertexClient.ts`
- `vertexDeduplicator.ts`
- `vertexProxy.ts`
- `emailNotification.ts`
- `propertyDataNormalizer.ts`
- `redisSemaphore.ts`
- `parallelSearchOrchestrator.ts`
- `progressiveSearchStrategy.ts`

---

## Root Cause Analysis

### The Problem

**Dependency Hierarchy Violation**:
```
HIGH-LEVEL: jobQueue.ts (orchestrates jobs)
    ↓ imports
MID-LEVEL: comprehensive-comp-search-v10.ts (search logic)
    ↓ imports
LOW-LEVEL: redisCache.ts, geocodeCache.ts (utilities)
    ↓ imports jobLog from
HIGH-LEVEL: jobQueue.ts ← CIRCULAR DEPENDENCY
```

**Why It Failed During Build**:
1. Next.js performs static analysis during `npm run build`
2. Routes like `/api/redis-import` import `getRedisCache()`
3. Module initialization order becomes ambiguous due to circular dependency
4. Webpack/Next.js tries to access variable `h` (minified reference) before initialization completes
5. **Build fails with "Cannot access 'h' before initialization"**

### Why This Pattern is Anti-Pattern

**Principle Violated**: Low-level utilities should NOT depend on high-level orchestrators

- ❌ **Bad**: `redisCache.ts` (utility) imports from `jobQueue.ts` (orchestrator)
- ✅ **Good**: Both import from `logger.ts` (standalone, zero dependencies)

---

## Solution Implementation

### Strategy: Extract Logger to Standalone Module

**Created**: `src/server/utils/logger.ts`
```typescript
// Lightweight logger with optional job context.
// No imports to avoid cycles.
let currentJobId: string | null = null;

export function setJobContext(jobId: string | null) {
  currentJobId = jobId;
}

export function jobLog(...args: any[]): void {
  if (currentJobId) {
    const shortId = currentJobId.slice(0, 8);
    console.log(`[${shortId}]`, ...args);
  } else {
    console.log(...args);
  }
}
```

**Key Design Decisions**:
- ✅ **Zero imports** - Cannot create circular dependencies
- ✅ **Minimal functionality** - Just logging, no business logic
- ✅ **Job context management** - `setJobContext()` for job-aware logging
- ✅ **Drop-in replacement** - Same API as original `jobLog`

### Changes Made

**1. Created Standalone Logger**:
- File: `src/server/utils/logger.ts`
- Exports: `jobLog`, `setJobContext`
- Dependencies: None

**2. Updated 16 Files**:
```bash
# Changed imports from:
import { jobLog } from './jobQueue';

# To:
import { jobLog } from './logger';
```

**Files updated**:
- All 15 utility files listed above
- `src/server/vertex-freeform.js`

**3. Modified `jobQueue.ts`**:
```typescript
// Before:
export function jobLog(...args: any[]): void {
  if (currentJobContext) {
    const shortId = currentJobContext.jobId.substring(0, 8);
    console.log(`[${shortId}]`, ...args);
  } else {
    console.log(...args);
  }
}

// After:
import { jobLog, setJobContext } from './logger';

// Use setJobContext(jobId) when job starts
// Use setJobContext(null) when job ends
```

**4. Updated Job Context Management**:
```typescript
// In processJob():
private async processJob(jobId: string, address: string, messageId: string): Promise<void> {
  setJobContext(jobId);  // Set context for logging

  // ... job processing ...

  setJobContext(null);  // Clear context when done
}
```

---

## Verification

### Build Success

**Before Fix**:
```bash
npx next build
# Result: ReferenceError: Cannot access 'h' before initialization
# Status: ❌ FAILED
```

**After Fix**:
```bash
npx next build
# Result:
✓ Compiled successfully in 8.5s
   Generating static pages (12/12)
   Finalizing page optimization ...

Route (app)                                 Size  First Load JS
├ ƒ /api/redis-import                      148 B         102 kB
├ ƒ /api/redis-info                        148 B         102 kB
...

# Status: ✅ SUCCESS
```

### Circular Dependency Reduction

**Before**:
```bash
npx madge --circular --extensions ts,tsx src
# Result: ✖ Found 15 circular dependencies!
```

**After**:
```bash
npx madge --circular --extensions ts,tsx src
# Result: ✖ Found 5 circular dependencies!
```

**67% Reduction** (15 → 5 cycles)

**Remaining 5 cycles** are architectural (not problematic):
1. `jobQueue.ts` ↔ `comprehensive-comp-search-v10.ts`
2. `jobQueue.ts` ↔ `comprehensive-comp-search-v5.ts`
3-5. Search orchestrator cycles for progress updates

These don't cause initialization errors because they don't involve module-level variable initialization.

---

## Lessons Learned

### 1. **Low-Level Utilities Must Have Zero High-Level Dependencies**

**Anti-Pattern** ❌:
```
redisCache.ts (utility) → imports from → jobQueue.ts (orchestrator)
```

**Correct Pattern** ✅:
```
redisCache.ts → imports from → logger.ts (standalone)
jobQueue.ts → imports from → logger.ts (standalone)
```

### 2. **Use Dependency Analysis Tools Proactively**

**Tool**: `madge` for circular dependency detection
```bash
# Add to CI/CD pipeline:
npx madge --circular --extensions ts,tsx src
```

**Recommendation**: Fail CI if cycles are introduced.

### 3. **Next.js Build Errors Can Be Cryptic**

**What we saw**:
```
ReferenceError: Cannot access 'h' before initialization
```

**What it actually meant**:
```
Circular dependency causing ambiguous module initialization order
```

**Diagnosis approach**:
- ✅ Use `madge` to detect cycles
- ✅ Check import chains manually
- ✅ Look for low-level → high-level imports
- ❌ Don't assume the error message tells the full story

### 4. **Extract Shared Utilities Early**

**When to extract**:
- Multiple modules need the same simple functionality
- The functionality doesn't need business logic dependencies
- You see import cycles forming

**Common candidates**:
- Logging utilities
- Type definitions
- Constants
- Pure functions

### 5. **Test Build Locally Before Deploying**

**Always run**:
```bash
rm -rf .next
npx next build
```

**Before**:
- Committing code
- Creating pull requests
- Deploying to staging/production

---

## Prevention: Guardrails for Future

### Add to `package.json`

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . --ext .ts,.tsx",
    "detect:cycles": "madge --circular --extensions ts,tsx src && test $(npx madge --circular --extensions ts,tsx src | wc -l) -eq 0",
    "build:strict": "npm run typecheck && npm run detect:cycles && next build"
  }
}
```

### Add to `.eslintrc.json`

```json
{
  "plugins": ["import"],
  "rules": {
    "import/no-cycle": ["error", { "maxDepth": 1 }]
  }
}
```

### CI/CD Pipeline Check

```yaml
# .github/workflows/ci.yml
- name: Check for circular dependencies
  run: npx madge --circular --extensions ts,tsx src

- name: Build application
  run: npm run build:strict
```

---

## Files Changed

**Commit**: `80738a3`
**Branch**: `v12`
**Date**: October 10, 2025

**Summary**:
- 19 files changed
- 35 insertions(+)
- 276 deletions(-)

**Created**:
- `src/server/utils/logger.ts`

**Modified**:
- 16 utility files (imports updated)
- `src/server/utils/jobQueue.ts` (removed local jobLog, uses logger)
- `src/server/vertex-freeform.js` (import updated)

---

## Related Documentation

- [Next.js Build Errors](https://nextjs.org/docs/messages)
- [Madge - Module Dependency Graph](https://github.com/pahen/madge)
- [ESLint import/no-cycle](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md)

---

## Quick Reference

**Reproduce the original issue** (for testing):
```bash
# Revert to commit before fix
git checkout 09ba60e

# Attempt build
npx next build
# Result: ReferenceError: Cannot access 'h' before initialization
```

**Verify the fix**:
```bash
# Return to fixed commit
git checkout 80738a3

# Build successfully
npx next build
# Result: ✓ Compiled successfully in 8.5s
```

---

**Document Version**: 1.0
**Last Updated**: October 10, 2025
**Status**: Issue resolved, build passing, deployed to staging-v2
