import 'dotenv/config';
import fs from 'fs';
import { ARVCalculationService } from '../server/step4-arv-calculation.js';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

type FinalComp = { address: string; price: number; soldDate: string; beds: number; baths: number; sqft: number; yearBuilt: number | null; distance: number; source: string };

function readFinal(): FinalComp[] {
  const path = 'testing/profile-final.json';
  if (!fs.existsSync(path)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(path, 'utf-8'));
    return Array.isArray(j?.comps) ? j.comps as FinalComp[] : [];
  } catch { return []; }
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const comps = readFinal();
  if (comps.length === 0) {
    console.error('No final comps cache found. Run STEP=8 to write testing/profile-final.json');
    process.exit(1);
  }
  console.log(`Loaded ${comps.length} final comps (with distances)`);

  // Subject details
  const det = await fetchPropertyDetailsViaVertex(address);
  const subjectSqft = det?.sqft || 2331;
  const subjectBaths = det?.baths ?? 2.5;
  console.log(`Subject: ${subjectSqft} sqft, baths=${subjectBaths}`);

  // Filter to those within 2.0 miles just to be safe
  const inRange = comps.filter(c => Number.isFinite(c.distance) ? c.distance <= 2.0 : true);
  console.log(`Using ${inRange.length} comps within 2.0 miles (or unknown distance)`);

  const arvSvc = new ARVCalculationService();
  const result = arvSvc.calculateARV(
    inRange.map(c => ({
      address: c.address,
      price: Number(c.price),
      sqft: Number(c.sqft),
      beds: Number(c.beds),
      baths: Number(c.baths),
      yearBuilt: c.yearBuilt as number | null,
      soldDate: c.soldDate,
      distance: Number(c.distance),
      source: c.source,
      confidence: 'medium',
    })) as any,
    subjectSqft,
    subjectBaths
  );

  console.log('\n=== ARV RESULT (from final comps cache) ===');
  console.log(`ARV: $${result.arv.toLocaleString()} (${result.method})`);
  console.log(`Confidence: ${result.confidence}`);
}

main().catch(err => { console.error('ARV run failed:', err?.message || err); process.exit(1); });

