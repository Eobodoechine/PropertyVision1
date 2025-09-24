import 'dotenv/config';
import { PropertyResearchService } from './step2-property-research';

async function main() {
  const address = process.env.ADDRESS;
  if (!address) throw new Error('ADDRESS env var is required');
  const svc = new PropertyResearchService();
  const res = await svc.researchProperty(address);
  const out = {
    address,
    success: res.success,
    sqft: res.sqft,
    beds: res.beds,
    baths: res.baths,
    yearBuilt: res.yearBuilt,
    lotSize: res.lotSize,
    error: res.success ? undefined : res.error,
  };
  console.log(JSON.stringify(out, null, 2));
}

if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err?.message || err); process.exit(1); });
}

export {};
