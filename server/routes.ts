import { Router } from 'express';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Create a new router instance to export
const router = Router();

// Simple info endpoint with version stamp for verification
router.get('/info', (_req, res) => {
  res.json({
    service: 'PropertyVision API',
    version: 'gemini-integration-branch',
    time: new Date().toISOString(),
  });
});

// Non-sensitive env presence check (no key values leaked)
router.get('/env-check', (_req, res) => {
  res.json({
    hasVertexSA: Boolean(process.env.GCP_SA_JSON && process.env.GCP_SA_JSON.trim()),
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim()),
    port: process.env.PORT || '5000'
  });
});

// Deep self-test: checks env, SA JSON, JWT token minting, Maps geocode, and a tiny Vertex call
router.get('/diagnostics/self-test', async (_req, res) => {
  const out: any = { steps: [] };
  const step = async (name: string, fn: () => Promise<void>) => {
    const s: any = { name, ok: false, durationMs: 0 };
    const t0 = Date.now();
    try { await fn(); s.ok = true; } catch (e: any) { s.error = e?.message || String(e); }
    s.durationMs = Date.now() - t0; out.steps.push(s);
  };

  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  let sa: any = null; let projectId: string | null = null; let token: string | null = null;

  await step('env:vars-present', async () => {
    if (!saPath) throw new Error('GCP_SA_JSON missing');
    if (!mapsKey) throw new Error('GOOGLE_MAPS_API_KEY missing');
  });

  await step('sa:read-json', async () => {
    const raw = fs.readFileSync(saPath!, 'utf-8');
    sa = JSON.parse(raw);
    if (!sa.project_id || !sa.client_email || !sa.private_key || !sa.token_uri) throw new Error('SA missing fields');
    projectId = sa.project_id;
  });

  await step('sa:mint-token', async () => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, exp, iat };
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const unsigned = `${b64(header)}.${b64(claims)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
    const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
    const u = new URL(sa.token_uri);
    const tok: any = await new Promise((resolve, reject) => {
      const req2 = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form).toString() } }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req2.on('error', reject);
      req2.write(form); req2.end();
    });
    if (!tok?.access_token) throw new Error('token mint failed');
    token = tok.access_token as string;
  });

  await step('maps:geocode', async () => {
    const addr = '1600 Amphitheatre Parkway, Mountain View, CA 94043';
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${mapsKey}`;
    await new Promise((resolve, reject) => {
      const req2 = https.get(url, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { const j = JSON.parse(data); if (!j?.results?.length) throw new Error('no geocode results'); resolve(null); } catch (e) { reject(e); } });
      });
      req2.on('error', reject);
    });
  });

  await step('vertex:hello', async () => {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }]}], generationConfig: { maxOutputTokens: 8 } });
    await new Promise((resolve, reject) => {
      const u = new URL(url);
      const req2 = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), Authorization: `Bearer ${token}` } }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { if (r.statusCode && r.statusCode >= 200 && r.statusCode < 300) resolve(null); else reject(new Error(`status ${r.statusCode}: ${data.slice(0,200)}`)); });
      });
      req2.on('error', reject);
      req2.write(body); req2.end();
    });
  });

  const ok = out.steps.every((s: any) => s.ok);
  res.json({ ok, ...out });
});

