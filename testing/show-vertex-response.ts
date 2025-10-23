import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

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
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
  if (!resp?.access_token) throw new Error('sa-token-failed');
  return resp.access_token as string;
}

async function httpsPostForm(url: string, body: string, headers: Record<string,string>, timeoutMs: number = 20000): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const subjectAddress = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const searchRadius = Number(process.env.SEARCH_RADIUS || '3');
  const timeWindowMonths = Number(process.env.TIME_WINDOW || '18');

  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const subdivision = process.env.SUBDIVISION?.trim();
  const subLine = subdivision ? `Only include properties in subdivision "${subdivision}".` : '';
  const typeWanted = (process.env.SUBJECT_TYPE || '').toLowerCase();
  const typeLine = typeWanted ? `Only include property type: ${typeWanted} (use synonyms: townhome/townhouse/rowhouse for townhome).` : '';

  const prompt = `REAL ESTATE COMPARABLE SEARCH - VERTEX AI GROUNDED ANALYSIS

Use Google Search grounding with authoritative MLS data sources to find recently SOLD comparable properties.

TARGET PROPERTY: ${subjectAddress}

SEARCH CRITERIA (STRICT REQUIREMENTS):
- Location: Within ${searchRadius} miles of ${subjectAddress}
- Time frame: Sold within last ${timeWindowMonths} months (SOLD properties only, not listings)
- Property type: Single-family homes, townhomes, condos
${subLine ? `- Subdivision: ${subLine}` : ''}
${typeLine ? `- Type filter: ${typeLine}` : ''}

REQUIRED DATA FOR EACH PROPERTY:
- Complete street address with city, state, ZIP
- Actual sale price (not listing price)
- Sale date in YYYY-MM-DD format
- Bedrooms and bathrooms (exact numbers)
- Square footage (living area)
- Year built
- Source website (Zillow, Redfin, Realtor.com, etc.)

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url
`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 2500 }
  };

  const resp = await httpsPostForm(url, JSON.stringify(payload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p?.text || '').join('');

  console.log('\n--- RAW TEXT (default prompt) ---');
  console.log(text);

  // Strict format follow-up prompt (same as service fallback)
  const strictPrompt = `Return ONLY pipe-separated lines for SOLD properties near "${subjectAddress}" within ${searchRadius} miles and ${timeWindowMonths} months. No commentary, no headers.
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
  const strictPayload = {
    contents: [{ role: 'user', parts: [{ text: strictPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 2000 }
  };
  const strictResp = await httpsPostForm(url, JSON.stringify(strictPayload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });
  const strictParts: any[] = strictResp?.candidates?.[0]?.content?.parts || [];
  const strictText = strictParts.map((p: any) => p?.text || '').join('');
  console.log('\n--- RAW TEXT (strict fallback prompt) ---');
  console.log(strictText);
}

main().catch(console.error);
