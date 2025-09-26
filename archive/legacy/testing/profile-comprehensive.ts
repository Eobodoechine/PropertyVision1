import 'dotenv/config';
import fs from 'fs';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';
import { getServiceAccountToken } from './vertex-bakeoff-shared.js';
import { groundedFreeform } from '../server/vertex-freeform.js';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

function ms(s: number) { return `${s.toFixed(0)}ms`; }

type SimpleComp = { address: string; price: number; soldDate: string; beds: number; baths: number; sqft: number; yearBuilt: number | null; source: string };

function writeCache(path: string, comps: SimpleComp[]) {
  try {
    fs.writeFileSync(path, JSON.stringify({ comps }, null, 2));
  } catch {}
}

function readCache(path: string): SimpleComp[] | null {
  try {
    if (fs.existsSync(path)) {
      const j = JSON.parse(fs.readFileSync(path, 'utf-8'));
      if (Array.isArray(j?.comps)) return j.comps as SimpleComp[];
    }
  } catch {}
  return null;
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const STEP = process.env.STEP || '';
  const service = new VertexComparableSearchService() as any;

  // Get subject coords
  const geoStart = Date.now();
  const coords = await service.geocodeWithTimeout(address, 10000);
  const geoDur = Date.now() - geoStart;
  if (!coords) throw new Error('failed geocoding subject');
  if (STEP === '1') {
    console.log(`Step 1 — Subject geocode/time: ${ms(geoDur)}`);
    console.log(`Coords: ${coords.lat}, ${coords.lon}`);
    return;
  }

  // Subject details for constraints
  const detStart = Date.now();
  const details = await fetchPropertyDetailsViaVertex(address);
  const detDur = Date.now() - detStart;
  const subjectDetails = details && details.sqft && details.beds && details.baths && details.yearBuilt
    ? { sqft: details.sqft, beds: details.beds, baths: details.baths, yearBuilt: details.yearBuilt } : undefined;
  if (STEP === '2') {
    console.log(`Step 2 — Property details/time: ${ms(detDur)}`);
    console.log(`Details: sqft=${details?.sqft}, beds=${details?.beds}, baths=${details?.baths}, year=${details?.yearBuilt}, subdivision=${details?.subdivision || ''}`);
    return;
  }

  // Token for grounded calls
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON missing');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  // Analyst-style pipe prompt like in service
  function composeAnalystPipePrompt(withSubdivision: boolean, radius: number, months: number) {
    const sd = subjectDetails || null;
    const subjBeds = sd?.beds ?? undefined;
    const subjBaths = sd?.baths ?? undefined;
    const subjSqft = sd?.sqft ?? undefined;
    const subjYear = sd?.yearBuilt ?? undefined;
    const lowSqft = subjSqft ? Math.round(subjSqft * 0.8) : '±20% lower bound';
    const highSqft = subjSqft ? Math.round(subjSqft * 1.2) : '±20% upper bound';
    const lowYear = subjYear ? subjYear - 10 : 'subject-10';
    const highYear = subjYear ? subjYear + 10 : 'subject+10';
    const subdivision = details?.subdivision || '';
    return `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below.
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${address}
${subjBeds != null ? `- Beds: ${subjBeds}\n` : ''}${subjBaths != null ? `- Baths: ${subjBaths}\n` : ''}${subjSqft != null ? `- Square Footage: ${subjSqft} sqft\n` : ''}${subjYear != null ? `- Year Built: ${subjYear}\n` : ''}${withSubdivision && subdivision ? `- Subdivision: ${subdivision}\n` : ''}
COMPARABLE SELECTION CRITERIA:
1. Location: Within ${radius} miles of the subject property.
2. Sale Date: Sold within the last ${months} months.
3. Size: Between ~${lowSqft} sqft and ~${highSqft} sqft (±20% of subject).
4. Bedrooms: ${subjBeds != null ? `${Math.max(1, subjBeds - 1)}–${subjBeds + 1}` : '±1 of subject'} bedrooms.
5. Bathrooms: ${subjBaths != null ? `${Math.max(1, Math.floor(subjBaths - 1))}–${Math.ceil(subjBaths + 1)}` : '±1 of subject'} bathrooms.
6. Year Built: Between ${lowYear} and ${highYear} (within ±10 years of subject’s build year).

OUTPUT FORMAT (STRICT):
Return ONLY pipe-separated lines, one per property, no commentary, no headers:
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
  }

  async function runCall(label: string, withSubdivision: boolean, radius: number, months: number) {
    const prompt = composeAnalystPipePrompt(withSubdivision, radius, months);
    const t0 = Date.now();
    const res = await groundedFreeform({ accessToken: token, projectId, location, model, prompt, maxOutputTokens: 2500 });
    const t1 = Date.now();
    const parsedStart = Date.now();
    const parsed = await service.parseVertexResponse(res.text, coords.lat, coords.lon, subjectDetails);
    const parsedDur = Date.now() - parsedStart;
    console.log(`Step ${label} — LLM: ${ms(t1 - t0)}, parse: ${ms(parsedDur)}, comps: ${parsed.length}`);
    return parsed;
  }

  // Subdivision runs (3)
  const tSubStart = Date.now();
  if (STEP === '3') {
    console.log('🚀 Running Subdivision 3 runs in parallel...');
    const [a, b, c] = await Promise.all([
      runCall('Subdivision A', true, 3, 18),
      runCall('Subdivision B', true, 3, 18),
      runCall('Subdivision C', true, 3, 18),
    ]);
    const tPar = Date.now() - tSubStart;
    console.log(`Subdivision parallel total: ${ms(tPar)}`);
    // Unique by address preserving last seen record
    const map = new Map<string, SimpleComp>();
    [...a, ...b, ...c].forEach((x: any) => {
      const soldDate = x.soldDate || '';
      map.set(x.address, { address: x.address, price: x.price, soldDate, beds: x.beds, baths: x.baths, sqft: x.sqft, yearBuilt: x.yearBuilt, source: x.source });
    });
    const uni = Array.from(map.values());
    console.log('Addresses (unique):');
    uni.forEach((rec) => console.log(rec.address));
    writeCache('testing/profile-subdivision.json', uni);
    return;
  }
  // If not profiling subdivision only, run sequentially to keep variables for next steps
  const sub1 = await runCall('Subdivision 1/3', true, 3, 18);
  const sub2 = await runCall('Subdivision 2/3', true, 3, 18);
  const sub3 = await runCall('Subdivision 3/3', true, 3, 18);
  const tSubDur = Date.now() - tSubStart;

  // Expanded runs (3)
  const tExpStart = Date.now();
  if (STEP === '4') {
    console.log('🚀 Running Expanded 3 runs in parallel...');
    const [a, b, c] = await Promise.all([
      runCall('Expanded A', false, 3, 18),
      runCall('Expanded B', false, 3, 18),
      runCall('Expanded C', false, 3, 18),
    ]);
    const tPar = Date.now() - tExpStart;
    console.log(`Expanded parallel total: ${ms(tPar)}`);
    const map = new Map<string, SimpleComp>();
    [...a, ...b, ...c].forEach((x: any) => {
      const soldDate = x.soldDate || '';
      map.set(x.address, { address: x.address, price: x.price, soldDate, beds: x.beds, baths: x.baths, sqft: x.sqft, yearBuilt: x.yearBuilt, source: x.source });
    });
    const uni = Array.from(map.values());
    console.log('Addresses (unique):');
    uni.forEach((rec) => console.log(rec.address));
    writeCache('testing/profile-expanded.json', uni);
    return;
  }
  const exp1 = await runCall('Expanded 1/3', false, 3, 18);
  const exp2 = await runCall('Expanded 2/3', false, 3, 18);
  const exp3 = await runCall('Expanded 3/3', false, 3, 18);
  const tExpDur = Date.now() - tExpStart;

  // Aggregate unique by address
  // Step 5: aggregate uniques; allow cached comps to avoid re-running heavy steps
  let comps: any[] = [];
  const aggStart = Date.now();
  if (STEP === '5') {
    const subCache = readCache('testing/profile-subdivision.json') || [];
    const expCache = readCache('testing/profile-expanded.json') || [];
    const map = new Map<string, SimpleComp>();
    [...subCache, ...expCache].forEach(rec => { map.set(rec.address, rec); });
    const uni = Array.from(map.values());
    const aggDur = Date.now() - aggStart;
    console.log(`Aggregated unique (${uni.length}) in ${ms(aggDur)}`);
    uni.forEach((rec) => console.log(rec.address));
    return;
  }
  const map = new Map<string, any>();
  [...sub1, ...sub2, ...sub3, ...exp1, ...exp2, ...exp3].forEach(c => { if (!map.has(c.address)) map.set(c.address, c); });
  comps = Array.from(map.values());
  const aggDur = Date.now() - aggStart;

  // Dedup is already done; apply PPSF variance filtering
  const varStart = Date.now();
  comps = service.filterByPPSFVariance(comps);
  const varDur = Date.now() - varStart;
  if (STEP === '6') {
    console.log(`After PPSF variance filter (${comps.length}) in ${ms(varDur)}`);
    comps.forEach((c: any) => console.log(c.address));
    return;
  }

  // Enrichment (measure even if most have full data)
  const enrStart = Date.now();
  const enriched = await service.enrichAndRevalidate(comps, subjectDetails);
  const enrDur = Date.now() - enrStart;
  if (STEP === '7') {
    console.log(`After enrichment (${enriched.length}) in ${ms(enrDur)}`);
    enriched.forEach((c: any) => console.log(c.address));
    return;
  }

  // Geocoding
  const geoCompStart = Date.now();
  const geoed = await service.geocodeAndFilterDistance(enriched, coords.lat, coords.lon, 1.0, 2.0);
  const geoCompDur = Date.now() - geoCompStart;
  if (STEP === '8') {
    console.log(`After geocoding (${geoed.length}) in ${ms(geoCompDur)}`);
    geoed.forEach((c: any) => console.log(`${c.address} | ${Number.isFinite(c.distance) ? c.distance.toFixed(2) : 'N/A'} mi`));
    try {
      const payload = geoed.map((c: any) => ({ address: c.address, price: c.price, soldDate: c.soldDate, beds: c.beds, baths: c.baths, sqft: c.sqft, yearBuilt: c.yearBuilt, distance: c.distance, source: c.source }));
      fs.writeFileSync('testing/profile-final.json', JSON.stringify({ comps: payload }, null, 2));
      console.log('💾 Wrote final comps cache: testing/profile-final.json');
    } catch {}
    return;
  }

  // Sorting & final selection
  const sortStart = Date.now();
  geoed.sort((a: any, b: any) => {
    const af = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
    const bf = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
    return af - bf;
  });
  const final = geoed.slice(0, 10);
  const sortDur = Date.now() - sortStart;

  console.log(`\nTimings:`);
  console.log(`Subject geocode: ${ms(geoDur)}, details: ${ms(detDur)}`);
  console.log(`Subdivision runs total: ${ms(tSubDur)}`);
  console.log(`Expanded runs total:   ${ms(tExpDur)}`);
  console.log(`Aggregate unique:      ${ms(aggDur)}`);
  console.log(`PPSF variance filter:  ${ms(varDur)}`);
  console.log(`Enrichment:            ${ms(enrDur)} (ENRICH_CONCURRENCY=${process.env.ENRICH_CONCURRENCY || '4'})`);
  console.log(`Geocoding:             ${ms(geoCompDur)} (GEOCODE_CONCURRENCY=${process.env.GEOCODE_CONCURRENCY || '6'})`);
  console.log(`Sort + finalize:       ${ms(sortDur)}`);

  console.log(`\nFinal comps (${final.length}):`);
  final.forEach((c: any, i: number) => {
    const dist = Number.isFinite(c.distance) ? `${c.distance.toFixed(2)} mi` : 'N/A';
    console.log(`${i + 1}. ${c.address} | $${c.price.toLocaleString()} | ${c.soldDate} | ${c.sqft} sqft | ${c.beds}/${c.baths} | ${c.yearBuilt} | ${dist}`);
  });
  try {
    const payload = final.map((c: any) => ({ address: c.address, price: c.price, soldDate: c.soldDate, beds: c.beds, baths: c.baths, sqft: c.sqft, yearBuilt: c.yearBuilt, distance: c.distance, source: c.source }));
    fs.writeFileSync('testing/profile-final.json', JSON.stringify({ comps: payload }, null, 2));
    console.log('💾 Wrote final comps cache: testing/profile-final.json');
  } catch {}
}

main().catch(err => { console.error('Profile failed:', err?.message || err); process.exit(1); });
