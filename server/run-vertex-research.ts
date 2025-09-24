import 'dotenv/config';

async function main() {
  const address = process.env.ADDRESS || process.argv.slice(2).join(' ');
  if (!address) throw new Error('Set ADDRESS env or pass address as args');
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  if (!saPath) throw new Error('Set GCP_SA_JSON to your service account JSON path');
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';

  const mod = await import('./step2-property-research.js');
  const { PropertyResearchService } = mod as any;
  const researchService = new PropertyResearchService();
  const details = await researchService.researchProperty(address);
  console.log(JSON.stringify({ address, details, model, location }, null, 2));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('RUN RESEARCH ERROR:', err?.message || err); process.exit(1); });
}

export {};
