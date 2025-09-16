import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

export type BasicDetails = {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  success: boolean;
};

function hasServiceAccount(): boolean {
  const p = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  return Boolean(p && p.trim().length > 0);
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

async function vertexGenerate(opts: {
  sa: any;
  projectId: string;
  location: string;
  model: string;
  prompt: string;
  grounded: boolean;
  json: boolean;
  timeoutMs: number;
  responseSchema?: any;
}): Promise<string> {
  const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
  const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const payload: any = {
    contents: [ { role: 'user', parts: [ { text: opts.prompt } ] } ],
    generationConfig: { temperature: 0, maxOutputTokens: 1500, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
  };
  // Use legacy grounding tool name expected by this project
  if (opts.grounded) payload.tools = [ { google_search: {} } as any ];
  if (opts.responseSchema) (payload.generationConfig as any).responseSchema = opts.responseSchema;
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
  return text;
}

function parseFreeform(text: string): Partial<BasicDetails> {
  const clean = (s: string) => s.replace(/,/g, '').trim();
  const num = (m: RegExpMatchArray | null) => (m ? Number(clean(m[1])) : null);
  const sqft = num(text.match(/(\d{3,5})\s*(?:sq\s*ft|sqft)/i));
  const beds = num(text.match(/(?:\b|\*)bed(?:rooms?)?[:\s]*([0-9]{1,2})\b/i));
  const baths = (() => { const m = text.match(/(?:\b|\*)bath(?:rooms?)?[:\s]*([0-9]+(?:\.[0-9]+)?)/i); return m ? Number(clean(m[1])) : null; })();
  const yearBuilt = num(text.match(/(?:year\s*built|built)[:\s]*([12][0-9]{3})/i));
  return { sqft, beds, baths, yearBuilt };
}

export async function fetchPropertyDetailsViaVertex(address: string): Promise<BasicDetails | null> {
  if (!hasServiceAccount()) return null;
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const timeoutMs = Number(process.env.VERTEX_TIMEOUT_MS || '45000');
  const requireGrounded = process.env.REQUIRE_GROUNDED === '1';

  if (requireGrounded) {
    const schema = {
      type: 'OBJECT',
      properties: {
        sqft: { type: 'NUMBER', nullable: true },
        beds: { type: 'NUMBER', nullable: true },
        baths: { type: 'NUMBER', nullable: true },
        yearBuilt: { type: 'NUMBER', nullable: true },
        lotSize: { type: 'NUMBER', nullable: true },
        subdivision: { type: 'STRING', nullable: true },
        sources: { type: 'ARRAY', items: { type: 'STRING' }, nullable: true }
      }
    };
    const prompt = `Use Google Search grounding and authoritative sources (Zillow, Redfin, Realtor, county records).\nReturn JSON ONLY for: ${address}\n{\n  "sqft": number|null,\n  "beds": number|null,\n  "baths": number|null,\n  "yearBuilt": number|null,\n  "lotSize": number|null,\n  "subdivision": string|null,\n  "sources": string[]|null\n}`;
    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: true, timeoutMs, responseSchema: schema });
    try {
      if (text && text.trim()) {
        const obj = JSON.parse(text);
        return normalize(address, obj);
      }
    } catch {}
    return null;
  }

  // 1) Grounded strict JSON
  try {
    const p = `Return ONLY JSON (no prose). Use authoritative sources (Zillow, Redfin, Realtor, county records) to find details for: ${address}\n{\n  "sqft": number | null,\n  "beds": number | null,\n  "baths": number | null,\n  "yearBuilt": number | null,\n  "lotSize": number | null\n}`;
    const t = await vertexGenerate({ sa, projectId, location, model, prompt: p, grounded: true, json: true, timeoutMs });
    if (t && t.trim()) {
      const obj = JSON.parse(t);
      return normalize(address, obj);
    }
  } catch {}

  // 2) Non‑grounded strict JSON
  try {
    const p = `Return ONLY JSON (no prose). Find details for: ${address}\n{\n  "sqft": number | null,\n  "beds": number | null,\n  "baths": number | null,\n  "yearBuilt": number | null,\n  "lotSize": number | null\n}`;
    const t = await vertexGenerate({ sa, projectId, location, model, prompt: p, grounded: false, json: true, timeoutMs });
    if (t && t.trim()) {
      const obj = JSON.parse(t);
      return normalize(address, obj);
    }
  } catch {}

  // 3) Grounded freeform parse
  try {
    const p = `Research: ${address}\nProvide details in clear sentences including sqft, beds, baths, year built, and lot size.`;
    const t = await vertexGenerate({ sa, projectId, location, model, prompt: p, grounded: true, json: false, timeoutMs });
    const parsed = parseFreeform(t);
    if (parsed.sqft || parsed.beds || parsed.baths || parsed.yearBuilt) return normalize(address, parsed);
  } catch {}

  // 4) Grounded sqft-only JSON
  try {
    const p = `Return ONLY JSON: {"sqft": number | null}. Use authoritative sources for: ${address}`;
    const t = await vertexGenerate({ sa, projectId, location, model, prompt: p, grounded: true, json: true, timeoutMs });
    if (t && t.trim()) {
      const obj = JSON.parse(t);
      return normalize(address, { sqft: obj?.sqft ?? null });
    }
  } catch {}

  // 5) Non‑grounded sqft-only JSON
  try {
    const p = `Return ONLY JSON: {"sqft": number | null} for: ${address}`;
    const t = await vertexGenerate({ sa, projectId, location, model, prompt: p, grounded: false, json: true, timeoutMs });
    if (t && t.trim()) {
      const obj = JSON.parse(t);
      return normalize(address, { sqft: obj?.sqft ?? null });
    }
  } catch {}

  return null;
}

function normalize(address: string, obj: any): BasicDetails {
  return {
    address,
    sqft: obj?.sqft != null && Number.isFinite(Number(obj.sqft)) ? Number(obj.sqft) : null,
    beds: obj?.beds != null && Number.isFinite(Number(obj.beds)) ? Number(obj.beds) : null,
    baths: obj?.baths != null ? Number(obj.baths) : null,
    yearBuilt: obj?.yearBuilt != null && Number.isFinite(Number(obj.yearBuilt)) ? Number(obj.yearBuilt) : null,
    lotSize: obj?.lotSize != null && Number.isFinite(Number(obj.lotSize)) ? Number(obj.lotSize) : null,
    success: true,
  };
}
