import 'dotenv/config';
import fs from 'fs';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';
import { ARVCalculationService } from '../server/step4-arv-calculation.js';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

type CachedComp = { address: string; price: number; soldDate: string; beds: number; baths: number; sqft: number; yearBuilt: number | null; source: string };

function readCache(path: string): CachedComp[] {
  if (!fs.existsSync(path)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(path, 'utf-8'));
    return Array.isArray(j?.comps) ? j.comps as CachedComp[] : [];
  } catch { return []; }
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const subdivisionComps = readCache('testing/profile-subdivision.json');
  const expandedComps = readCache('testing/profile-expanded.json');
  if (subdivisionComps.length === 0 && expandedComps.length === 0) {
    console.error('No cache found. Run STEP=3 and STEP=4 first.');
    process.exit(1);
  }

  // Aggregate uniques by address
  const map = new Map<string, CachedComp>();
  [...subdivisionComps, ...expandedComps].forEach(c => map.set(c.address, c));
  const raw = Array.from(map.values());
  console.log(`Aggregated ${raw.length} unique comps from cache`);

  // Convert to ComparableProperty shape (distance unknown yet)
  const comps = raw.map(c => ({
    address: c.address,
    price: Number(c.price),
    sqft: Number(c.sqft),
    beds: Number(c.beds),
    baths: Number(c.baths),
    yearBuilt: c.yearBuilt as number | null,
    soldDate: c.soldDate || '',
    distance: NaN as any,
    source: c.source || 'Vertex AI',
    confidence: 'medium',
  }));

  // Apply PPSF variance filter using service helper
  const svc = new VertexComparableSearchService() as any;
  const filtered = svc.filterByPPSFVariance(comps);
  console.log(`After PPSF variance filter: ${filtered.length} comps`);

  // Subject details
  const det = await fetchPropertyDetailsViaVertex(address);
  const subjectSqft = det?.sqft || 2331;
  const subjectBaths = det?.baths ?? 2.5;
  console.log(`Subject: ${subjectSqft} sqft, baths=${subjectBaths}`);

  // ARV calculation
  const arvSvc = new ARVCalculationService();
  const result = arvSvc.calculateARV(filtered, subjectSqft, subjectBaths);
  console.log('\n=== ARV RESULT ===');
  console.log(`ARV: $${result.arv.toLocaleString()} (${result.method})`);
  console.log(`Confidence: ${result.confidence}`);
}

main().catch(err => { console.error('ARV run failed:', err?.message || err); process.exit(1); });

