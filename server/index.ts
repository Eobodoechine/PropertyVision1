// Robust Express entry (TypeScript / ESM via tsx)
import 'dotenv/config';
import express, { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { setupVite, serveStatic, log } from './vite';
import { addLog, getLast, clearLogs } from './utils/devLog';
import { setupGlobalErrorLogging, logError } from './utils/errorFileLogger';
import { randomUUID } from 'crypto';

const app = express();
// Attach global error logging (uncaught/unhandled + console.error mirroring)
setupGlobalErrorLogging();
app.set('trust proxy', 1);
const CORS_ORIGIN = process.env.CORS_ORIGIN;
if (CORS_ORIGIN && CORS_ORIGIN.trim().length > 0) {
  const origins = CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true }));
} else {
  app.use(cors());
}
app.use(express.json({ limit: '1mb' }));

// Lightweight request ID + timing for API routes
app.use('/api', (req, res, next) => {
  const id = (req.headers['x-request-id'] as string) || randomUUID();
  (req as any).reqId = id;
  const started = Date.now();
  res.setHeader('x-request-id', id);
  res.on('finish', () => {
    const ms = Date.now() - started;
    try { addLog(`REQ ${id} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`); } catch {}
  });
  next();
});

const server = createServer(app);

// Dev-only API request logger to help trace routing and content-types
if ((process.env.NODE_ENV || 'development') === 'development') {
  app.use('/api', (req, res, next) => {
    const start = Date.now();
    const { method, originalUrl } = req;
    res.on('finish', () => {
      const ms = Date.now() - start;
      const ct = res.get('Content-Type') || '';
      const line = `DEV API LOG: ${method} ${originalUrl} -> ${res.statusCode} ${ct} (${ms}ms)`;
      log(line, 'express');
      addLog(line);
    });
    next();
  });
}

// Error logging middleware to capture route/middleware errors
app.use((err: any, req: Request, _res: Response, next: NextFunction) => {
  try {
    logError(err, { path: req.path, method: req.method });
  } catch {}
  next(err);
});

// In development, only mount Vite middleware if explicitly enabled
if ((process.env.NODE_ENV || 'development') === 'development' && process.env.USE_VITE_MIDDLEWARE === '1') {
  try {
    await setupVite(app, server);
    log('🛠️ Vite dev middleware mounted (UI + HMR)');
  } catch (err: any) {
    console.warn('[server] setupVite failed:', err?.message || err);
  }
}

// Import routes with flexible shapes (default export, named {router}, or directly a Router)
let mounted = false;
try {
  const mod = await import('./routes');
  const candidate: any = (mod as any).default ?? (mod as any).router ?? mod;
  if (candidate && typeof candidate === 'function') {
    app.use('/api', candidate as Router);
    mounted = true;
    log('✅ API routes mounted successfully');
  }
} catch (err: any) {
  console.warn('[server] routes import failed:', err?.message || err);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Minimal info endpoint (no secrets)
app.get('/api/info', (_req, res) => {
  res.json({
    env: process.env.NODE_ENV || 'development',
    rapidapi_key_present: Boolean(process.env.RAPIDAPI_KEY),
    maps_key_present: Boolean(process.env.GOOGLE_MAPS_API_KEY),
  });
});

// Grounded health: verify grounded web search emits queries and returns JSON
app.get('/api/grounded/health', async (req, res) => {
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

    // SA token
    const token = await (async () => {
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const header = { alg: 'RS256', typ: 'JWT' };
      const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, exp, iat } as any;
      const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
      const unsigned = `${b64(header)}.${b64(claims)}`;
      const sign = (crypto as any).createSign('RSA-SHA256');
      sign.update(unsigned);
      const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
      const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
      const u = new URL(sa.token_uri);
      const out: any = await new Promise((resolve, reject) => {
        const r = (https as any).request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form).toString() } }, (rr: any) => {
          let data = '';
          rr.on('data', (c: any) => data += c);
          rr.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        r.on('error', reject);
        r.write(form);
        r.end();
      });
      if (!out?.access_token) throw new Error('sa-token-failed');
      return out.access_token as string;
    })();

    // Grounded schema request
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
    } as any;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: `Use Google Search grounding. Return JSON only for: ${address}.` }]}],
      generationConfig: { temperature: 0, maxOutputTokens: 1500, responseMimeType: 'application/json', responseSchema },
      tools: [{ google_search: {} } as any]
    };
    const vertexResp: any = await new Promise((resolve, reject) => {
      const u = new URL(url);
      const body = JSON.stringify(payload);
      const rq = (https as any).request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), Authorization: `Bearer ${token}` } }, (rr: any) => {
        let data = '';
        rr.on('data', (c: any) => data += c);
        rr.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }) } });
      });
      rq.on('error', reject);
      rq.write(body);
      rq.end();
    });

    res.json({ ok: true, address, model, location, response: vertexResp });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Grounded health failed' });
  }
});

