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

// Add the analysis route that the frontend expects
router.post("/analyze", async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    console.log(`🔍 Starting analysis for: ${address}`);
    
    // Import and use the FullAnalysisService
    const { FullAnalysisService } = await import('./full-analysis.ts');
    const analysisService = new FullAnalysisService();
    
    const result = await analysisService.runFullAnalysis(address);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
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
