import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

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
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON!;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const prompt = `Find recently SOLD comparable properties near "${subjectAddress}".\nReturn only pipe-separated lines: address | sold_price | sold_date | beds | baths | sqft | year_built | source_url`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 1500 }
  };

  const resp = await httpsPostForm(url, JSON.stringify(payload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  });

  const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: any) => p?.text || '').join('');

  console.log('--- Vertex text (full) ---');
  console.log(text);

  const svc = new VertexComparableSearchService();
  // Dummy coords, distance will be computed for real; but we can skip geocoding by stubbing if needed
  (svc as any).calculateDistance = async (_a: string, _b: number, _c: number) => 0;

  const comps = await (svc as any).parseVertexResponse(text, 0, 0, undefined);
  console.log(`Parsed comps: ${comps.length}`);
  for (const c of comps) {
    console.log(`${c.address} | $${c.price.toLocaleString()} | ${c.soldDate} | ${c.beds}/${c.baths} | ${c.sqft} | Built: ${c.yearBuilt}`);
  }
}

main().catch(console.error);