// Add the analysis route that the frontend expects
// Shared analyze handler
async function handleAnalyze(req: any, res: any) {
  try {
    const address = String(req.body?.address || '').trim();
    if (!address || address.length < 6) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const reqId = (req as any).reqId || 'n/a';
    console.log(`🔎 [${reqId}] /api/analyze address=${address}`);

    const { ComprehensiveCompSearch } = await import('./comprehensive-comp-search.js');
    const { fetchPropertyDetailsViaVertex } = await import('./vertex-details.js');

    // Fetch subject details (non-fatal)
    let subj: any = null;
    try {
      subj = await fetchPropertyDetailsViaVertex(address);
      console.log(`[${reqId}] subject details -> sqft=${subj?.sqft ?? 'n/a'} beds=${subj?.beds ?? 'n/a'} baths=${subj?.baths ?? 'n/a'} year=${subj?.yearBuilt ?? 'n/a'}`);
    } catch (e: any) {
      console.warn(`[${reqId}] fetchPropertyDetailsViaVertex failed:`, e?.message || e);
    }
    const subjectSqft = Number(subj?.sqft) || NaN;

    // Run comprehensive search (non-fatal)
    let analysis: any = { all_comps: [], qualified_comps: [], renovation_analysis: { likely_renovated: [], likely_unrenovated: [], market_average: [] } };
    try {
      const compSearch = new ComprehensiveCompSearch();
      analysis = await compSearch.performOptimalSearch(address, (subj?.sqft && subj?.beds != null && subj?.baths != null && subj?.yearBuilt) ? { sqft: subj.sqft, beds: subj.beds, baths: subj.baths, yearBuilt: subj.yearBuilt } : undefined);
      console.log(`[${reqId}] comps all=${analysis?.all_comps?.length ?? 0} qualified=${analysis?.qualified_comps?.length ?? 0} renovated=${analysis?.renovation_analysis?.likely_renovated?.length ?? 0}`);
    } catch (e: any) {
      console.warn(`[${reqId}] performOptimalSearch failed:`, e?.message || e);
    }

    const renovated = (analysis.renovation_analysis?.likely_renovated || [])
      .filter((c: any) => Number.isFinite(Number(c?.price)) && Number.isFinite(Number(c?.sqft)) && Number(c?.sqft) > 0);
    const qualified = (analysis.qualified_comps || [])
      .filter((c: any) => Number.isFinite(Number(c?.price)) && Number.isFinite(Number(c?.sqft)) && Number(c?.sqft) > 0);

    const used = renovated.length >= 3 ? renovated : qualified;
    const ppsf = used.map((c: any) => Number(c.price) / Number(c.sqft)).sort((a: number, b: number) => a - b);
    const percentile = (arr: number[], p: number) => {
      if (!arr.length) return NaN;
      const idx = (arr.length - 1) * p;
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      if (lo === hi) return arr[lo];
      const w = idx - lo;
      return arr[lo] * (1 - w) + arr[hi] * w;
    };
    const median = percentile(ppsf, 0.5);
    const p10 = percentile(ppsf, 0.10);
    const p90 = percentile(ppsf, 0.90);

    const arvEstimate = Number((analysis as any).arv?.estimate) || (Number.isFinite(median) && Number.isFinite(subjectSqft) ? Math.round(median * subjectSqft) : null);
    const rangeLow = Number.isFinite(p10) && Number.isFinite(subjectSqft) ? Math.round(p10 * subjectSqft) : null;
    const rangeHigh = Number.isFinite(p90) && Number.isFinite(subjectSqft) ? Math.round(p90 * subjectSqft) : null;

    // If we truly have nothing, return a soft result instead of 500
    if (!used.length) {
      console.warn(`[${reqId}] no qualified comps`);
      return res.status(200).json({
        ok: false,
        address,
        error: 'No qualified comparables found. Try broadening criteria or check API keys.',
        subject: {
          sqft: Number.isFinite(subjectSqft) ? subjectSqft : null,
          beds: subj?.beds ?? null,
          baths: subj?.baths ?? null,
          yearBuilt: subj?.yearBuilt ?? null,
          subdivision: subj?.subdivision ?? null,
        },
        arv: { estimate: null, rangeLow: null, rangeHigh: null, method: 'Median PPSF', confidence: 'low', dataPoints: 0 },
        compsUsed: [],
        compsAll: analysis.all_comps || []
      });
    }

    res.json({
      ok: true,
      address,
      subject: {
        sqft: Number.isFinite(subjectSqft) ? subjectSqft : null,
        beds: subj?.beds ?? null,
        baths: subj?.baths ?? null,
        yearBuilt: subj?.yearBuilt ?? null,
        subdivision: subj?.subdivision ?? null,
      },
      arv: {
        estimate: arvEstimate,
        rangeLow,
        rangeHigh,
        method: (analysis as any).arv?.method || 'Median PPSF',
        confidence: (analysis as any).arv?.confidence || (used.length >= 4 ? 'high' : used.length >= 3 ? 'medium' : 'low'),
        dataPoints: (analysis as any).arv?.dataPoints || used.length,
      },
      compsUsed: used.map((c: any) => ({
        address: c.address,
        price: Number(c.price),
        sqft: Number(c.sqft),
        beds: c.beds ?? null,
        baths: c.baths ?? null,
        yearBuilt: c.yearBuilt ?? null,
        soldDate: c.soldDate ?? null,
        distance: Number.isFinite(Number(c.distance)) ? Number(c.distance) : null,
        ppsf: Number(c.price) / Number(c.sqft),
        source: c.source ?? null,
      })),
      compsAll: (analysis.all_comps || []).map((c: any) => ({
        address: c.address,
        price: Number(c.price),
        sqft: Number(c.sqft),
        beds: c.beds ?? null,
        baths: c.baths ?? null,
        yearBuilt: c.yearBuilt ?? null,
        soldDate: c.soldDate ?? null,
        distance: Number.isFinite(Number(c.distance)) ? Number(c.distance) : null,
        ppsf: Number(c.price) / Number(c.sqft),
        source: c.source ?? null,
      })),
    });
  } catch (error: any) {
    console.error('❌ /api/analyze failed:', error?.message || error);
    // Return soft error to avoid 500s in the UI; include a safe message
    res.status(200).json({ ok: false, error: 'Analysis failed', details: error?.message || 'unknown' });
  }
}

