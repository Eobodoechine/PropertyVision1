// Robust Express entry (TypeScript / ESM via tsx)
import 'dotenv/config';
import express, { Router } from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Import routes with flexible shapes (default export, named {router}, or directly a Router)
let mounted = false;
try {
  const mod = await import('./routes');
  const candidate: any = (mod as any).default ?? (mod as any).router ?? mod;
  if (candidate && typeof candidate === 'function') {
    app.use('/api', candidate as Router);
    mounted = true;
  }
} catch (err: any) {
  console.warn('[server] routes import failed:', err?.message || err);
}

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'PropertyVision API',
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    rapidapi_key_present: Boolean(process.env.RAPIDAPI_KEY)
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

if (!mounted) {
  console.warn('[server] No router mounted (server/routes.* not exporting a router).');
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Uncaught error:', err);
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'Internal Server Error' });
});

const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] Listening on http://${HOST}:${PORT}`);
});

const shutdown = (sig: string) => {
  console.log(`[server] ${sig} received. Shutting down...`);
  server.close(() => {
    console.log('[server] Closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
