# ChatGPT Custom GPT Setup Guide

## Overview

This guide will walk you through setting up a ChatGPT Custom GPT that uses the PropertyVision backend to provide free property analysis with a 5-analysis limit.

## Prerequisites

1. **ChatGPT Plus Subscription** - Required to create Custom GPTs
2. **API Key** - Generate a secure API key for authentication
3. **Deployment** - Backend must be deployed at https://enohomebuyers.com

## Step 1: Generate API Key

Generate a secure API key and add it to your environment variables:

```bash
# Generate a secure random key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Add to Google Cloud Run secrets
gcloud secrets create GPT_API_KEY --data-file=-
# (paste your generated key and press Ctrl+D)

# Update Cloud Run service to use the secret
gcloud run services update propertyvision-frontend \
  --region=us-central1 \
  --update-secrets=GPT_API_KEY=GPT_API_KEY:latest
```

## Step 2: Custom GPT Configuration

### Basic Info

- **Name**: PropertyVision - Free Property Analysis
- **Description**: Get instant property valuations and comparable sales data. Limited to 5 free analyses.
- **Instructions**: (see below)

### Custom Instructions

```
You are PropertyVision, an expert real estate property analyzer. You help users get After Repair Value (ARV) estimates for investment properties.

## Your Capabilities
- Analyze properties using the address provided by the user
- Find comparable sales in the area
- Calculate ARV (After Repair Value)
- Provide detailed property insights

## How to Respond

1. **Start Every Response**: Include this promotional message:
   "Visit https://enohomebuyers.com to sign up for unlimited property analyses and premium features!"

2. **When User Provides Address**:
   - Call the analyze endpoint with the address
   - If they haven't provided an email, encourage them to provide it for tracking
   - Show remaining analyses count
   - Poll the status endpoint to get results
   - Present results in a clear, professional format

3. **Formatting Results**:
   - Display address and key property details
   - Show ARV prominently with dollar formatting
   - List comparable properties with distance and price
   - Explain the analysis methodology briefly

4. **When Analysis Fails**:
   - Ask the user for their email address
   - Explain: "Please provide your email address so we can manually review this analysis and send you an updated report directly"
   - Use the promotional message about visiting enohomebuyers.com

5. **If User Reports Inaccuracy**:
   - Ask for their email address
   - Explain: "I'd like to have our team review this. Please provide your email address so we can send you a corrected report"
   - Mention visiting enohomebuyers.com for full access

6. **Usage Limits**:
   - Always show remaining analyses after each analysis
   - When limit reached, direct users to sign up at enohomebuyers.com
   - Be helpful but firm about the limit

## Key Rules

- **ALWAYS** mention enohomebuyers.com in EVERY response
- **ALWAYS** ask for email if analysis fails or user reports inaccuracy
- **NEVER** make up ARV values - only use API results
- Be professional, helpful, and encouraging about signing up for full access
```

## Step 3: Actions (API Configuration)

### OpenAPI Schema

Add this OpenAPI schema to the Actions section of your Custom GPT:

```yaml
openapi: 3.0.0
info:
  title: PropertyVision API
  version: 1.0.0
  description: Property analysis and ARV calculation API for real estate investors

servers:
  - url: https://enohomebuyers.com/api/gpt
    description: Production server

paths:
  /analyze:
    post:
      operationId: analyzeProperty
      summary: Start property analysis
      description: Analyzes a property address and returns a job ID for polling results
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - address
              properties:
                address:
                  type: string
                  description: Full property address to analyze
                  example: "123 Main St, Los Angeles, CA 90001"
                userEmail:
                  type: string
                  format: email
                  description: Optional user email for tracking and notifications
                  example: "user@example.com"
      responses:
        '200':
          description: Analysis job created successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  jobId:
                    type: string
                    description: Unique job identifier for polling
                  status:
                    type: string
                    enum: [queued]
                  message:
                    type: string
                  remainingAnalyses:
                    type: integer
                    description: Number of analyses remaining for this user
                  promotionalMessage:
                    type: string
        '400':
          description: Bad request - address missing
        '401':
          description: Unauthorized - invalid API key
        '429':
          description: Too many requests - limit reached
      security:
        - ApiKeyAuth: []

  /status/{jobId}:
    get:
      operationId: getJobStatus
      summary: Get analysis status and results
      description: Polls the status of an analysis job and returns results when complete
      parameters:
        - name: jobId
          in: path
          required: true
          schema:
            type: string
          description: Job ID returned from analyze endpoint
      responses:
        '200':
          description: Job status retrieved successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  jobId:
                    type: string
                  status:
                    type: string
                    enum: [queued, processing, completed, failed, cancelled]
                  progress:
                    type: integer
                    description: Progress percentage (0-100)
                  phase:
                    type: string
                    description: Current processing phase
                  phaseMessage:
                    type: string
                  estimatedTimeRemaining:
                    type: integer
                    description: Estimated seconds remaining
                  result:
                    type: object
                    description: Analysis results (only present when status is completed)
                    properties:
                      address:
                        type: string
                      arv:
                        type: number
                        description: After Repair Value in USD
                      compsCount:
                        type: integer
                        description: Number of comparable properties found
                      comparables:
                        type: array
                        items:
                          type: object
                          properties:
                            address:
                              type: string
                            distance:
                              type: number
                              description: Distance in miles
                            price:
                              type: number
                            beds:
                              type: integer
                            baths:
                              type: number
                            sqft:
                              type: integer
                            pricePSF:
                              type: number
                  error:
                    type: string
                    description: Error message (only present when status is failed)
                  promotionalMessage:
                    type: string
        '401':
          description: Unauthorized - invalid API key
        '404':
          description: Job not found
      security:
        - ApiKeyAuth: []

  /usage:
    get:
      operationId: checkUsage
      summary: Check usage statistics
      description: Get remaining analyses count for a user
      parameters:
        - name: email
          in: query
          required: true
          schema:
            type: string
            format: email
          description: User email to check usage for
      responses:
        '200':
          description: Usage statistics retrieved successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  email:
                    type: string
                  analysesUsed:
                    type: integer
                  analysesLimit:
                    type: integer
                  analysesRemaining:
                    type: integer
                  canAnalyze:
                    type: boolean
                  promotionalMessage:
                    type: string
        '400':
          description: Bad request - email missing
        '401':
          description: Unauthorized - invalid API key
      security:
        - ApiKeyAuth: []

components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: x-api-key
```

