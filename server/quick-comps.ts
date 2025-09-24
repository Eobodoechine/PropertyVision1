import 'dotenv/config';

import { GeocodingService } from './step1-geocoding';
import { ComparableSearchService } from './step3-find-comparables';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';

async function main() {
  // Watchdog: exit if no console activity for 60s
  let lastActivity = Date.now();
  const origLog = console.log.bind(console);
  const origErr = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  const bump = () => { lastActivity = Date.now(); };
  console.log = (...args: any[]) => { bump(); return origLog(...args); };
  console.error = (...args: any[]) => { bump(); return origErr(...args); };
  console.warn = (...args: any[]) => { bump(); return origWarn(...args); };
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > 60000) {
      origErr('⏱️ Overall inactivity timeout reached (60s). Aborting.');
      clearInterval(watchdog);
      process.exit(124);
    }
  }, 5000);

  const address = process.env.ADDRESS;
  if (!address) throw new Error('ADDRESS env var is required');

  const geocoder = new GeocodingService();
  const compsSvc = new ComparableSearchService();

  const geo = await geocoder.geocodeAddress(address);
  if (!geo.success) throw new Error(`Geocoding failed: ${geo.error}`);

  const fast = process.env.FAST === '1';
  const minimal = process.env.MINIMAL === '1';
  const plan: Array<{ months: number; radius: number; label: string }> = minimal
    ? [ { months: 12, radius: 2.0, label: '12 months @ 2 miles' } ]
    : fast
    ? [
        { months: 12, radius: 2.0, label: '12 months @ 2 miles' },
        { months: 24, radius: 2.0, label: '24 months @ 2 miles' },
      ]
    : [
        { months: 6, radius: 1.0, label: '6 months @ 1 mile' },
        { months: 12, radius: 1.0, label: '12 months @ 1 mile' },
        { months: 12, radius: 2.0, label: '12 months @ 2 miles' },
        { months: 24, radius: 1.0, label: '24 months @ 1 mile' },
        { months: 24, radius: 2.0, label: '24 months @ 2 miles' },
        { months: 24, radius: 3.0, label: '24 months @ 3 miles' },
      ];

  const compMap = new Map<string, any>();
  const stagesTried: string[] = [];
  const subjSqftEnv = process.env.SUBJECT_SQFT ? Number(process.env.SUBJECT_SQFT) : null;

  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  const useVertexMinimal = Boolean(saPath) && (process.env.MINIMAL === '1');

  // If we have a service account and MINIMAL mode, fetch comps directly via Vertex to avoid API key and grounding
  if (useVertexMinimal) {
    const sa = JSON.parse(fs.readFileSync(saPath!, 'utf-8')) as any;
    const prompt1 = `Return ONLY JSON (no prose). Find up to 5 RECENTLY SOLD single-family comps within 2 miles of "${address}" in the last 24 months. Prefer renovated/updated; avoid as-is.
If any field is unknown, use null. Do not omit the object because of missing fields.

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
    const grounded = process.env.GROUNDING === '1' || process.env.USE_GROUNDING === '1';
    const vertexModel = process.env.VERTEX_MODEL || 'gemini-1.5-flash-001';
    const vertexLocation = process.env.VERTEX_LOCATION || 'us-central1';
    const text1 = await vertexGenerate(sa, sa.project_id, vertexLocation, vertexModel, prompt1, grounded);
    let arr: any[] = [];
    try {
      const m = text1 && String(text1).match(/\[[\s\S]*\]/);
      if (m) arr = JSON.parse(m[0]);
    } catch {}

    // If too few comps, relax distance to 3 miles and try again once
    if (!arr || arr.length < 2) {
      const prompt2 = `Return ONLY JSON (no prose). Find up to 8 RECENTLY SOLD single-family comps within 3 miles of "${address}" in the last 24 months. Prefer renovated/updated; avoid as-is.
If any field is unknown, use null. Do not omit the object because of missing fields.

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
      const text2 = await vertexGenerate(sa, sa.project_id, vertexLocation, vertexModel, prompt2, grounded);
      try {
        const m2 = text2 && String(text2).match(/\[[\s\S]*\]/);
        if (m2) arr = JSON.parse(m2[0]);
      } catch {}
    }

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
    })).filter((c: any) => c.address && Number.isFinite(c.price));

    const output = {
      address,
      coordinates: { lat: geo.lat, lon: geo.lon },
      stagesTried: ['vertex-minimal-12mo@2mi'],
      count: comps.length,
      comps,
    };
    console.log(JSON.stringify(output, null, 2));
    clearInterval(watchdog);
    return;
  }

  for (const step of plan) {
    stagesTried.push(step.label);
    const res = await compsSvc.findComparables(
      address,
      geo.lat.toString(),
      geo.lon.toString(),
      step.radius,
      10,
      step.months
    );
    if (res.success) {
      for (const c of res.comparables) {
        if (!compMap.has(c.address)) compMap.set(c.address, c);
      }
    }
    // Early stop as soon as we have 3 high-quality comps
    const agg = Array.from(compMap.values());
    const isRenovated = (s?: string) => s ? /renovat|update|remodel|move[- ]?in/i.test(s) : false;
    const quality = agg.filter(c => isRenovated(c.condition) || c.confidence === 'high');
    if (quality.length >= (fast ? 2 : 3)) break;
  }

  // Select top 3 quality comps: prefer renovated/updated, closest distance, then GLA proximity if subject sqft known
  const all = Array.from(compMap.values());
  const isRenovated = (s?: string) => s ? /renovat|update|remodel|move[- ]?in/i.test(s) : false;
  const scored = all.map(c => {
    const renovated = isRenovated(c.condition) ? 1 : 0;
    const dist = Number.isFinite(c.distance) ? c.distance : 5;
    const glaDelta = subjSqftEnv && c.sqft ? Math.abs(c.sqft - subjSqftEnv) : 9999;
    const score = renovated * 1000 - (1 / (dist + 0.1)) * 100 - (1 / (glaDelta + 1));
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const comps = scored.slice(0, (fast ? 2 : 3)).map(s => s.c);

  const output = {
    address,
    coordinates: { lat: geo.lat, lon: geo.lon },
    stagesTried,
    count: comps.length,
    comps: comps.map(c => ({
      address: c.address,
      price: c.price,
      sqft: c.sqft,
      beds: c.beds,
      baths: c.baths,
      yearBuilt: c.yearBuilt,
      soldDate: c.soldDate,
      distance: Number.isFinite(c.distance) ? Number(c.distance.toFixed(2)) : null,
      source: c.source
    }))
  };

  console.log(JSON.stringify(output, null, 2));
  clearInterval(watchdog);
}

// Vertex AI: service-account based OAuth and generateContent call
async function vertexGenerate(sa: any, projectId: string, location: string, model: string, prompt: string, grounded: boolean): Promise<string> {
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const payload = {
    contents: [ { role: 'user', parts: [ { text: prompt } ] } ],
    generationConfig: { temperature: 0, maxOutputTokens: 800, responseMimeType: 'application/json' },
    tools: grounded ? [ { google_search: {} as any } ] : undefined
  };
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` });
  const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    exp,
    iat,
  };
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

async function httpsPostForm(url: string, body: string, headers: Record<string,string>): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function httpsPostJson(url: string, payload: any, headers: Record<string,string>): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err?.message || err); process.exit(1); });
}

export {};
