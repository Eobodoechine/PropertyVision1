import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

type Strategy = {
  name: string;
  prompt: (ctx: Ctx) => string;
  strict?: boolean;
};

type Ctx = {
  address: string;
  radius: number;
  months: number;
  subdivision?: string;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
};

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
  const u = new URL(sa.token_uri);
  const tokenResp: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body.toString()).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body.toString());
    req.end();
  });
  if (!tokenResp?.access_token) throw new Error('sa-token-failed');
  return tokenResp.access_token as string;
}

async function vertexGenerateRaw({ token, location, projectId, model, prompt }: { token: string; location: string; projectId: string; model: string; prompt: string; }): Promise<string> {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 2500 }
  };
  const u = new URL(url);
  const body = JSON.stringify(payload);
  const resp: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
  const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p?.text || '').join('');
}

// Simple concurrency pool
async function runWithLimit<T>(limit: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  let active = 0;
  return await new Promise((resolve, reject) => {
    const next = () => {
      if (i >= tasks.length && active === 0) return resolve(results);
      while (active < limit && i < tasks.length) {
        const idx = i++;
        active++;
        tasks[idx]().then((res) => {
          results[idx] = res;
          active--;
          next();
        }).catch((err) => {
          results[idx] = err;
          active--;
          next();
        });
      }
    };
    next();
  });
}

