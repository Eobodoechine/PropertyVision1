import 'dotenv/config';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

async function main() {
  const address = process.env.ADDRESS;
  if (!address) throw new Error('ADDRESS env is required');
  const details = await fetchPropertyDetailsViaVertex(address);
  const subdivision = details?.subdivision && details.subdivision.trim() ? details.subdivision.trim() : '';
  console.log(subdivision);
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });

