# Domain Mapping Instructions for enohomebuyers.com

**Date**: October 17, 2025
**Current Status**: Domain points to old account (HTTP 500 error)
**Target**: Map to new account deployment

---

## Current Situation

### What's Happening Now
- **Domain**: enohomebuyers.com
- **DNS IPs**: 216.239.32.21, 216.239.34.21, 216.239.36.21, 216.239.38.21 (Google Cloud Run)
- **Current Status**: HTTP 500 (old deployment broken)
- **Old Account**: agile-device-472202-i8 (exceeding billing limits)
- **New Account**: durable-ring-475417-g0 (working, cost-optimized)

### New Deployment URLs (Working Now)
- **Production**: https://propertyvision-frontend-771680140625.us-central1.run.app
- **Staging**: https://propertyvision-frontend-staging-771680140625.us-central1.run.app

---

## Recommended Approach: Keep It Simple

**Don't worry about the old account mapping - you can map the domain in both accounts!**

The domain mapping in the old account won't interfere because:
1. DNS records control which deployment receives traffic
2. Once you update DNS to point to the new account, traffic goes there
3. The old mapping will exist but receive no traffic
4. You can delete it later when you shut down the old account

---

## Step-by-Step Domain Mapping Process

### Step 1: Verify Domain Ownership in New Account

You need to prove you own enohomebuyers.com to Google Cloud. Choose ONE method:

#### **Method A: Google Search Console** (Recommended - Easiest)

1. Go to https://search.google.com/search-console
2. Log in with your **new Google business account** (the one with project durable-ring-475417-g0)
3. Click **"Add Property"**
4. Select **"Domain"** (not URL prefix)
5. Enter: `enohomebuyers.com`
6. Google will show you a **TXT record** to add to DNS
7. Copy the TXT record value (looks like: `google-site-verification=XXXXXXXXXXX`)

8. **Add TXT record to your DNS** (where you manage enohomebuyers.com - likely GoDaddy, Namecheap, Cloudflare, etc.):
   - Type: `TXT`
   - Name: `@` (or blank/root)
   - Value: `google-site-verification=XXXXXXXXXXX` (the value Google gave you)
   - TTL: 3600 (or default)

9. Click **"Verify"** in Google Search Console
10. ✅ Domain verified!

#### **Method B: DNS TXT Record** (Alternative)

If you don't want to use Search Console:

1. Go to Google Cloud Console → **IAM & Admin** → **Settings** → **Domain Verification**
2. Click **"Add Domain"**
3. Enter `enohomebuyers.com`
4. You'll get a TXT record like: `google-site-verification=XXXXXXXXXXX`
5. Add this TXT record to your DNS (same as Method A step 8)
6. Click **"Verify"** in Cloud Console

---

### Step 2: Create Domain Mapping in New Account

Once domain is verified (either method above), run:

```bash
gcloud beta run domain-mappings create \
  --service=propertyvision-frontend \
  --domain=enohomebuyers.com \
  --region=us-central1 \
  --project=durable-ring-475417-g0
```

**What this does:**
- Creates mapping in Google Cloud
- Tells Cloud Run to serve enohomebuyers.com traffic from `propertyvision-frontend`
- Generates DNS record instructions

**Expected output:**
```
Created domain mapping [enohomebuyers.com].
Please add the following DNS records to your domain registrar:

  NAME                    TYPE  DATA
  enohomebuyers.com       A     216.239.32.21
  enohomebuyers.com       A     216.239.34.21
  enohomebuyers.com       A     216.239.36.21
  enohomebuyers.com       A     216.239.38.21
  enohomebuyers.com       AAAA  2001:4860:4802:32::15
  enohomebuyers.com       AAAA  2001:4860:4802:34::15
  enohomebuyers.com       AAAA  2001:4860:4802:36::15
  enohomebuyers.com       AAAA  2001:4860:4802:38::15
```

---

### Step 3: Update DNS Records

**Your DNS records are already correct!**

Looking at the current DNS:
```bash
dig +short enohomebuyers.com A
# Output:
# 216.239.36.21
# 216.239.38.21
# 216.239.34.21
# 216.239.32.21
```

These are the same IPs that Cloud Run will tell you to use. **Google Cloud Run uses shared IPs** - the same IPs serve multiple domains.

