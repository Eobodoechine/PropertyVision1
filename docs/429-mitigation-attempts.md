# Vertex AI 429 Error Mitigation Attempts

## Problem Statement

PropertyVision experiences chronic 429 (RESOURCE_EXHAUSTED) errors when running multiple simultaneous jobs that call Vertex AI APIs. The errors appear to be caused by Google's Dynamic Shared Quota (DSQ) burst detection system, which throttles requests when it detects "bursty" traffic patterns across a project.

**Root Cause:** Vertex AI's DSQ system detects burst patterns and applies rate limiting at the project level, affecting all concurrent jobs even when each individual job is well-behaved.

**Impact:**
- Jobs fail with 40-50% of API calls returning 429 errors
- Retry logic can't recover (retries also hit 429s)
- User experience degraded significantly with simultaneous jobs

---

## Test History

### Test S1: Baseline (3 simultaneous jobs, VERTEX_CONCURRENCY_LIMIT=16)
**Date:** 2025-11-11
**Configuration:**
- Concurrency per job: 16
- No pacing
- No phase offset
- 3 jobs submitted simultaneously

**Results:**
| Job | 429 Errors | Total Attempts | 429% Rate |
|-----|------------|----------------|-----------|
| Job 1 | 41 | N/A | ~40% |
| Job 2 | 53 | N/A | ~40-50% |
| Job 3 | Failed early | N/A | N/A |
| **Average** | **47** | N/A | **~42%** |

**Verdict:** ❌ **FAIL** - Baseline established. High 429% rate confirms DSQ is triggering on simultaneous jobs.

**Key Findings:**
- 429 errors appear almost immediately (within seconds)
- All 3 jobs competing for same quota bucket
- Retry logic ineffective (retries also hit 429s)

---

### Test S2: Reduced Concurrency (3 simultaneous jobs, VERTEX_CONCURRENCY_LIMIT=10)
**Date:** 2025-11-11
**Configuration:**
- Concurrency per job: 10 (reduced from 16)
- No pacing
- No phase offset
- 3 jobs submitted simultaneously

**Results:**
| Job | 429 Errors | Total Attempts | 429% Rate |
|-----|------------|----------------|-----------|
| Job 1 | 41 | N/A | Similar to S1 |
| Job 2 | 43 | N/A | Similar to S1 |
| Job 3 | 44 | N/A | Similar to S1 |
| **Average** | **42.7** | N/A | **~40%** |

**Verdict:** ❌ **FAIL** - Minimal improvement (47 → 42.7 average 429s)

**Key Findings:**
- Reducing concurrency from 16 to 10 had negligible impact
- Suggests DSQ is detecting project-wide burst pattern, not per-job concurrency
- Still experiencing ~40% 429 rate

---

### Test S3: Further Reduced Concurrency (3 simultaneous jobs, VERTEX_CONCURRENCY_LIMIT=6)
**Date:** 2025-11-12
**Configuration:**
- Concurrency per job: 6 (reduced from 10)
- No pacing
- No phase offset
- 3 jobs submitted simultaneously

**Results:**
| Job | 429 Errors | Total Attempts | 429% Rate |
|-----|------------|----------------|-----------|
| Job 1 (`3e6f793a`) | 53 | N/A | ~45% |
| Job 2 (`caacae4c`) | 52 | N/A | ~45% |
| Job 3 (`ca15ceec`) | 0 (failed early) | N/A | N/A |
| **Average** | **52.5** | N/A | **~45%** |

**Verdict:** ❌ **FAIL** - Actually WORSE than S1/S2 (52.5 vs 47 avg)

**Key Findings:**
- Reducing concurrency to 6 made things WORSE
- 429% rate increased to ~45%
- Confirms that simple concurrency reduction is not the solution
- DSQ likely has a minimum burst threshold regardless of concurrency

---

### Test S4 / Phase A: Low-and-Slow Pacing (VERTEX_CONCURRENCY_LIMIT=2 + Jittered Delays)
**Date:** 2025-11-12
**Configuration:**
- Concurrency per job: 2 (minimal)
- Pacing: 300ms ± 50ms jittered delays between requests
- Phase offset: 0-350ms random startup delay per job
- 3 jobs submitted simultaneously

**Code Changes:**
- Added phase offset logic to [step3-find-comparables.ts](../src/server/step3-find-comparables.ts:243-248)
- Added jittered pacing inside p-limit callback
- Added structured JSON logging for metrics collection
- Added structured logging to [vertex-details.ts](../src/server/vertex-details.ts:8-13)

**Results:**
| Job | 429 Errors | Total Attempts | 429% Rate | First-429 Lag | Verdict |
|-----|------------|----------------|-----------|---------------|---------|
| Job 1 (`20426ceb`) | N/A | N/A | N/A | N/A | Failed (no logs) |
| Job 2 (`e6d95355`) | 28 | 26 | **107%** | **0.19s** | ❌ FAIL |
| Job 3 (`910bdae5`) | 29 | 5 | **580%** | **-0.30s** | ❌ FAIL |

