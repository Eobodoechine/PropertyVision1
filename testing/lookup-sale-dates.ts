import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Copy service account functions
async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);
  if (!resp?.access_token) throw new Error('sa-token-failed');
  return resp.access_token as string;
}

async function httpsPostForm(url: string, body: string, headers: Record<string,string>, timeoutMs: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function httpsPostJson(url: string, payload: any, headers: Record<string,string>, timeoutMs: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function lookupSaleDates() {
  console.log('🔍 LOOKING UP SALE DATES');
  console.log('============================================================');
  console.log('📅 Today\'s date: September 17, 2025');
  console.log('');

  const saPath = process.env.GCP_SA_JSON!;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';

  // Look up Bailey Ct sales
  console.log('🏠 BAILEY CT SALE DATES');
  console.log('------------------------------------------------------------');

  const baileyPrompt = `Use Google Search grounding to find the EXACT sale dates for properties on Bailey Ct in Fayetteville, GA 30215.

SPECIFIC PROPERTIES TO RESEARCH:
- 110 Bailey Ct, Fayetteville, GA 30215
- 100 Bailey Ct, Fayetteville, GA 30215
- Any other Bailey Ct properties in Fayetteville, GA 30215

SEARCH REQUIREMENTS:
- Find actual SALE DATE (month/year when property sold)
- Use authoritative sources: Zillow, Redfin, county records
- Search: site:zillow.com "Bailey Ct" Fayetteville GA sold
- Search: "110 Bailey Ct Fayetteville GA" sale date

For each property found, provide:
- Address
- Sale date (MM/YYYY format)
- Sale price
- How many months ago from September 2025`;

  try {
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: baileyPrompt }] }],
      generationConfig: { temperature: 0, seed: 12345, maxOutputTokens: 1500 },
      tools: [{ google_search: {} }]
    };

    const baileyResult = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, 45000);
    const baileyText = baileyResult?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';

    console.log('📊 BAILEY CT RESULTS:');
    console.log(baileyText);
    console.log('');

  } catch (error) {
    console.log(`❌ Bailey Ct search failed: ${error}`);
  }

  // Wait between requests
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Look up Murphy Creek sales
  console.log('🏠 MURPHY CREEK SALE DATES');
  console.log('------------------------------------------------------------');

  const murphyPrompt = `Use Google Search grounding to find the EXACT sale dates for properties on Murphy Creek Ln in Fayetteville, GA 30215.

SPECIFIC PROPERTIES TO RESEARCH:
- 125 Murphy Creek Ln, Fayetteville, GA 30215
- 215 Murphy Creek Ln, Fayetteville, GA 30215 (if it exists)
- Any other Murphy Creek Ln properties in Fayetteville, GA 30215

SEARCH REQUIREMENTS:
- Find actual SALE DATE (month/year when property sold)
- Use authoritative sources: Zillow, Redfin, county records
- Search: site:zillow.com "Murphy Creek" Fayetteville GA sold
- Search: "125 Murphy Creek Ln Fayetteville GA" sale date

For each property found, provide:
- Address
- Sale date (MM/YYYY format)
- Sale price
- How many months ago from September 2025`;

  try {
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: murphyPrompt }] }],
      generationConfig: { temperature: 0, seed: 12345, maxOutputTokens: 1500 },
      tools: [{ google_search: {} }]
    };

    const murphyResult = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, 45000);
    const murphyText = murphyResult?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';

    console.log('📊 MURPHY CREEK RESULTS:');
    console.log(murphyText);
    console.log('');

  } catch (error) {
    console.log(`❌ Murphy Creek search failed: ${error}`);
  }

  console.log('🎯 ANALYSIS');
  console.log('============================================================');
  console.log('This will help explain:');
  console.log('1. Why Bailey Ct properties appeared in previous runs but not now');
  console.log('2. Whether Murphy Creek is within our 18-month time window');
  console.log('3. If we need to adjust our time criteria');
}

lookupSaleDates().catch(console.error);