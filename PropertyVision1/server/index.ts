// Robust Express entry (TypeScript / ESM via tsx)
import 'dotenv/config';
import express, { Router } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { setupVite, serveStatic, log } from './vite';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const server = createServer(app);

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
  const status = err?.status || 500;
  res.status(status).json({ error: err?.message || 'Internal Server Error' });
});

const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  log(`🌟 PropertyVision server running on http://${HOST}:${PORT}`);
  log(`📱 Frontend: http://${HOST}:${PORT}`);
  log(`🔌 API: http://${HOST}:${PORT}/api`);
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
