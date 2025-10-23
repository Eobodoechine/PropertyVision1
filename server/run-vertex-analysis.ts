import 'dotenv/config';

async function main() {
  const address = process.env.ADDRESS || process.argv.slice(2).join(' ');
  if (!address) throw new Error('Set ADDRESS env or pass address as args');
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON to your service account JSON path');
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';

  const mod = await import('./comprehensive-comp-search.js');
  const { ComprehensiveCompSearch } = mod as any;
  const analyzer = new ComprehensiveCompSearch();
  const result = await analyzer.runComprehensiveSearch(address, { sameSubdivision: false });
  console.log(JSON.stringify(result, null, 2));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('RUN ERROR:', err?.message || err); process.exit(1); });
}

export {};
