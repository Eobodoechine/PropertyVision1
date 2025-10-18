# Domain Verification Guide for Cloud Run

## Problem
Cloud Run says: "You currently have no verified domains"

This means the domain needs to be verified specifically for Cloud Run domain mappings, which is separate from Google Search Console verification.

---

## Solution: Verify via Webmaster Central

### Step 1: Go to Webmaster Central

Open this link in your browser (make sure you're logged in with your **NEW** Google business account - the one with project durable-ring-475417-g0):

**https://www.google.com/webmasters/verification/home**

### Step 2: Add Your Domain

1. Click **"Add a property"** or **"Add a site"**
2. Enter: `https://enohomebuyers.com` (include the https://)
3. Click **"Continue"**

### Step 3: Choose Verification Method

Google will show you several verification methods. Choose the **easiest one for you**:

#### **Method A: DNS TXT Record** (Recommended if you control DNS)

1. Google will show you a TXT record like:
   ```
   google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

2. Add this to your DNS (where you manage enohomebuyers.com):
   - **Type**: TXT
   - **Host/Name**: @ (or leave blank for root domain)
   - **Value**: `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXX`
   - **TTL**: 3600 (or default)

3. Wait 5-10 minutes for DNS propagation

4. Click **"Verify"** in Webmaster Central

#### **Method B: HTML File Upload**

1. Google will give you an HTML file to download (like `googleXXXXXXXXX.html`)
2. Upload this file to your website's root directory
3. Make sure it's accessible at: `https://enohomebuyers.com/googleXXXXXXXXX.html`
4. Click **"Verify"** in Webmaster Central

**Note**: This method won't work until your domain is mapped and serving traffic from the new deployment, so use **Method A (DNS TXT)** instead.

#### **Method C: Meta Tag**

1. Google will give you a meta tag like:
   ```html
   <meta name="google-site-verification" content="XXXXXXXXXXXXXXXXXXXXXXXXXXX" />
   ```
2. Add this to the `<head>` section of your website's homepage
3. Deploy your site
4. Click **"Verify"** in Webmaster Central

**Note**: This also requires your site to be live first, so use **Method A (DNS TXT)** instead.

---

### Step 4: Verify It Worked

After verification succeeds in Webmaster Central, wait 2-5 minutes, then check:

```bash
gcloud domains list-user-verified --project=durable-ring-475417-g0
```

You should see `enohomebuyers.com` in the list.

---

### Step 5: Retry Domain Mapping

Once verified, run:

```bash
gcloud beta run domain-mappings create \
  --service=propertyvision-frontend \
  --domain=enohomebuyers.com \
  --region=us-central1 \
  --project=durable-ring-475417-g0
```

This should now succeed!

---

## Quick DNS TXT Record Instructions

### If you use GoDaddy:
1. Go to https://dcc.godaddy.com/domains
2. Click your domain → DNS
3. Click "Add" → Select "TXT"
4. Host: @
5. TXT Value: `google-site-verification=XXXXX` (from Google)
6. Save

### If you use Namecheap:
1. Go to Domain List → Manage
2. Advanced DNS tab
3. Add New Record → TXT Record
4. Host: @
5. Value: `google-site-verification=XXXXX`
6. Save

### If you use Cloudflare:
1. Go to DNS settings
2. Add record
3. Type: TXT
4. Name: @
5. Content: `google-site-verification=XXXXX`
6. Save

---

## Troubleshooting

### "Verification failed"
- Wait 10-15 minutes for DNS propagation
- Check TXT record with: `dig TXT enohomebuyers.com`
- Make sure you're logged into the correct Google account

### "Domain still not verified in Cloud Run"
- Wait 5 minutes after Webmaster Central verification
- The sync between Webmaster Central and Cloud Run can take a few minutes
- Try running the domain mapping command again

### "I already verified in Search Console"
- Search Console and Webmaster Central are **different systems**
- You need to verify in **Webmaster Central** (link above) for Cloud Run
- It's the same process, you may just need to add the domain again

---

## Summary

**To verify your domain for Cloud Run:**

1. Go to: **https://www.google.com/webmasters/verification/home**
2. Add domain: `https://enohomebuyers.com`
3. Choose **DNS TXT record** method
4. Add TXT record: `google-site-verification=XXXXX` (Google provides this)
5. Wait 5-10 minutes
6. Click **"Verify"** in Webmaster Central
7. Wait 2-5 minutes for Cloud Run sync
8. Run domain mapping command again

---

**Current Status**: Waiting for you to verify domain in Webmaster Central
**Next Step**: Add DNS TXT record shown in Webmaster Central
