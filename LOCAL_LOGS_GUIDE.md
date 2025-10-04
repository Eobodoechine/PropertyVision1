# Local Logging Guide

When running PropertyVision locally (development mode), all logs are saved to files in the `logs/` directory.

## Log Files

### `logs/searches.log`
Contains ALL logs (info + errors):
- Search requests
- Search results with ARV calculations
- Errors

### `logs/error.log`
Contains ONLY error logs:
- Failed searches
- Stack traces
- Error details

## Viewing Logs

### Real-time monitoring
```bash
# Watch all searches as they happen
tail -f logs/searches.log

# Watch errors only
tail -f logs/error.log
```

### View recent entries
```bash
# Last 10 searches
tail -10 logs/searches.log

# Last 5 errors
tail -5 logs/error.log
```

### View all logs
```bash
cat logs/searches.log
cat logs/error.log
```

## Parsing JSON Logs

The logs are in JSON format, one entry per line. You can use `jq` to parse them:

### Install jq (if needed)
```bash
brew install jq
```

### Extract specific fields
```bash
# Get all addresses searched
cat logs/searches.log | jq -r 'select(.eventType=="SEARCH_REQUEST") | .address'

# Get ARV values
cat logs/searches.log | jq -r 'select(.eventType=="SEARCH_RESULT") | "\(.address): $\(.arv)"'

# Get execution times
cat logs/searches.log | jq -r 'select(.executionTimeMs) | "\(.address): \(.executionTimeMs)ms"'

# Get error messages
cat logs/error.log | jq -r '.errorMessage'

# Get full error stack traces
cat logs/error.log | jq -r '.errorStack'
```

### Filter by criteria
```bash
# Find searches for a specific address
cat logs/searches.log | jq 'select(.address | contains("Jordan Pl"))'

# Find slow searches (over 5 seconds)
cat logs/searches.log | jq 'select(.executionTimeMs > 5000)'

# Find searches by user
cat logs/searches.log | jq 'select(.userId == "USER_ID_HERE")'

# Find searches by session
cat logs/searches.log | jq 'select(.sessionId == "SESSION_ID_HERE")'
```

### Count and statistics
```bash
# Count total searches
cat logs/searches.log | jq -s 'map(select(.eventType=="SEARCH_REQUEST")) | length'

# Count errors
cat logs/error.log | wc -l

# Average execution time
cat logs/searches.log | jq -s 'map(select(.executionTimeMs)) | map(.executionTimeMs) | add / length'
```

## Debugging a User Issue

If a user reports a problem:

1. **Get their session ID** from the frontend
2. **Find all logs for that session:**
   ```bash
   cat logs/searches.log | jq 'select(.sessionId == "SESSION_ID_HERE")'
   ```
3. **Check for errors:**
   ```bash
   cat logs/error.log | jq 'select(.sessionId == "SESSION_ID_HERE")'
   ```
4. **Check execution time:**
   ```bash
   cat logs/searches.log | jq 'select(.sessionId == "SESSION_ID_HERE" and .executionTimeMs)'
   ```

## Clean Up Old Logs

```bash
# Clear all logs
> logs/searches.log
> logs/error.log

# Or delete and recreate
rm logs/*.log
touch logs/searches.log logs/error.log
```

## Log Rotation (Optional)

For long-running local development, you might want to rotate logs:

```bash
# Backup current logs
mv logs/searches.log logs/searches.$(date +%Y%m%d).log
mv logs/error.log logs/error.$(date +%Y%m%d).log

# Create fresh log files
touch logs/searches.log logs/error.log

# Delete old backups (older than 7 days)
find logs -name "*.log" -mtime +7 -delete
```

## Tips

1. **Log format**: Each line is a complete JSON object
2. **Timestamps**: All times are in ISO 8601 format (UTC)
3. **Performance**: Use `jq -c` for compact output, omit `-c` for pretty printing
4. **Real-time**: Use `tail -f` to watch logs as they're written
5. **Search**: Use `grep` for simple text searches before parsing JSON

## Common Patterns

### Find all errors for a specific address
```bash
cat logs/error.log | jq -r 'select(.address | contains("SEARCH_TEXT")) | "\(.timestamp) - \(.errorMessage)"'
```

### List unique addresses searched today
```bash
cat logs/searches.log | jq -r 'select(.eventType=="SEARCH_REQUEST") | .address' | sort -u
```

### Performance report
```bash
cat logs/searches.log | jq -s 'map(select(.executionTimeMs)) | {
  count: length,
  avg: (map(.executionTimeMs) | add / length),
  min: (map(.executionTimeMs) | min),
  max: (map(.executionTimeMs) | max)
}'
```
