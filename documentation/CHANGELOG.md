# Changelog

All notable changes to PropertyVision will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Critical: Fixed geocoding validation to catch invalid cached coordinates** (2025-10-10)
  - **Problem**: Stale Redis cache entries with invalid coordinates (null, undefined, or 0) were passing the old validation check (`!c.lat || !c.lon`), causing comparables to fail distance calculation with 999mi sentinel values, resulting in "insufficient_data" errors when only 2-3 of 14-16 comps qualified for ARV calculation
  - **Root Cause**: The old check only validated existence (`!c.lat`), not validity, so cached comps with `lat: 0, lon: 0` or `lat: null` would pass validation but fail distance calculation
  - **Solution**: Implemented `isValidCoordinate()` helper function in `parallelSearchOrchestrator.ts:555-559` that validates coordinates are:
    - Type `number` (catches null, undefined, missing fields)
    - Non-zero (catches `lat: 0, lon: 0` from failed geocoding)
    - Non-NaN (catches corrupted numeric values)
  - **Impact**: Ensures backup geocoding triggers for all comps with invalid coordinates before progressive pass filtering, preventing 999mi sentinel values from causing comp rejection
  - **Files Changed**:
    - `src/server/utils/parallelSearchOrchestrator.ts` (lines 553-559)
  - **Testing**:
    - Local tests with "1100 Water Shine Way, Snellville, GA 30078" achieved 6 qualifying comps (target met)
    - Validation runs before progressive pass filtering (after Top-K selection, before distance filtering)
  - **Related**: See [REDIS_CACHE_MANAGEMENT.md](REDIS_CACHE_MANAGEMENT.md) for cache validation and maintenance procedures

## [Previous Updates]

_This changelog was created on 2025-10-10. Previous changes are not documented here._
