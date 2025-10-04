# PropertyVision

Real estate property analysis and ARV (After Repair Value) calculation tool.

## Features

- Comprehensive property analysis using Google Vertex AI
- Comparable property search and filtering
- ARV calculation with confidence scores
- Bathroom and renovation analysis
- Google Cloud Logging integration for debugging and monitoring

## Setup

### Prerequisites

- Node.js 22+
- Google Cloud Platform account with Vertex AI enabled
- Google Cloud service account credentials

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# Google Cloud
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
GCP_SA_JSON=/path/to/service-account-key.json

# Google Maps API
GOOGLE_MAPS_API_KEY=your-maps-api-key
```

## Running the Application

### Development

```bash
npm run dev
```

The API will be available at `http://localhost:3001`

### Production

```bash
npm run build
npm start
```

## API Endpoints

### `GET /api/health`
Health check endpoint

**Response:**
```json
{
  "ok": true,
  "time": "2025-10-01T20:00:00.000Z"
}
```

### `POST /api/analyze`
Analyze a property and calculate ARV

**Request Body:**
```json
{
  "address": "185 Jordan Pl, Fayetteville, GA 30215",
  "userId": "optional-user-id",
  "sessionId": "optional-session-id"
}
```

**Response:**
```json
{
  "subject": { /* property details */ },
  "arv": 250000,
  "twoBathArv": 275000,
  "bathroomAnalysis": { /* analysis details */ },
  "renovationAnalysis": { /* renovation details */ },
  "compsUsed": [ /* qualified comparables */ ],
  "allComps": [ /* all comparables found */ ],
  "confidenceScores": { /* confidence metrics */ },
  "searchMetadata": { /* search metadata */ }
}
```

## Logging & Monitoring

This application uses **dual logging** to track all user searches, results, and errors:

- **Local/Dev**: Logs saved to `logs/searches.log` and `logs/error.log` files
- **Production**: Logs sent to Google Cloud Logging

### Local Development Logs

When running locally (`npm run dev`), logs are written to:
- `logs/searches.log` - All search requests and results
- `logs/error.log` - Errors only

**View local logs:**
```bash
# View all recent searches
tail -f logs/searches.log

# View errors only
tail -f logs/error.log

# Parse JSON logs (requires jq)
cat logs/searches.log | jq '.address, .arv, .executionTimeMs'
```

### Production Logs (Google Cloud)

In production (`NODE_ENV=production`), logs are sent to Google Cloud Logging.

#### Option 1: Web Console (Easiest)
Visit: https://console.cloud.google.com/logs/query?project=YOUR_PROJECT_ID

Filter: `logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api"`

#### Option 2: gcloud CLI

**Setup:**
```bash
# Authenticate (if not already done)
gcloud auth activate-service-account --key-file=/path/to/service-account.json
gcloud config set project YOUR_PROJECT_ID
```

**Common Queries:**
```bash
# View recent logs
gcloud logging read 'logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api"' --limit 10

# View errors only
gcloud logging read 'logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api" AND severity="ERROR"' --limit 20

# Search for specific address
gcloud logging read 'logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api" AND jsonPayload.metadata.address:"185 Jordan Pl"'

# Find slow searches (over 10 seconds)
gcloud logging read 'logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api" AND jsonPayload.metadata.executionTimeMs>10000'
```

### Logged Events

Each search logs three types of events:

1. **SEARCH_REQUEST** - When a search starts (includes address, user, IP)
2. **SEARCH_RESULT** - When a search completes (includes ARV, execution time, comps count)
3. **SEARCH_ERROR** - When a search fails (includes error message and stack trace)

For detailed query examples and debugging guides, see [LOGGING_GUIDE.md](LOGGING_GUIDE.md)

## Project Structure

```
PropertyVision1/
├── server/
│   ├── index.ts                          # Main API server
│   ├── comprehensive-comp-search-v3.js   # Comp search logic
│   └── utils/
│       └── logger.ts                     # Google Cloud Logging setup
├── frontend/                             # Next.js frontend
├── .env                                  # Environment variables
├── package.json
├── LOGGING_GUIDE.md                      # Comprehensive logging documentation
└── README.md
```

## Development

### Build

```bash
npm run build
```

### Type Check

```bash
npm run typecheck
```

## Deployment

The application is deployed at: **enohomebuyers.com**

After deployment, all user searches are automatically logged to Google Cloud for monitoring and debugging.

## Support

For issues or questions, check the logs first:
```bash
gcloud logging read 'logName="projects/YOUR_PROJECT_ID/logs/propertyvision-api" AND severity="ERROR"' --limit 10 --format=json
```

## License

MIT
