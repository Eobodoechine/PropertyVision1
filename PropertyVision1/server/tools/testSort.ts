import 'dotenv/config';
import { loadAppEnv } from '../utils/envLoader';
import { loggedFetch } from '../infra/rapid';

async function run() {
  loadAppEnv();
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY missing');

  const lat = 36.053895;
  const lon = -114.960119;
  const deg = 2 * 0.0145; // 2 miles in degrees
  const boundary = [
    [lon - deg, lat - deg],
    [lon + deg, lat - deg],
    [lon + deg, lat + deg],
    [lon - deg, lat + deg],
    [lon - deg, lat - deg],
  ];

  const base: any = {
    limit: 50,
    offset: 0,
    boundary: { coordinates: [boundary] },
    status: ['sold'],
    type: ['single_family'],
  };

  const variants: Record<string, any> = {
    nosort: { ...base },
    // sold_date sorting variants
    sort1: { ...base, sort: 'sold_date', order: 'desc' },
    sort2: { ...base, sort: { field: 'sold_date', direction: 'desc' } },
    sort3: { ...base, sort: [{ field: 'sold_date', direction: 'desc' }] },
    // price sorting variants
    price1: { ...base, sort: { field: 'last_sold_price', direction: 'desc' } },
    price2: { ...base, sort: { field: 'price', direction: 'desc' } },
  };

  for (const [name, payload] of Object.entries(variants)) {
    let ok = false;
    let status = 0;
    try {
      const res = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      status = res.status;
      ok = res.ok;
      const json: any = ok ? await res.json() : null;
      const results: any[] = json?.data?.home_search?.results || [];
      const top = results.slice(0, 5).map((r) => ({
        address: r?.location?.address?.line,
        sold: r?.last_sold_date,
        price: r?.last_sold_price,
      }));
      console.log(JSON.stringify({ name, status, ok, count: results.length, top }, null, 2));
    } catch (err) {
      console.log(JSON.stringify({ name, status, ok, error: String((err as any)?.message || err) }));
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
