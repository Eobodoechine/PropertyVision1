import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

type Details = {
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
};

function logStep(title: string) {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ${title}`);
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

function extractJsonBlock(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
  return null;
}

async function vertexGenerate(opts: {
  sa: any;
  projectId: string;
  location: string;
  model: string;
  prompt: string;
  grounded: boolean;
  json: boolean;
  timeoutMs: number;
}): Promise<string> {
  const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
  const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const payload: any = {
    contents: [ { role: 'user', parts: [ { text: opts.prompt } ] } ],
    generationConfig: { temperature: 0, maxOutputTokens: 1500, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
  };
  if (opts.grounded) {
    payload.tools = [ { google_search: {} as any } ];
  }
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
  return text;
}

function parseFreeform(text: string, address: string): Details {
  const clean = (s: string) => s.replace(/,/g, '').trim();
  const num = (m: RegExpMatchArray | null) => (m ? Number(clean(m[1])) : null);
  const sqft = num(text.match(/(\d{3,5})\s*(?:sq\s*ft|sqft)/i));
  const beds = num(text.match(/(?:\b|\*)bed(?:rooms?)?[:\s]*([0-9]{1,2})\b/i));
  const baths = (() => {
    const m = text.match(/(?:\b|\*)bath(?:rooms?)?[:\s]*([0-9]+(?:\.[0-9]+)?)/i);
    return m ? Number(clean(m[1])) : null;
  })();
  const yearBuilt = num(text.match(/(?:year\s*built|built)[:\s]*([12][0-9]{3})/i));
  return { sqft, beds, baths, yearBuilt };
}

async function tryStrategies(address: string) {
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON to your service account JSON path');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const timeoutMs = Number(process.env.VERTEX_TIMEOUT_MS || '45000');

  // 1) Grounded strict JSON
  logStep('Strategy 1: Grounded strict JSON');
  try {
    const prompt = `Return ONLY JSON (no prose). Use authoritative sources (Zillow, Redfin, Realtor, county records) to find details for: ${address}
{
  "sqft": number | null,
  "beds": number | null,
  "baths": number | null,
  "yearBuilt": number | null
}`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: true, timeoutMs });
    if (text && text.trim()) {
      const block = extractJsonBlock(text) || text;
      const obj = JSON.parse(block);
      return { strategy: 'grounded-json', details: obj as Details, raw: block };
    }
  } catch (e: any) { console.log('S1 failed:', e?.message || e); }

  // 2) Non-grounded strict JSON
  logStep('Strategy 2: Non-grounded strict JSON');
  try {
    const prompt = `Return ONLY JSON (no prose). Find details for: ${address}
{
  "sqft": number | null,
  "beds": number | null,
  "baths": number | null,
  "yearBuilt": number | null
}`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: false, json: true, timeoutMs });
    if (text && text.trim()) {
      const obj = JSON.parse(text);
      return { strategy: 'json', details: obj as Details, raw: text };
    }
  } catch (e: any) { console.log('S2 failed:', e?.message || e); }

  // 3) Grounded freeform parse
  logStep('Strategy 3: Grounded freeform parse');
  try {
    const prompt = `Research: ${address}\nProvide details in clear sentences including sqft, beds, baths, and year built.`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: false, timeoutMs });
    const parsed = parseFreeform(text, address);
    if (parsed.sqft || parsed.beds || parsed.baths || parsed.yearBuilt) {
      return { strategy: 'grounded-freeform-parse', details: parsed, raw: text.slice(0, 600) };
    }
  } catch (e: any) { console.log('S3 failed:', e?.message || e); }

  // 4) Sqft-only grounded JSON
  logStep('Strategy 4: Grounded sqft-only JSON');
  try {
    const prompt = `Return ONLY JSON: {"sqft": number | null}. Use authoritative sources for: ${address}`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: true, timeoutMs });
    if (text && text.trim()) {
      const block = extractJsonBlock(text) || text;
      const obj = JSON.parse(block);
      const details: Details = { sqft: (obj?.sqft ?? null), beds: null, baths: null, yearBuilt: null };
      return { strategy: 'grounded-json-sqft-only', details, raw: block };
    }
  } catch (e: any) { console.log('S4 failed:', e?.message || e); }

  // 5) Non-grounded sqft-only JSON
  logStep('Strategy 5: Non-grounded sqft-only JSON');
  try {
    const prompt = `Return ONLY JSON: {"sqft": number | null} for: ${address}`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: false, json: true, timeoutMs });
    if (text && text.trim()) {
      const obj = JSON.parse(text);
      const details: Details = { sqft: (obj?.sqft ?? null), beds: null, baths: null, yearBuilt: null };
      return { strategy: 'json-sqft-only', details, raw: text };
    }
  } catch (e: any) { console.log('S5 failed:', e?.message || e); }

  return { strategy: 'none', details: { sqft: null, beds: null, baths: null, yearBuilt: null }, raw: '' };
}

async function main() {
  const address = process.env.ADDRESS || process.argv.slice(2).join(' ');
  if (!address) throw new Error('Provide ADDRESS env or pass address as args');
  console.log('=== Property Details Test ===');
  console.log('Address:', address);
  console.log('Model:', process.env.VERTEX_MODEL || 'gemini-2.5-pro');
  console.log('Location:', process.env.VERTEX_LOCATION || 'us-central1');
  const out = await tryStrategies(address);
  console.log('\n--- RESULT ---');
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('DETAILS TEST ERROR:', err?.message || err); process.exit(1); });
}

export {};
