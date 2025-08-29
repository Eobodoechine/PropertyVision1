'use strict';

// Robust Express entry (CommonJS). Works whether routes export is default, named, or the router itself.
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

// Load .env if present
try {
  require('dotenv').config();
} catch (_) {}

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Import router defensively
let router = null;
try {
  const mod = require('./routes');
  router = (mod && (mod.default || mod.router || (typeof mod === 'function' ? mod : null))) || null;
} catch (err) {
  // If routes is missing or broken, keep API shell alive
  console.warn('[server] routes import failed:', err && err.message);
}

// Root status
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'PropertyVision API',
    node: process.version,
    env: process.env.NODE_ENV || 'development',
    rapidapi_key_present: Boolean(process.env.RAPIDAPI_KEY)
  });
});

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Mount router if available
if (router) {
  app.use('/api', router);
} else {
  console.warn('[server] No router mounted (server/routes.* not exporting a router).');
}

// 404 for unknown API paths (after router)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[server] Uncaught error:', err);
  const status = err && err.status ? err.status : 500;
  res.status(status).json({
    error: err && err.message ? err.message : 'Internal Server Error'
  });
});

const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] Listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown
const shutdown = (sig) => {
  console.log(`[server] ${sig} received. Shutting down...`);
  server.close(() => {
    console.log('[server] Closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
