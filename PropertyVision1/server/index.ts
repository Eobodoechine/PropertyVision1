// Robust Express entry (TypeScript / ESM via tsx)
import 'dotenv/config';
import express, { Router } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { setupVite, serveStatic, log } from './vite';
import { addLog, getLast, clearLogs } from './utils/devLog';

const app = express();
app.set('trust proxy', 1);
const CORS_ORIGIN = process.env.CORS_ORIGIN;
if (CORS_ORIGIN && CORS_ORIGIN.trim().length > 0) {
  const origins = CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true }));
} else {
  app.use(cors());
}
app.use(express.json({ limit: '1mb' }));

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

// Setup Vite development server or serve static files
if (process.env.NODE_ENV === 'development') {
  log('🚀 Setting up Vite development server...');
  await setupVite(app, server);
  log('✅ Vite development server ready');
} else {
  log('📦 Serving static files...');
  serveStatic(app);
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

const PORT = Number(process.env.PORT) || 5000;
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
