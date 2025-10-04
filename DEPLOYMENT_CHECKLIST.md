# PropertyVision Deployment Checklist

## Pre-Deployment

- [x] Google Cloud Logging integrated
- [x] Environment variables configured
- [x] Service account authentication set up
- [x] Logging tested locally
- [ ] Build passes without errors
- [ ] Frontend connected to backend API

## Environment Variables (Production)

Ensure these are set in your production environment:

```env
NODE_ENV=production
GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8
GOOGLE_APPLICATION_CREDENTIALS=/path/to/agile-device-472202-i8-319f002d9438.json
GCP_SA_JSON=/path/to/agile-device-472202-i8-319f002d9438.json
GOOGLE_MAPS_API_KEY=your-maps-api-key
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=https://enohomebuyers.com
```

## Post-Deployment Verification

### 1. Check API Health
```bash
curl https://enohomebuyers.com/api/health
```

Expected response:
```json
{"ok":true,"time":"2025-10-01T..."}
```

### 2. Test a Search
```bash
curl -X POST https://enohomebuyers.com/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"address":"185 Jordan Pl, Fayetteville, GA 30215"}'
```

### 3. Verify Logs are Being Created
Wait 1-2 minutes after deployment, then:
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 5
```

### 4. Monitor for Errors
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --limit 10
```

## Monitoring Schedule

### Daily
- Check for errors: `gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR" AND timestamp>="$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ)"'`

### Weekly
- Review slow searches: `gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND jsonPayload.metadata.executionTimeMs>10000'`
- Analyze search patterns
- Export logs for analysis: `gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api"' --limit 1000 --format=json > weekly_logs.json`

## Troubleshooting

### No logs appearing
1. Check `NODE_ENV=production` is set
2. Verify service account has Logging Writer permissions
3. Check credentials file path is correct
4. Test locally with `NODE_ENV=production npm start`

### Logs not showing in queries
1. Wait 1-2 minutes for sync
2. Check project ID matches: `agile-device-472202-i8`
3. Verify log name: `propertyvision-api`

### API errors
1. Check logs first: `gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --limit 10 --format=json`
2. Look for stack traces in `jsonPayload.metadata.errorStack`
3. Check execution times for timeout issues

## Useful Links

- [Web Console](https://console.cloud.google.com/logs/query?project=agile-device-472202-i8)
- [Logging Guide](LOGGING_GUIDE.md)
- [Cheat Sheet](LOGGING_CHEATSHEET.md)

## Rollback Plan

If issues occur after deployment:

1. Check recent errors:
```bash
gcloud logging read 'logName="projects/agile-device-472202-i8/logs/propertyvision-api" AND severity="ERROR"' --limit 20 --format=json
```

2. Revert to previous version
3. Investigate errors offline
4. Fix and redeploy