function buildStrategies(): Strategy[] {
  const baseFields = 'address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | distance_miles | source_url';
  const clusterStreets = ['Jordan Pl', 'Bailey Ct', 'Bailey Station Cir', 'Ridgemont Dr'];
  const cluster = clusterStreets.join(', ');

  const S: Strategy[] = [];

  // 1) Subdivision strict / default variants
  S.push({ name: 'subdivision-strict-20-distance', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties near "${c.address}" within ${c.radius} miles and ${c.months} months.
${c.subdivision ? `Only include properties in subdivision "${c.subdivision}".
` : ''}${c.sqft && c.beds ? `Match subject: beds within ±1 of ${c.beds}, sqft within ±20% of ${c.sqft}.
` : ''}Reject listings/pendings or missing sale date/price. No commentary, no headers. Return 20 lines.` });

  S.push({ name: 'subdivision-default-20',
    prompt: (c) => `Find recently SOLD comparable properties near ${c.address}. Within ${c.radius} miles, last ${c.months} months. ${c.subdivision ? `Subdivision: ${c.subdivision}.` : ''} Single-family. Return 20 properties (address, sold price, sold date, beds, baths, sqft, year, source URL).` });

  // 2) Street cluster strict variants
  S.push({ name: 'street-cluster-strict-1mi', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties within 1 mile of ${c.address} on/near: ${cluster}. Last ${c.months} months. No commentary. Return 20 lines.` });

  // 3) ZIP/City
  S.push({ name: 'zip-city-strict', strict: true,
    prompt: (c) => { const zip = (c.address.match(/\b\d{5}\b/) || [])[0] || ''; return `Return ONLY ${baseFields} for SOLD single-family properties within ${c.radius} miles of ${c.address} (ZIP must be ${zip} unless within ${c.radius} miles of subject). City must be Fayetteville, GA. Last ${c.months} months. No commentary. Return 20 lines.`; } });

  // 4) Renovated
  S.push({ name: 'renovated-terms-strict-20', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties near "${c.address}" within ${c.radius} miles and ${c.months} months that are recently renovated/updated/move-in ready. Reject missing sale date/price. No commentary. Return 20 lines.` });

  // 5) Broader strict with subject filters
  S.push({ name: 'broader-strict-20', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${c.radius} miles and ${c.months} months. Prefer beds within ±1 of ${c.beds ?? ''} and sqft within ±20% of ${c.sqft ?? ''}. No commentary. Return 20 lines.` });

  // 6) Rings (1mi/2mi/3mi)
  [1,2,3].forEach(mi => {
    S.push({ name: `ring-${mi}mi-strict`, strict: true,
      prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${mi} miles and ${c.months} months. No commentary. Return 20 lines.` });
  });

  // 7) Subject-card anchored prompt
  S.push({ name: 'subject-card-subdivision-strict', strict: true,
    prompt: (c) => `Subject: ${c.address}\nZIP: ${(c.address.match(/\b\d{5}\b/) || [])[0] || ''}\nLat/Lon: (use for locality)\nBeds/Baths: ${c.beds ?? ''}/${c.baths ?? ''}\nSqft: ${c.sqft ?? ''}\nYear: ${c.yearBuilt ?? ''}\n${c.subdivision ? `Subdivision: ${c.subdivision}\n` : ''}\nReturn ONLY ${baseFields} for SOLD single-family properties within ${c.radius} miles and ${c.months} months.\nConstraints: beds ±1, sqft ±20%, reject condos, reject missing sale date/price. No commentary. Return 20 lines.` });

  // 8) Domain-allowlist strict
  S.push({ name: 'domain-allowlist-strict', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${c.radius} miles and ${c.months} months. Source URL must be one of: zillow.com, redfin.com, realtor.com, homes.com. Reject others. No commentary. Return 20 lines.` });

  // 9) Table default with explicit columns (some models format better)
  S.push({ name: 'table-default-20',
    prompt: (c) => `Provide a table of 20 SOLD single-family properties near ${c.address} within ${c.radius} miles and ${c.months} months, with columns: address, sold_price, sold_date (YYYY-MM-DD), beds, baths, sqft, year_built, source_url.` });

  return S;
}

function scoreTargets(text: string, targets: string[]): { hits: string[]; missing: string[] } {
  const norm = (s: string) => s.toLowerCase();
  const lower = norm(text);
  const hits: string[] = [];
  const missing: string[] = [];
  targets.forEach(t => {
    const found = lower.includes(norm(t));
    (found ? hits : missing).push(t);
  });
  return { hits, missing };
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const radius = Number(process.env.RADIUS || '3');
  const months = Number(process.env.MONTHS || '18');
  const targets = [
    '110 bailey ct',
    '385 stoneridge way',
    '560 ridgemont',
    '12558 lakeside pkwy',
    '280 ridgemont',
    '125 winter valley'
  ];

  // Fetch subject details (for subdivision and constraints)
  let details = await fetchPropertyDetailsViaVertex(address);
  const ctx: Ctx = {
    address,
    radius,
    months,
    subdivision: details?.subdivision || undefined,
    sqft: details?.sqft || undefined,
    beds: details?.beds || undefined,
    baths: details?.baths || undefined,
    yearBuilt: details?.yearBuilt || undefined,
  };

  console.log('🧩 Context:', ctx);

  // SA + endpoint
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  const strategies = buildStrategies();
  const tasks = strategies.map((s) => async () => {
    try {
      const prompt = s.prompt(ctx);
      const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });
      const scored = scoreTargets(text || '', targets);
      return { name: s.name, strict: !!s.strict, hits: scored.hits, missing: scored.missing, text: text || '' };
    } catch (err: any) {
      return { name: s.name, strict: !!s.strict, hits: [], missing: targets.slice(), text: '', error: err?.message || String(err) };
    }
  });

  // Run with concurrency
  const CONCURRENCY = Number(process.env.CONCURRENCY || '6');
  console.log(`⚙️  Running ${strategies.length} strategies with concurrency=${CONCURRENCY}...`);
  const results = await runWithLimit(CONCURRENCY, tasks);

  // Report summary
  console.log('\n📊 SUMMARY (hits per strategy):');
  results.forEach((r: any) => {
    const hitCount = Array.isArray(r?.hits) ? r.hits.length : 0;
    const hitList = Array.isArray(r?.hits) ? r.hits.join(', ') : '';
    const err = r?.error ? ` error=${r.error}` : '';
    console.log(`- ${r?.name || 'unknown'}${r?.strict ? ' (strict)' : ''}: hits=${hitCount} [${hitList}]${err}`);
  });

  // Show best few
  const safeResults = results.filter((r: any) => r && Array.isArray(r.hits));
  const sorted = [...safeResults].sort((a: any, b: any) => b.hits.length - a.hits.length);
  console.log('\n🏆 TOP STRATEGIES:');
  sorted.slice(0, 3).forEach((r: any, i: number) => {
    console.log(`\n${i + 1}. ${r.name}${r.strict ? ' (strict)' : ''} — hits=${r.hits.length}`);
    console.log(r.text.slice(0, 2000));
  });
}

main().catch(err => { console.error('Bakeoff failed:', err?.message || err); process.exit(1); });
