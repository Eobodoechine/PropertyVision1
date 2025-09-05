import 'dotenv/config';
import { loggedFetch } from './infra/rapid';

async function main() {
  const address = process.env.ADDRESS;
  if (!address) throw new Error('Set ADDRESS env var');
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY env missing');

  console.log(`Looking up baths for: ${address}`);
  // Try autocomplete v2 to get mpr_id/property_id
  const acUrl = `https://realty-in-us.p.rapidapi.com/locations/v2/auto-complete?input=${encodeURIComponent(address)}&limit=10`;
  const acResp = await loggedFetch(acUrl, { method: 'GET' });
  const acData: any = await acResp.json();
  const items: any[] = Array.isArray(acData?.autocomplete) ? acData.autocomplete : [];
  const addr = items.find(x => x?.area_type === 'address') || items[0];
  if (!addr) {
    console.log('No autocomplete match. Raw:', JSON.stringify(acData).slice(0, 500));
    return;
  }
  const propertyId = addr?.mpr_id || addr?.property_id;
  if (!propertyId) {
    console.log('No property_id/mpr_id on autocomplete match:', addr);
    return;
  }
  console.log(`Detail for property_id: ${propertyId}`);
  const detUrl = `https://realty-in-us.p.rapidapi.com/properties/v3/detail?property_id=${encodeURIComponent(propertyId)}`;
  const detResp = await loggedFetch(detUrl, { method: 'GET' });
  const detData: any = await detResp.json();
  const desc = detData?.data?.home?.description || {};
  const addrLine = detData?.data?.home?.location?.address?.line || 'N/A';
  const baths = {
    baths: desc.baths,
    baths_full: desc.baths_full,
    baths_half: desc.baths_half,
    baths_full_calc: desc.baths_full_calc,
    baths_partial_calc: desc.baths_partial_calc,
    baths_consolidated: (desc as any).baths_consolidated,
  };
  console.log(`Address: ${addrLine}`);
  console.log('Raw bath fields:', baths);
  const full = Number(desc.baths_full_calc ?? desc.baths_full);
  const half = Number(desc.baths_partial_calc ?? desc.baths_half);
  let computed: number | null = null;
  if (Number.isFinite(full) || Number.isFinite(half)) {
    computed = (Number.isFinite(full) ? full : 0) + (Number.isFinite(half) ? 0.5 * half : 0);
  }
  console.log(`Computed baths (full + 0.5*half): ${computed ?? 'N/A'}`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
