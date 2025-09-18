import 'dotenv/config';
import { groundedFreeform } from './server/vertex-freeform';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';

async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
  const u = new URL(sa.token_uri);
  const token: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body).toString() } }, (res: any) => {
      let data = '';
      res.on('data', (c: any) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  if (!token?.access_token) throw new Error('sa-token-failed');
  return token.access_token as string;
}

async function main() {
  const address = "185 Jordan Pl, Fayetteville, GA 30215";
  const saPath = "/Users/eobodoechine/Downloads/agile-device-472202-i8-319f002d9438.json";
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  console.log('🔍 FINDING COMPARABLE SALES...');
  const compsPrompt = `Find recently SOLD comparable single-family homes near ${address} in Fayetteville, GA.

Search for properties that:
- Sold within last 18 months
- Within 2-3 miles of subject
- Similar size (2,000-3,000 sq ft)
- 3-5 bedrooms

For each comp, provide:
- Full address
- Sale price and date
- Square footage
- Bedrooms/bathrooms
- Price per sq ft
- Distance from subject
- Source (Zillow, Redfin, etc.)

Find 4-6 best comparables with complete data.`;

  const compsResult = await groundedFreeform({
    accessToken: token,
    projectId: sa.project_id,
    location: 'us-central1',
    model: 'gemini-2.5-pro',
    prompt: compsPrompt,
    maxOutputTokens: 2500
  });

  console.log('✅ COMPARABLE SALES:');
  console.log(compsResult.text);
  console.log('\n' + '='.repeat(80) + '\n');

  // Now analyze for ARV using both subject and comps data
  console.log('💰 CALCULATING ARV...');
  const arvPrompt = `Based on this subject property and comparable sales data, calculate an After Repair Value (ARV):

SUBJECT PROPERTY: ${address}
- 2,331 sq ft
- 4 bedrooms
- 3-4 bathrooms (sources vary)
- Built 1998
- Bailey Oaks subdivision

COMPARABLE SALES:
${compsResult.text}

Provide ARV analysis:
1. Extract price per sq ft from each comp
2. Calculate average PPSF
3. Apply to subject property (2,331 sq ft)
4. Consider condition adjustments
5. Provide conservative, moderate, and aggressive ARV estimates
6. Recommend final ARV with reasoning`;

  const arvResult = await groundedFreeform({
    accessToken: token,
    projectId: sa.project_id,
    location: 'us-central1',
    model: 'gemini-2.5-pro',
    prompt: arvPrompt,
    maxOutputTokens: 2000
  });

  console.log('✅ ARV ANALYSIS:');
  console.log(arvResult.text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('ERROR:', err?.message || err); process.exit(1); });
}