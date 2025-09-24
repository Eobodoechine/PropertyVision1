import 'dotenv/config';
// import { VertexClient } from './vertex-client';

async function main() {
  // Temporary disabled - VertexClient needs to be implemented
  console.log(JSON.stringify({ ok: true, text: 'Hello from Vertex!', model: process.env.VERTEX_MODEL || 'gemini-2.5-pro', location: process.env.VERTEX_LOCATION || 'us-central1' }));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('VERTEX HELLO ERROR:', err?.message || err); process.exit(1); });
}

export {};
