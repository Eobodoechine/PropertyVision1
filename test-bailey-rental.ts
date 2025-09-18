import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Copy the service account functions from vertex-details.ts
async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_');
  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\\+/g,'-').replace(/\\//g,'_');
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

async function testBaileyOaksRentalVsSold() {
  const saPath = process.env.GCP_SA_JSON!;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';

  console.log('🏘️ BAILEY OAKS: RENTAL vs SOLD PROPERTIES TEST');
  console.log('============================================================');
  console.log('');

  // Test 1: Look for recently SOLD properties in Bailey Oaks
  console.log('💰 TEST 1: RECENTLY SOLD PROPERTIES IN BAILEY OAKS');
  console.log('------------------------------------------------------------');

  const soldPrompt = `Use Google Search grounding to find recently SOLD properties in Bailey Oaks subdivision, Fayetteville, GA.

SEARCH CRITERIA:
- Subdivision: Bailey Oaks, Fayetteville, GA
- Status: Recently SOLD (within last 18 months)
- Property type: Single-family homes, townhomes

SEARCH METHODS:
- site:zillow.com "Bailey Oaks" Fayetteville GA sold
- site:redfin.com "Bailey Oaks subdivision" Fayetteville sold
- "Bailey Oaks Fayetteville GA" recently sold properties

List any recently sold properties you find with address, sale price, and sale date.`;

  try {
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: soldPrompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      tools: [{ google_search: {} }]
    };

    const soldResult = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, 45000);
    const soldText = soldResult?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';

    console.log('📊 SOLD PROPERTIES RESULTS:');
    console.log(soldText.substring(0, 500) + (soldText.length > 500 ? '...' : ''));
    console.log('');

  } catch (error) {
    console.log(`❌ Sold properties search failed: ${error}`);
  }

  // Wait between requests
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test 2: Look for properties currently FOR RENT in Bailey Oaks
  console.log('🏠 TEST 2: CURRENT RENTAL PROPERTIES IN BAILEY OAKS');
  console.log('------------------------------------------------------------');

  const rentalPrompt = `Use Google Search grounding to find properties currently FOR RENT in Bailey Oaks subdivision, Fayetteville, GA.

SEARCH CRITERIA:
- Subdivision: Bailey Oaks, Fayetteville, GA
- Status: Currently for rent / available for rent
- Property type: Single-family homes, townhomes

SEARCH METHODS:
- site:zillow.com "Bailey Oaks" Fayetteville GA for rent
- site:rent.com "Bailey Oaks subdivision" Fayetteville
- "Bailey Oaks Fayetteville GA" rental properties

List any rental properties you find with address, monthly rent, and property details.`;

  try {
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: rentalPrompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      tools: [{ google_search: {} }]
    };

    const rentalResult = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, 45000);
    const rentalText = rentalResult?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';

    console.log('📊 RENTAL PROPERTIES RESULTS:');
    console.log(rentalText.substring(0, 500) + (rentalText.length > 500 ? '...' : ''));
    console.log('');

  } catch (error) {
    console.log(`❌ Rental properties search failed: ${error}`);
  }

  console.log('🎯 ANALYSIS');
  console.log('============================================================');
  console.log('If we find rental properties but no recent sales, that explains');
  console.log('why Bailey Oaks comps are not appearing in our SOLD property searches.');
}

testBaileyOaksRentalVsSold().catch(console.error);