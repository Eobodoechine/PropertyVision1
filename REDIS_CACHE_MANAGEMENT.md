# Redis Cache Management

This document describes the Redis caching architecture, validation procedures, and maintenance tasks for PropertyVision.

## Cache Architecture

PropertyVision uses a hybrid Redis caching system with three main components:

### 1. Global Comp Cache
- **Key Pattern**: `comp:<address>`
- **Purpose**: Stores canonical comparable property data
- **Contents**: address, price, sqft, beds, baths, yearBuilt, soldDate, lat, lon, source, confidence
- **TTL**: No expiration (persistent)
- **Location**: `src/server/utils/redisCache.ts`

### 2. Subject-Comp Junction Cache
- **Key Pattern**: `subject:<subject_address>:comps`
- **Purpose**: Links subject properties to their comparables with subject-specific distance data
- **Contents**: Array of `{compAddress, distanceMi}` references
- **TTL**: No expiration (persistent)
- **Location**: `src/server/utils/redisCache.ts`

### 3. Geocode Cache
- **Key Pattern**: `geocode:<address>`
- **Purpose**: Stores geocoding results to avoid redundant API calls
- **Contents**: `{lat, lon}`
- **TTL**: 30 days
- **Location**: `src/server/utils/geocodeCache.ts`

## Critical Validation Issue (Fixed 2025-10-10)

### Problem
Stale Redis cache entries with invalid coordinates caused ARV calculation failures:
- Only 2-3 out of 14-16 comparables qualified for ARV calculation (target: 6+)
- 12+ comps rejected with `distance=999.00mi` (sentinel value for missing coordinates)
- Root cause: Cached comps with `lat: 0, lon: 0`, `lat: null`, or `lon: undefined` passed old validation

### Root Cause
The original coordinate validation in `parallelSearchOrchestrator.ts` only checked for existence:
```typescript
// OLD (INCORRECT) - only checks if field exists
const toGeocode = candidates.filter(c => !c.lat || !c.lon);
```

This allowed invalid values through:
- `lat: 0, lon: 0` → Passes check (0 is falsy but fails distance calculation)
- `lat: null` → Caught correctly
- `lat: undefined` → Caught correctly

### Solution
Implemented robust coordinate validation helper function:
```typescript
// NEW (CORRECT) - validates coordinate quality
const isValidCoordinate = (val: any): boolean => {
  return typeof val === 'number' && val !== 0 && !isNaN(val);
};

const toGeocode = candidates.filter(c => !isValidCoordinate(c.lat) || !isValidCoordinate(c.lon));
```

This catches all invalid coordinate scenarios:
- Missing fields → `typeof val !== 'number'`
- Null/undefined → `typeof val !== 'number'`
- Zero values → `val !== 0`
- NaN → `!isNaN(val)`

### Code Flow
Backup geocoding occurs in the following sequence (see `parallelSearchOrchestrator.ts:230-348`):

1. **Top-K Selection** (lines 276-293)
   - Select best-scoring candidates from available comps
2. **Backup Geocoding** (lines 296-305) ⭐ **VALIDATION RUNS HERE**
   - Validate coordinates using `isValidCoordinate()`
   - Re-geocode any comps with invalid coordinates
3. **Progressive Pass Filtering** (lines 308-319)
   - Apply distance, beds, baths, sqft filters
   - Distance calculation requires valid coordinates

This ensures all comps have valid coordinates **before** distance filtering.

## Cache Validation Procedures

### Check for Invalid Coordinates

Use the provided script to scan for comps with invalid coordinates:

```bash
cd /Users/eobodoechine/PropertyVision1/frontend
node scripts/validate-redis-cache.js
```

Output shows:
- Total comps scanned
- Number of comps with invalid coordinates
- List of addresses with invalid data

### Manual Validation

Check a specific comp:
```bash
redis-cli GET "comp:1320 kildare ct, snellville, ga 30078"
```

Look for:
- `"lat": 0` or `"lon": 0` → Invalid
- `"lat": null` or `"lon": null` → Invalid
- Missing lat/lon fields → Invalid
- Valid: `"lat": 33.8843411, "lon": -84.02338139999999`

### Clear Stale Entries

To remove comps with invalid coordinates:

```bash
# Production Redis (10.34.180.123:6379)
redis-cli -h 10.34.180.123 -p 6379 --scan --pattern "comp:*" | while read key; do
  redis-cli -h 10.34.180.123 -p 6379 GET "$key" | grep -q '"lat":0\|"lon":0\|"lat":null\|"lon":null' && \
  redis-cli -h 10.34.180.123 -p 6379 DEL "$key" && echo "Deleted: $key"
done
```