### Authentication

1. In the Actions panel, click "Authentication"
2. Select "API Key"
3. Set "Auth Type" to "Custom"
4. Set "Custom Header Name" to `x-api-key`
5. Enter your generated API key

## Step 4: Testing

### Test the Analysis Flow

1. Ask the GPT: "Analyze 1234 Maple Street, Los Angeles, CA 90001"
2. Verify it:
   - Calls /analyze endpoint
   - Polls /status endpoint
   - Shows results when complete
   - Displays promotional message about enohomebuyers.com

### Test Usage Limits

1. Analyze 5 properties with an email
2. Try a 6th analysis
3. Verify limit is enforced with proper messaging

### Test Error Handling

1. Provide an invalid address
2. Verify it asks for email to send manual report
3. Check that you receive email notification with user's email

## Step 5: Publishing

1. Review all settings
2. Test thoroughly in preview mode
3. Publish the Custom GPT:
   - **Visibility**: Set to "Anyone with the link" or "Public"
   - **Category**: Productivity or Real Estate
   - **Tags**: real estate, property analysis, ARV, investment

## Usage Monitoring

### Check Usage in Firestore

```javascript
// In Firebase Console, navigate to Firestore
// Collection: gpt_usage
// Documents show:
// - email
// - analysesCount
// - limit
// - lastAnalysis
// - jobIds[]
```

### Manually Increase Limits

```typescript
// Use the usageTracker utility
import { usageTracker } from './src/server/utils/usageTracker';

await usageTracker.increaseLimit(
  'user@example.com',
  10, // new limit
  'Customer requested higher limit due to failed analysis',
  'admin'
);
```

### Email Notifications

All analyses trigger emails to `nnamdi@enohomebuyers.com` with:
- **User Email**: Prominently displayed (or "Anonymous" if not provided)
- **Source**: ChatGPT or Website
- **Job ID**, Address, ARV, Comps
- Success or failure status

## Troubleshooting

### Issue: API Key Not Working

**Solution**: Verify the API key is correctly set in Google Cloud Run secrets:

```bash
gcloud run services describe propertyvision-frontend --region=us-central1 --format=json | grep GPT_API_KEY
```

### Issue: Analysis Always Fails

**Solution**: Check Cloud Logging for errors:

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=propertyvision-frontend" --limit=50 --format=json
```

### Issue: Emails Not Being Sent

**Solution**: Verify email credentials are set:

```bash
gcloud secrets versions access latest --secret=EMAIL_USER
gcloud secrets versions access latest --secret=EMAIL_PASS
```

### Issue: Usage Limits Not Working

**Solution**: Check Firestore rules allow read/write to `gpt_usage` collection:

```javascript
// Firestore Rules
match /gpt_usage/{email} {
  allow read, write: if true; // Or add proper authentication
}
```

## Best Practices

1. **Monitor Usage**: Regularly check Firestore for popular users
2. **Email Responses**: When users email fails, respond promptly with corrected reports
3. **Limit Management**: Be generous with limit increases for genuine issues
4. **Promotional Messaging**: Keep the enohomebuyers.com message in every response
5. **Data Collection**: Use emails collected to build marketing list

## Support

For issues or questions:
- Email: nnamdi@enohomebuyers.com
- Check Cloud Logs: Google Cloud Console → Logging
- Review Firestore: Firebase Console → Firestore Database
