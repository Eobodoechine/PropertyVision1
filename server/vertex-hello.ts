import 'dotenv/config';
import { VertexClient } from './vertex-client';

async function main() {
  if (!VertexClient.isConfigured()) {
    console.error('Vertex not configured: set GCP_SA_JSON to your service account JSON path.');
    process.exit(2);
  }
  const client = new VertexClient({ grounded: false });
  const text = await client.generateText(process.env.PROMPT_TEXT || 'Say hello.');
  console.log(JSON.stringify({ ok: true, text, model: process.env.VERTEX_MODEL || 'gemini-2.5-pro', location: process.env.VERTEX_LOCATION || 'us-central1' }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('VERTEX HELLO ERROR:', err?.message || err); process.exit(1); });
}

export {};

