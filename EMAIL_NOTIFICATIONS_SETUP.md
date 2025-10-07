# Email Notifications Setup

Automatic email notifications are sent to `nnamdi@enohomebuyers.com` when a job fails after 3 attempts.

## Email Configuration

The system uses Nodemailer with Gmail SMTP. To enable email notifications, you need to set up Gmail App Passwords.

### Step 1: Create Gmail App Password

1. Go to your Google Account: https://myaccount.google.com/
2. Select **Security** → **2-Step Verification** (enable if not already enabled)
3. Scroll down to **App passwords**
4. Click **Create** and select:
   - App: **Mail**
   - Device: **Other (Custom name)** → Enter "PropertyVision"
5. Click **Generate**
6. **Copy the 16-character password** (e.g., `abcd efgh ijkl mnop`)

### Step 2: Add to Google Cloud Secret Manager

```bash
# Create the email password secret
echo -n "your-app-password-here" | gcloud secrets create email-password \
  --data-file=- \
  --project=agile-device-472202-i8

# Grant Cloud Run access to the secret
gcloud secrets add-iam-policy-binding email-password \
  --member="serviceAccount:839845580521-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=agile-device-472202-i8
```

### Step 3: Update Cloud Run Deployment

Add these environment variables and secrets to your deployment:

**Worker:**
```bash
gcloud run deploy propertyvision-worker \
  --image gcr.io/agile-device-472202-i8/propertyvision-worker:vN \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --no-allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --service-account 839845580521-compute@developer.gserviceaccount.com \
  --set-env-vars "RUN_WORKER=true,NODE_ENV=production,...,EMAIL_USER=your-gmail@gmail.com,EMAIL_FROM=PropertyVision Alerts <alerts@propertyvision.app>" \
  --set-secrets "PROXY_SHARED_KEY=proxy-shared-key:latest,EMAIL_PASS=email-password:latest" \
  --min-instances 1 \
  --max-instances 3 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --no-cpu-throttling
```

**Frontend:**
```bash
gcloud run deploy propertyvision-frontend \
  --image gcr.io/agile-device-472202-i8/propertyvision-frontend:vN \
  --region us-central1 \
  --project agile-device-472202-i8 \
  --allow-unauthenticated \
  --vpc-connector redis-connector \
  --vpc-egress private-ranges-only \
  --service-account 839845580521-compute@developer.gserviceaccount.com \
  --set-env-vars "RUN_WORKER=false,NODE_ENV=production,...,EMAIL_USER=your-gmail@gmail.com,EMAIL_FROM=PropertyVision Alerts <alerts@propertyvision.app>" \
  --set-secrets "PROXY_SHARED_KEY=proxy-shared-key:latest,EMAIL_PASS=email-password:latest" \
  --min-instances 0 \
  --max-instances 10 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 80
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `EMAIL_USER` | Gmail address to send from | `your-email@gmail.com` |
| `EMAIL_PASS` | Gmail App Password (16 chars) | From Secret Manager |
| `EMAIL_FROM` | Display name and email | `PropertyVision Alerts <alerts@propertyvision.app>` |

## Email Content

When a job fails after 3 attempts, an email is sent with:

- **Address** that failed
- **Job ID** for tracking
- **Error Time** timestamp
- **Phase** where it failed (Getting subject details, Finding comps, etc.)
- **Attempts** count (3)
- **Error Details** full error message
- **Link to Cloud Logs** for debugging

## Testing

To test email notifications:

1. Deploy with email configuration
2. Submit a job with an invalid address (e.g., "invalid address 123")
3. Wait for 3 failed attempts (~90 seconds with retries)
4. Check `nnamdi@enohomebuyers.com` for error email

## Troubleshooting

**No emails received:**
- Check that `EMAIL_USER` and `EMAIL_PASS` are set correctly
- Verify the Gmail App Password is valid (16 characters, no spaces)
- Check Cloud Run logs for "Email not configured" warnings
- Check Cloud Run logs for "Failed to send error notification" errors

**Gmail blocks sending:**
- Make sure 2-Step Verification is enabled on the Gmail account
- Use an App Password, not your regular Gmail password
- Check Gmail's "Less secure app access" settings (should be OFF, use App Password)

**Change notification email:**
Edit `NOTIFICATION_EMAIL` in `/frontend/src/server/utils/emailNotification.ts`:
```typescript
const NOTIFICATION_EMAIL = 'nnamdi@enohomebuyers.com';
```

## Alternative: SendGrid

For higher volume or better deliverability, you can switch to SendGrid:

1. Sign up at https://sendgrid.com/ (free tier: 100 emails/day)
2. Create an API key
3. Install SendGrid: `npm install @sendgrid/mail`
4. Update `emailNotification.ts` to use SendGrid API instead of Nodemailer
5. Add `SENDGRID_API_KEY` to secrets

## Notes

- Emails are only sent when jobs **fail after 3 attempts**
- Emails are **not sent** for successful jobs or jobs that will be retried
- Email sending failures are logged but don't crash the worker
- If email isn't configured (no EMAIL_USER/EMAIL_PASS), jobs continue normally without emails