// Grounded freeform subject details: returns text + grounding metadata + light parse
app.get('/api/grounded/details', async (req, res) => {
  try {
    const address = String((req.query.address as string) || '').trim();
    if (!address || address.length < 5) {
      return res.status(400).json({ error: 'Query param "address" is required' });
    }
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    if (!saPath || !fs.existsSync(saPath)) {
      return res.status(500).json({ error: 'Server not configured with GCP_SA_JSON' });
    }
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8')) as any;
    const projectId = process.env.PROJECT_ID || sa.project_id;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';

    // SA token
    const token = await (async () => {
      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const header = { alg: 'RS256', typ: 'JWT' };
      const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, exp, iat } as any;
      const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
      const unsigned = `${b64(header)}.${b64(claims)}`;
      const sign = (crypto as any).createSign('RSA-SHA256');
      sign.update(unsigned);
      const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
      const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
      const u = new URL(sa.token_uri);
      const out: any = await new Promise((resolve, reject) => {
        const r = (https as any).request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form).toString() } }, (rr: any) => {
          let data = '';
          rr.on('data', (c: any) => data += c);
          rr.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        r.on('error', reject);
        r.write(form);
        r.end();
      });
      if (!out?.access_token) throw new Error('sa-token-failed');
      return out.access_token as string;
    })();

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const prompt = `Facts only. No valuation or advice. Provide subject property facts with source links for: ${address}.\nFields: sqft, beds, baths, year built, lot size, subdivision (if known).`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      tools: [{ google_search: {} } as any]
    } as any;
    const vertexResp: any = await new Promise((resolve, reject) => {
      const u = new URL(url);
      const body = JSON.stringify(payload);
      const rq = (https as any).request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), Authorization: `Bearer ${token}` } }, (rr: any) => {
        let data = '';
        rr.on('data', (c: any) => data += c);
        rr.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }) } });
      });
      rq.on('error', reject);
      rq.write(body);
      rq.end();
    });
    const parts: any[] = vertexResp?.candidates?.[0]?.content?.parts || [];
    const text: string = parts.map((p: any) => p?.text || '').join('');
    // minimal parser
    const clean = (s: string) => s.replace(/,/g, '').trim();
    const num = (m: RegExpMatchArray | null) => (m ? Number(clean(m[1])) : null);
    const sqft = num(text.match(/(\d{3,5})\s*(?:sq\s*ft|sqft)/i));
    const beds = num(text.match(/\b(?:bedrooms?|beds?)\D*([0-9]{1,2})\b/i));
    const baths = (() => { const m = text.match(/\b(?:bathrooms?|baths?)\D*([0-9]+(?:\.[0-9]+)?)/i); return m ? Number(clean(m[1])) : null; })();
    const yearBuilt = num(text.match(/\b(?:year\s*built|built)\D*([12][0-9]{3})\b/i));
    res.json({ ok: true, address, model, location, text, groundingMetadata: vertexResp?.candidates?.[0]?.groundingMetadata || null, parsed: { sqft, beds, baths, yearBuilt } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Grounded details failed' });
  }
});

// Temporary debug endpoint (no secrets): helps verify routing/base and headers
app.get('/api/debug', (req, res) => {
  res.json({
    now: new Date().toISOString(),
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    path: req.path,
    headers: {
      host: req.headers['host'],
      'x-forwarded-host': req.headers['x-forwarded-host'],
      'x-forwarded-proto': req.headers['x-forwarded-proto'],
      'x-forwarded-port': req.headers['x-forwarded-port'],
      origin: req.headers['origin'],
      referer: req.headers['referer'],
    },
    server: {
      env: process.env.NODE_ENV || 'development',
      port: Number(process.env.PORT) || 5000,
      cors_origin: process.env.CORS_ORIGIN || null,
    },
    keys_present: {
      rapidapi: Boolean(process.env.RAPIDAPI_KEY),
      google_maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY),
    },
  });
});

// Dev-only logs endpoint: GET /api/logs?limit=200 with optional header x-logs-token
if ((process.env.NODE_ENV || 'development') === 'development') {
  app.get('/api/logs', (req, res) => {
    const token = (req.headers['x-logs-token'] as string | undefined) || (req.query.token as string | undefined);
    const expected = process.env.LOGS_TOKEN;
    if (expected && token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const limit = parseInt(String(req.query.limit || '200'), 10);
    const lines = getLast(limit);
    res.json({ lines });
  });

  app.post('/api/logs/clear', (req, res) => {
    const token = (req.headers['x-logs-token'] as string | undefined) || (req.query.token as string | undefined);
    const expected = process.env.LOGS_TOKEN;
    if (expected && token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    clearLogs();
    res.json({ ok: true });
  });
}

if (!mounted) {
  console.warn('[server] No router mounted (server/routes.* not exporting a router).');
}

// API-only by default: do not serve static client unless explicitly enabled
const ENABLE_STATIC = String(process.env.ENABLE_STATIC || '').toLowerCase() === '1';
if (ENABLE_STATIC) {
  log('📦 Serving static files (ENABLE_STATIC=1)...');
  serveStatic(app);
} else {
  log('🧩 API-only mode (no static client). Use separate Vite dev server for UI on port 3000.');
}

// API 404 handler (only for /api routes)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Uncaught error:', err);
  try { addLog(`[ERROR] ${err?.message || err}`); } catch {}
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'Internal Server Error' });
});

const PORT = Number(process.env.PORT) || 3001;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  log(`🌟 PropertyVision server running on http://${HOST}:${PORT}`);
  log(`📱 Frontend: http://${HOST}:${PORT}`);
  log(`🔌 API: http://${HOST}:${PORT}/api`);
  if ((process.env.NODE_ENV || 'development') === 'development') {
    const corsOrigin = process.env.CORS_ORIGIN || '(any)';
    log(`DEV INFO: CORS_ORIGIN=${corsOrigin}`);
    log(`DEV INFO: Note: VITE_API_BASE is a client env; verify it in the client build if requests misroute.`);
    try { addLog('Server started in development mode'); } catch {}
  }
});

const shutdown = (sig: string) => {
  log(`${sig} received. Shutting down...`);
  server.close(() => {
    log('Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Capture unhandled errors for logs
process.on('unhandledRejection', (reason: any) => {
  try { addLog(`[UNHANDLED REJECTION] ${reason?.message || reason}`); } catch {}
});
process.on('uncaughtException', (err: any) => {
  try { addLog(`[UNCAUGHT EXCEPTION] ${err?.message || err}`); } catch {}
});