**Pass Criteria (both must pass):**
- ✅ 429% ≤ 5% per job
- ✅ First-429 lag ≥ 60 seconds

**Verdict:** ❌ **FAIL** - Dramatically worse than baseline

**Key Findings:**
1. **Phase A made things WORSE** - 429 errors appeared within 190ms (vs goal of 60+ seconds)
2. **429% > 100%** - More 429 errors than API attempts, indicating retry loops hitting 429s
3. **Pacing completely ineffective** - 300ms delays had no impact on burst detection
4. **First-429 came almost immediately** - 0.19s suggests DSQ burst window is VERY short
5. **Job 1 failed completely** - No structured logs, likely crashed immediately

**Why Phase A Failed:**
- 300ms pacing still too aggressive for DSQ
- Even concurrency=2 triggers burst detection
- Phase offset (0-350ms) too small to desynchronize jobs
- DSQ's burst detection window appears to be **much shorter than 60 seconds**
- Likely monitoring aggregated project-wide QPS in short time windows (seconds or less)

**Average QPS:**
- Job 2: 0.50 QPS
- Job 3: 0.34 QPS
- Total: ~1 QPS combined (well below typical rate limits, but still triggering DSQ)

---

## Patterns & Insights

### What We've Learned

1. **Concurrency reduction alone doesn't work**
   - Tests S1 → S2 → S3 showed reducing from 16 → 10 → 6 had no meaningful impact
   - In fact, S3 (concurrency=6) performed WORSE than S1 (concurrency=16)

2. **Pacing doesn't prevent DSQ burst detection**
   - Phase A's 300ms ± 50ms jitter completely failed
   - 429s came within 190ms of job start
   - Suggests DSQ monitoring is at sub-second granularity

3. **DSQ detects project-wide patterns**
   - 3 simultaneous jobs consistently trigger burst detection
   - Individual job behavior (low QPS, pacing, etc.) doesn't matter
   - DSQ appears to aggregate across all active jobs in the project

4. **The burst detection window is VERY short**
   - First-429 lag of 0.19s in Phase A
   - Negative lag (-0.30s) in Job 3 suggests 429s from previous jobs still affecting new jobs
   - Window likely measured in seconds or less, not minutes

5. **Retry logic makes things worse**
   - 429% rates > 100% indicate retry loops
   - Retrying 429 errors adds to perceived burst
   - Standard exponential backoff insufficient for DSQ

### What Doesn't Work

❌ **Reducing concurrency** (16 → 10 → 6 → 2)
❌ **Adding jittered delays** (300ms ± 50ms)
❌ **Phase offset desync** (0-350ms)
❌ **Low QPS targets** (~0.5 QPS still triggers DSQ)
❌ **Exponential backoff retries** (retries also hit 429s)

---

## Next Steps / Potential Solutions

### Phase B: Extreme Throttling + RetryInfo Parsing
- Concurrency = 1 per job
- Parse `RetryInfo` headers from 429 responses
- Much longer delays (1000ms+ between requests)
- **Likelihood of success:** Low (if 300ms didn't work, 1000ms unlikely to be enough)

### Phase C: Architecture Changes

1. **Cloud Run Jobs (Recommended)**
   - Deploy each analysis job as a separate Cloud Run Job
   - Each job gets its own DSQ quota bucket
   - Isolates jobs from each other
   - **Likelihood of success:** High

2. **Token Bucket with Redis**
   - Centralized rate limiting across all workers
   - Enforce strict project-wide QPS limits
   - **Likelihood of success:** Medium (still shares same quota bucket)

3. **Sequential Processing**
   - Queue jobs and process one at a time
   - Eliminates simultaneous job contention
   - **Likelihood of success:** High (but slow)

4. **Request Vertex AI Quota Increase**
   - Contact Google Cloud Support
   - Request higher burst threshold or disable DSQ
   - **Likelihood of success:** Unknown

---

## Test Template

### Test SX: [Test Name]
**Date:** YYYY-MM-DD
**Configuration:**
- Parameter 1: value
- Parameter 2: value

**Results:**
| Job | 429 Errors | Total Attempts | 429% Rate | Additional Metrics |
|-----|------------|----------------|-----------|-------------------|
| Job 1 | X | Y | Z% | ... |
| Job 2 | X | Y | Z% | ... |
| Job 3 | X | Y | Z% | ... |

**Verdict:** ❌ FAIL / ✅ PASS

**Key Findings:**
- Finding 1
- Finding 2

---

## Analysis Files

- Metrics script: [`analyze-s4-metrics.sh`](../analyze-s4-metrics.sh)
- Download script: [`download-job-logs.sh`](../download-job-logs.sh)
- Test logs: [`logs/`](../logs/)
- Implementation:
  - [`step3-find-comparables.ts`](../src/server/step3-find-comparables.ts)
  - [`vertex-details.ts`](../src/server/vertex-details.ts)

---

**Last Updated:** 2025-11-12
**Status:** Phase A Failed - Evaluating Phase B/C options
