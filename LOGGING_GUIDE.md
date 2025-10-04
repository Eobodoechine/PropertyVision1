# Google Cloud Logging Guide for PropertyVision

This guide explains how to query and analyze user search logs from the PropertyVision API.

## Setup

### 1. Install gcloud CLI (Already Done)
The Google Cloud SDK is installed at `~/google-cloud-sdk/bin/gcloud`

### 2. Authenticate
```bash
gcloud auth activate-service-account --key-file=/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json
gcloud config set project agile-device-472202-i8
```

## What Gets Logged

Every user search logs the following events:

### 1. **SEARCH_REQUEST** - When a search starts
- `address` - The address being searched
- `userId` - User ID (if available)
- `sessionId` - Session ID (if available)
- `ip` - User's IP address
- `timestamp` - When the search started

### 2. **SEARCH_RESULT** - When a search completes successfully
- `address` - The address searched
- `arv` - Calculated ARV value
- `twoBathArv` - 2-bathroom ARV value
- `compsCount` - Total comparables found
- `qualifiedCompsCount` - Qualified comparables used
- `executionTimeMs` - How long the search took
- `success` - Always true for successful searches

### 3. **SEARCH_ERROR** - When a search fails
- `address` - The address that failed
- `errorMessage` - Error description
- `errorStack` - Full stack trace for debugging
- `stage` - Which stage failed (validation, analysis, etc.)

## Query Examples

### Basic Queries

#### 1. View all recent logs (last 10)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 10
```

#### 2. View logs from the last hour
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND timestamp>="2025-10-01T19:00:00Z"' --limit 50
```

#### 3. View logs from today
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND timestamp>="`date -u +%Y-%m-%dT00:00:00Z`"'
```

### Filter by Event Type

#### 4. All search requests
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.eventType="SEARCH_REQUEST"' --limit 20
```

#### 5. All successful searches
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.eventType="SEARCH_RESULT"' --limit 20
```

#### 6. All failed searches (errors only)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --limit 20
```

### Search by Address

#### 7. Find searches for a specific address
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.address:"185 Jordan Pl"' --limit 10
```

#### 8. Find searches in a specific city
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.address:"Fayetteville, GA"' --limit 10
```

### Search by User

#### 9. Find searches by specific user
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.userId="USER_ID_HERE"' --limit 10
```

#### 10. Find searches by session
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.sessionId="SESSION_ID_HERE"' --limit 10
```

### Performance Analysis

#### 11. Find slow searches (over 10 seconds)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.executionTimeMs>10000' --limit 20
```

#### 12. Average execution time (export to JSON and analyze)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.eventType="SEARCH_RESULT"' --format=json --limit 100 > search_results.json
```

### Debugging Failed Searches

#### 13. Get error details with stack traces
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --format=json --limit 10
```

#### 14. Group errors by message
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --format="value(jsonPayload.metadata.errorMessage)" --limit 50
```

### Output Formats

#### JSON format (for analysis/scripting)
```bash
gcloud logging read 'QUERY' --format=json
```

#### Table format (human-readable)
```bash
gcloud logging read 'QUERY' --format=table
```

#### Custom format (specific fields only)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --format="table(timestamp, jsonPayload.metadata.address, jsonPayload.metadata.arv)"
```

## Web Console Access

For a visual interface, visit:
https://console.cloud.google.com/logs/query?project=agile-device-472202-i8

Then use this query:
```
logName="projects/agile-device-472202-i8/logs/propertyvision-api"
```

## Common Use Cases

### Debug a specific user's issue
1. Get their session ID from the frontend
2. Query all logs for that session:
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.sessionId="SESSION_ID"' --format=json
```

### Monitor error rate
```bash
# Count errors in last hour
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR" AND timestamp>="'$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"' --format="value(timestamp)" | wc -l
```

### Export logs for analysis
```bash
# Export last 1000 searches to JSON
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 1000 --format=json > logs_export.json
```

## Tips

1. **Time zones**: All timestamps are in UTC
2. **Limits**: Default limit is 10, max is 1000 per query
3. **Sorting**: Logs are sorted newest first by default
4. **Escaping**: Use double quotes for string values in queries
5. **Performance**: More specific queries = faster results

## Quick Reference

| What you want | Query Filter |
|--------------|--------------|
| All logs | `logName="projects/agile-device-472202-i8/logs/propertyvision-api"` |
| Errors only | `severity="ERROR"` |
| Specific address | `jsonPayload.metadata.address:"SEARCH_TEXT"` |
| Specific user | `jsonPayload.metadata.userId="USER_ID"` |
| Time range | `timestamp>="2025-10-01T00:00:00Z"` |
| Slow searches | `jsonPayload.metadata.executionTimeMs>10000` |

## Need Help?

- [Google Cloud Logging Documentation](https://cloud.google.com/logging/docs)
- [Query Language Syntax](https://cloud.google.com/logging/docs/view/logging-query-language)
