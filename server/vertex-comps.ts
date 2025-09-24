import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

async function main() {
  const address = process.env.ADDRESS;
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-flash-lite';
  if (!address) throw new Error('ADDRESS env var is required');
  if (!saPath) throw new Error('GCP_SA_JSON env var (service account json path) is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8')) as any;

  const prompt = `Return ONLY a JSON array (no prose). Find RECENTLY SOLD single-family home comps near "${address}".
Rules:
- Time window: last 24 months
- Distance: within 3 miles of the subject
- Prefer renovated/updated/move-in ready; avoid obvious as-is/fixer when possible
- If any field is unknown, use null (do not drop the object)
- Provide up to 8 best comps

Each item format:
[
  {
    "address": "full street, city, state ZIP",
    "sold_price": 0,
    "sold_date": "YYYY-MM-DD" | null,
    "beds": 0 | null,
    "baths": 0 | null,
    "sqft": 0 | null,
    "year_built": 0 | null,
    "distance_miles": 0 | null,
    "ppsf": 0 | null,
    "source_url": "" | null,
    "source_site": "" | null,
    "condition": "updated|renovated|remodeled|original|fixer|unknown" | null
  }
]
`;

  const text = await vertexGenerate(sa, sa.project_id, location, model, prompt, true, 20000);
  let arr: any[] = [];
  try {
    const m = text && String(text).match(/\[[\s\S]*\]/);
    if (m) arr = JSON.parse(m[0]);
  } catch {}

  const comps = (arr || []).slice(0, 8).map((it: any) => ({
    address: it.address,
    price: Number(it.sold_price),
    sqft: it.sqft != null ? Number(it.sqft) : null,
    beds: it.beds != null ? Number(it.beds) : null,
    baths: it.baths != null ? Number(it.baths) : null,
    yearBuilt: it.year_built != null ? Number(it.year_built) : null,
    soldDate: it.sold_date,
    distance: it.distance_miles != null ? Number(it.distance_miles) : null,
    source: it.source_site ? String(it.source_site) : null,
    url: it.source_url ? String(it.source_url) : null,
  })).filter((c: any) => c.address && Number.isFinite(c.price));

  const out = { address, count: comps.length, comps };
  console.log(JSON.stringify(out, null, 2));
}

async function vertexGenerate(sa: any, projectId: string, location: string, model: string, prompt: string, grounded: boolean, timeoutMs: number): Promise<string> {
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const payload: any = {
    contents: [ { role: 'user', parts: [ { text: prompt } ] } ],
    generationConfig: { temperature: 0, maxOutputTokens: 900, responseMimeType: 'application/json' },
    tools: grounded ? [ { google_search: {} } as any ] : undefined
  };
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

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
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 15000);
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

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err?.message || err); process.exit(1); });
}
