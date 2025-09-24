import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

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
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  if (!token?.access_token) throw new Error('sa-token-failed');
  return token.access_token as string;
}

async function httpsPostJson(url: string, payload: any, headers: Record<string,string>): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callVertexWithSchema(projectId: string, location: string, model: string, token: string, prompt: string, responseSchema: any, maxOutputTokens = 1800): Promise<any> {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const payload: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
    generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: 'application/json', responseSchema },
    tools: [{ google_search: {} } as any]
  };
  if (process.env.BLOCK_ALL_SAFETY === '1') {
    (payload as any).safetySettings = [
      { category: 'HARM_CATEGORY_DANGEROUS', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUAL', threshold: 'BLOCK_NONE' }
    ];
  }
  return await httpsPostJson(url, payload, { Authorization: `Bearer ${token}` });
}

async function main() {
  const address = process.env.ADDRESS || process.argv.slice(2).join(' ').trim();
  if (!address) throw new Error('Provide ADDRESS');
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  // Details schema
  const detailsSchema = {
    type: 'OBJECT',
    properties: {
      sqft: { type: 'NUMBER', nullable: true },
      beds: { type: 'NUMBER', nullable: true },
      baths: { type: 'NUMBER', nullable: true },
      yearBuilt: { type: 'NUMBER', nullable: true },
      lotSize: { type: 'NUMBER', nullable: true },
      subdivision: { type: 'STRING', nullable: true }
    }
  };
  const detailsPrompt = `Use authoritative sources (Zillow, Redfin, Realtor, county). Return JSON only for: ${address}.
Use Google Search grounding with example queries like:
- site:redfin.com ${address}
- "Austin Park" Decatur GA recent sales
- Decatur GA sold townhomes 2024
`;
  const detailsRes = await callVertexWithSchema(projectId, location, model, token, detailsPrompt, detailsSchema, 1800);
  const detailsText: string = detailsRes?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('DETAILS FULL:', JSON.stringify(detailsRes));
  console.log('DETAILS RAW:', detailsText);
  let detailsObj: any = null;
  try { detailsObj = detailsText ? JSON.parse(detailsText) : null; } catch {}

  // Comps schema
  const compsSchema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        address: { type: 'STRING' },
        sold_price: { type: 'NUMBER', nullable: true },
        sold_date: { type: 'STRING', nullable: true },
        sqft: { type: 'NUMBER', nullable: true },
        beds: { type: 'NUMBER', nullable: true },
        baths: { type: 'NUMBER', nullable: true },
        year_built: { type: 'NUMBER', nullable: true },
        distance_miles: { type: 'NUMBER', nullable: true },
        ppsf: { type: 'NUMBER', nullable: true },
        source_url: { type: 'STRING', nullable: true },
        source_site: { type: 'STRING', nullable: true },
        condition: { type: 'STRING', nullable: true }
      }
    }
  };
  const compsPrompt = `Return JSON array of up to 6 RECENTLY SOLD single-family comps near "${address}" (24 months, within 3 miles). Prefer renovated/updated.
Use Google Search grounding with example queries like:
- site:redfin.com ${address}
- "Austin Park" Decatur GA recent sales
- Decatur GA sold townhomes 2024
`;
  const compsRes = await callVertexWithSchema(projectId, location, model, token, compsPrompt, compsSchema, 2000);
  const compsText: string = compsRes?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('COMPS FULL:', JSON.stringify(compsRes));
  console.log('COMPS RAW:', compsText.slice(0, 400));
  let compsArr: any[] = [];
  try { compsArr = compsText ? JSON.parse(compsText) : []; } catch {}

  console.log('\n=== SCHEMA RESULT ===');
  console.log(JSON.stringify({ details: detailsObj, comps: compsArr.slice(0,6) }, null, 2));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('SCHEMA TEST ERROR:', err?.message || err); process.exit(1); });
}

export {};
