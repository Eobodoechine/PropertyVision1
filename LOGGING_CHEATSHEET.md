# PropertyVision Logging Cheat Sheet

Quick reference for common logging queries.

## Setup (One-time)
```bash
gcloud auth activate-service-account --key-file=/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json
gcloud config set project agile-device-472202-i8
```

## Most Common Queries

### 1. Show recent searches
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 10
```

### 2. Show errors only
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --limit 20
```

### 3. Search specific address
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.address:"ADDRESS_HERE"'
```

### 4. Find slow searches (>10 seconds)
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.executionTimeMs>10000'
```

### 5. Export to JSON for analysis
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 100 --format=json > logs.json
```

## Web Console
https://console.cloud.google.com/logs/query?project=agile-device-472202-i8

Query:
```
logName="projects/agile-device-472202-i8/logs/propertyvision-api"
```

## Shortcut Alias (Optional)
Add to `~/.zshrc`:
```bash
alias pv-logs='gcloud logging read "logName=\"projects/agile-device-472202-i8/logs/propertyvision-api\""'
```

Then use:
```bash
pv-logs --limit 10
pv-logs 'AND severity="ERROR"' --limit 20
```