// Pre-flight env validation middleware for analyze routes
function validateServerConfig(req: any, res: any, next: any) {
  try {
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!saPath || !fs.existsSync(saPath)) {
      return res.status(500).json({ error: 'Server not configured: GCP_SA_JSON missing or path not found', details: saPath || '(unset)' });
    }
    if (!mapsKey || mapsKey.trim().length === 0) {
      return res.status(500).json({ error: 'Server not configured: GOOGLE_MAPS_API_KEY missing' });
    }
  } catch {}
  next();
}

router.post('/analyze', validateServerConfig, handleAnalyze);
// Compatibility alias for client expecting /api/property/analyze
router.post('/property/analyze', validateServerConfig, handleAnalyze);

// Simple diagnostic endpoint for client-side checks
router.get('/config/check', (_req, res) => {
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  res.json({
    hasServiceAccount: Boolean(saPath && fs.existsSync(saPath)),
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  });
});

// Grounded health check: GET /api/grounded/health?address=...
// Calls Vertex with google_search grounding and a strict JSON schema,
// returns the raw Vertex response (including groundingMetadata) to verify
// that web search queries are being issued.
router.get('/grounded/health', async (req, res) => {
  try {
    const address = String((req.query.address as string) || '').trim();
    if (!address || address.length < 5) {
      return res.status(400).json({ error: 'Query param "address" is required' });
    }

    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    if (!saPath || !fs.existsSync(saPath)) {
      return res.status(500).json({ error: 'Server not configured with GCP_SA_JSON' });
    }

    const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    const projectId = process.env.PROJECT_ID || sa.project_id;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';

    // Mint access token via service account JWT
    const token = await (async () => {
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const header = { alg: 'RS256', typ: 'JWT' };
      const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, exp, iat };
      const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
      const unsigned = `${b64(header)}.${b64(claims)}`;
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(unsigned);
      const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
      const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
      const u = new URL(sa.token_uri);
      const tok: any = await new Promise((resolve, reject) => {
        const req2 = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form).toString() } }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req2.on('error', reject);
        req2.write(form);
        req2.end();
      });
      if (!tok?.access_token) throw new Error('sa-token-failed');
      return tok.access_token as string;
    })();

    // Build grounded schema request
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const responseSchema = {
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
    const prompt = `Use Google Search grounding and authoritative sources (Zillow, Redfin, Realtor, county records).\nReturn JSON ONLY for: ${address}.`;
    const payload: any = {
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0, maxOutputTokens: 1500, responseMimeType: 'application/json', responseSchema },
      tools: [{ google_search: {} } as any]
    };

    const vertexResp: any = await new Promise((resolve, reject) => {
      const u = new URL(url);
      const body = JSON.stringify(payload);
      const req3 = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), Authorization: `Bearer ${token}` } }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }) } });
      });
      req3.on('error', reject);
      req3.write(body);
      req3.end();
    });

    res.json({ ok: true, address, model, location, response: vertexResp });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Grounded health failed' });
  }
});

// Export the router as default
export default router;