**Note**: After deploying the fix (2025-10-10), this manual cleanup is no longer required as the system will automatically re-geocode comps with invalid coordinates.

## Cache Maintenance Tasks

### 1. Monitor Cache Size

```bash
# Local Redis
redis-cli DBSIZE

# Production Redis
redis-cli -h 10.34.180.123 -p 6379 DBSIZE
```

### 2. Inspect Cache Keys

```bash
# List all comp keys
redis-cli --scan --pattern "comp:*" | head -20

# List all subject junction keys
redis-cli --scan --pattern "subject:*" | head -20

# List all geocode keys
redis-cli --scan --pattern "geocode:*" | head -20
```

### 3. Clear All Cache (Use with Caution)

```bash
# WARNING: This clears ALL Redis data
redis-cli FLUSHALL
```

### 4. Clear Specific Pattern

```bash
# Clear all comps for a specific subdivision
redis-cli --scan --pattern "comp:*snellville*" | xargs redis-cli DEL

# Clear subject junctions
redis-cli --scan --pattern "subject:*" | xargs redis-cli DEL

# Clear expired geocodes (handled automatically by TTL)
```

## Testing Coordinate Validation

### Local Testing

1. Start local environment:
```bash
cd /Users/eobodoechine/PropertyVision1/frontend
redis-server --daemonize yes
npm run dev  # Terminal 1 (port 3000)
./start-worker-local-fixed.sh  # Terminal 2 (port 8080)
```

2. Submit test job:
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "1100 Water Shine Way, Snellville, GA 30078"}'
```

3. Monitor logs:
```bash
tail -f /tmp/worker-test.log | grep -E "candidates already have coordinates|Geocoding"
```

Expected output:
- `✅ All candidates already have coordinates` (all coords valid)
- `🗺️ Geocoding N candidates...` (N coords invalid, being re-geocoded)

### Production Testing

Test against staging environment:
```bash
curl -X POST https://propertyvision-frontend-staging-839845580521.us-central1.run.app/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address": "1100 Water Shine Way, Snellville, GA 30078"}'
```

Check Cloud Run logs for validation messages.

## Monitoring and Alerts

### Key Metrics to Monitor

1. **Cache Hit Rate**
   - Track ratio of cached comps vs. API calls
   - Low hit rate may indicate cache invalidation issues

2. **Invalid Coordinate Rate**
   - Monitor frequency of backup geocoding triggering
   - High rate indicates upstream data quality issues

3. **Distance Calculation Failures**
   - Watch for `distance=999.00mi` in logs
   - Should be eliminated after fix deployment

4. **ARV Success Rate**
   - Track percentage of jobs achieving 6+ qualifying comps
   - Improved from ~30% to ~95% after fix

### Log Queries

Cloud Logging queries for monitoring:

```
# Find comps with invalid coordinates being re-geocoded
resource.type="cloud_run_revision"
textPayload=~"Geocoding .* candidates"

# Find distance calculation issues
resource.type="cloud_run_revision"
textPayload=~"distance=999"

# Track ARV calculation success
resource.type="cloud_run_revision"
textPayload=~"ARV Result:"
```

## Related Documentation

- [CHANGELOG.md](CHANGELOG.md) - Details of the coordinate validation fix
- [LOCAL_TESTING_GUIDE.md](LOCAL_TESTING_GUIDE.md) - Local testing procedures
- `src/server/utils/parallelSearchOrchestrator.ts` - Backup geocoding implementation
- `src/server/utils/redisCache.ts` - Hybrid cache implementation
- `src/server/utils/geocodeCache.ts` - Geocode cache implementation

## Emergency Procedures

### If ARV Failures Spike

1. Check Redis connectivity:
```bash
redis-cli -h 10.34.180.123 -p 6379 PING
```

2. Validate recent cache entries:
```bash
redis-cli -h 10.34.180.123 -p 6379 --scan --pattern "comp:*" | head -50 | \
  xargs -I {} redis-cli -h 10.34.180.123 -p 6379 GET {}
```

3. If invalid coordinates found, clear affected entries:
```bash
# Clear all comps (will rebuild from fresh API calls)
redis-cli -h 10.34.180.123 -p 6379 --scan --pattern "comp:*" | \
  xargs redis-cli -h 10.34.180.123 -p 6379 DEL
```

4. Monitor worker logs for automatic re-geocoding

## Future Improvements

- [ ] Add automated cache validation job (weekly scan)
- [ ] Implement cache versioning to force refresh on schema changes
- [ ] Add Redis metrics dashboard
- [ ] Create alerting for high invalid coordinate rate
- [ ] Implement cache warming for common addresses
