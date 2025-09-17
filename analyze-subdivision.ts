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

  console.log('🏘️ FINDING SUBDIVISION CODE FOR BAILEY OAKS...');
  const subdivisionPrompt = `Find the subdivision code or plat number for Bailey Oaks subdivision in Fayetteville, GA where 185 Jordan Pl is located.

Search for:
- Bailey Oaks subdivision code
- Plat number for Bailey Oaks
- Development ID for Bailey Oaks in Fayette County, GA
- Any official subdivision identifier used by county records

Also find any other names this subdivision might be known by (phases, sections, etc.).`;

  const subdivisionResult = await groundedFreeform({
    accessToken: token,
    projectId: sa.project_id,
    location: 'us-central1',
    model: 'gemini-2.5-pro',
    prompt: subdivisionPrompt,
    maxOutputTokens: 1500
  });

  console.log('✅ SUBDIVISION INFO:');
  console.log(subdivisionResult.text);
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('🔍 FINDING BAILEY OAKS COMPS BY SUBDIVISION...');
  const subdivisionCompsPrompt = `Find recently SOLD properties in Bailey Oaks subdivision, Fayetteville, GA 30215.

Search specifically for:
- Properties sold in Bailey Oaks subdivision within last 18 months
- Include subdivision phases or sections if any
- Single-family homes similar to 185 Jordan Pl (2,331 sq ft, 4BR)
- Focus on same subdivision for most accurate comparables

For each property provide:
- Full address
- Sale price and date
- Square footage
- Bedrooms/bathrooms
- Year built
- Price per sq ft
- Days on market
- Source

Find 4-6 Bailey Oaks comps with complete data.`;

  const subdivisionCompsResult = await groundedFreeform({
    accessToken: token,
    projectId: sa.project_id,
    location: 'us-central1',
    model: 'gemini-2.5-pro',
    prompt: subdivisionCompsPrompt,
    maxOutputTokens: 2500
  });

  console.log('✅ BAILEY OAKS SUBDIVISION COMPS:');
  console.log(subdivisionCompsResult.text);
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('💰 RECALCULATING ARV WITH SUBDIVISION COMPS...');
  const arvPrompt = `Recalculate ARV for 185 Jordan Pl using ONLY Bailey Oaks subdivision comps:

SUBJECT: 185 Jordan Pl, Bailey Oaks - 2,331 sq ft, 4BR, built 1998

BAILEY OAKS COMPS:
${subdivisionCompsResult.text}

Calculate ARV using subdivision-specific data:
1. List each Bailey Oaks comp with PPSF
2. Calculate average PPSF for Bailey Oaks only
3. Apply to subject property (2,331 sq ft)
4. Provide single ARV estimate based on subdivision data
5. Compare to earlier estimate using mixed subdivisions

Use only same-subdivision comps for most accurate valuation.`;

  const subdivisionArvResult = await groundedFreeform({
    accessToken: token,
    projectId: sa.project_id,
    location: 'us-central1',
    model: 'gemini-2.5-pro',
    prompt: arvPrompt,
    maxOutputTokens: 2000
  });

  console.log('✅ SUBDIVISION-BASED ARV:');
  console.log(subdivisionArvResult.text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('ERROR:', err?.message || err); process.exit(1); });
}