**What determines which deployment serves traffic?**
The domain mapping in Cloud Run. Once you create the mapping in Step 2, Cloud Run will:
1. See incoming request for `enohomebuyers.com`
2. Check which account has a mapping for this domain
3. Route to that account's service (in this case, NEW account's `propertyvision-frontend`)

**You don't need to change DNS records** - they're already correct!

---

### Step 4: SSL Certificate Provisioning

After creating the domain mapping:

1. **Wait 15-60 minutes** for Google to provision an SSL certificate
2. During this time, the domain may show certificate errors
3. Google automatically provisions a managed SSL/TLS certificate
4. Once ready, HTTPS will work automatically

**Check SSL status:**
```bash
gcloud beta run domain-mappings describe enohomebuyers.com \
  --region=us-central1 \
  --project=durable-ring-475417-g0
```

Look for `certificateStatus: ACTIVE`

---

### Step 5: Test

Once SSL is active:

1. Visit https://enohomebuyers.com
2. You should see your application (not HTTP 500 anymore!)
3. Test analyzing a property
4. Verify it's the NEW deployment (check logs in new account)

---

## What About the Old Account Mapping?

### Option 1: Leave It (Recommended)

**Do nothing.** The old mapping will stay there but:
- It receives no traffic (DNS/Cloud Run routes to new account)
- It costs nothing (Cloud Run domain mappings are free)
- It's harmless

When you eventually shut down the old account, the mapping will be deleted automatically.

### Option 2: Delete It Later

Once you verify the new deployment works:

1. Switch gcloud to use your old account credentials (if you still have them)
2. Run:
   ```bash
   gcloud beta run domain-mappings delete enohomebuyers.com \
     --region=us-central1 \
     --project=agile-device-472202-i8 \
     --quiet
   ```
3. This is optional cleanup - doesn't affect functionality

---

## Troubleshooting

### Issue: "Domain not verified"

**Solution:**
- Double-check TXT record in DNS (use `dig TXT enohomebuyers.com`)
- Wait 5-60 minutes for DNS propagation
- Try verification again

### Issue: "SSL certificate pending"

**Solution:**
- This is normal - takes 15-60 minutes
- Just wait, Google is provisioning the certificate automatically
- Don't change DNS during this time

### Issue: "Still seeing HTTP 500"

**Possible causes:**
1. DNS cache on your computer - wait or flush: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`
2. Browser cache - try incognito mode
3. SSL still provisioning - wait 15-60 minutes
4. Check domain mapping was created successfully

### Issue: "Certificate error / Not secure"

**Solution:**
- SSL certificate is still provisioning
- Wait 15-60 minutes
- Use HTTP in the meantime (redirects to HTTPS when ready)

---

## Summary

**Simple 3-step process:**

1. **Verify domain** (Google Search Console or Cloud Console - add TXT record)
2. **Create mapping** (one gcloud command)
3. **Wait for SSL** (15-60 minutes automatic)

**DNS records**: Already correct, no changes needed!

**Old account**: Ignore it - won't interfere

**Cost**: FREE (domain mappings are free, SSL certificates are free)

---

## Quick Reference Commands

```bash
# Create domain mapping (after verification)
gcloud beta run domain-mappings create \
  --service=propertyvision-frontend \
  --domain=enohomebuyers.com \
  --region=us-central1 \
  --project=durable-ring-475417-g0

# Check mapping status
gcloud beta run domain-mappings describe enohomebuyers.com \
  --region=us-central1 \
  --project=durable-ring-475417-g0

# Test DNS
dig enohomebuyers.com A
dig enohomebuyers.com AAAA

# Test HTTPS
curl -I https://enohomebuyers.com

# Check SSL certificate
curl -vI https://enohomebuyers.com 2>&1 | grep -A 5 "SSL certificate"
```

---

**Need Help?**

If you run into issues, the most common fix is just **waiting**:
- TXT record propagation: 5-60 minutes
- SSL certificate provisioning: 15-60 minutes
- DNS cache on your computer: Flush or wait 5 minutes

Once SSL is active (look for "Not Secure" gone in browser), you're done! ✅

---

**Current Status**: Ready for domain verification
**Next Step**: Verify enohomebuyers.com ownership via Google Search Console or Cloud Console
