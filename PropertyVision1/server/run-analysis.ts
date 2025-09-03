// Polyfill minimal File global for Node <20 when some deps expect it
// Safe no-op class to satisfy undici/web IDL in older Node environments
// @ts-ignore
if (!(globalThis as any).File) {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  (globalThis as any).File = class {};
}

import 'dotenv/config';
import { storage } from './storage';

// Helper to compute baths similar to server logic
function computeBathsCompat(desc: any): number | null {
  if (!desc) return null;
  const baths = Number(desc.baths);
  if (Number.isFinite(baths) && baths > 0) return baths;
  const fullCalc = Number(desc.baths_full_calc);
  const halfCalc = Number(desc.baths_partial_calc);
  const full = Number(desc.baths_full);
  const half = Number(desc.baths_half);
  let total = 0;
  if (Number.isFinite(fullCalc)) total += fullCalc;
  else if (Number.isFinite(full)) total += full;
  if (Number.isFinite(halfCalc)) total += 0.5 * halfCalc;
  else if (Number.isFinite(half)) total += 0.5 * half;
  return total > 0 ? total : null;
}

async function main() {
  const address = process.env.ADDRESS;
  if (!address || address.trim().length < 10) {
    console.error('ADDRESS env var is required (full street, city, state, ZIP).');
    process.exit(1);
  }
  if (!process.env.RAPIDAPI_KEY) {
    console.error('RAPIDAPI_KEY env var is required.');
    process.exit(1);
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.error('GOOGLE_MAPS_API_KEY env var is required.');
    process.exit(1);
  }

  console.log(`Analyzing: ${address}`);
  // Monkey-patch calculateNewMethodologyARV to compute an alternate baseline
  const sAny: any = storage as any;
  const originalCalc = sAny.calculateNewMethodologyARV?.bind(sAny);
  let altBaseline: { ppsf: number; arv: number; count: number } | null = null;
  if (typeof originalCalc === 'function') {
    sAny.calculateNewMethodologyARV = async (
      validComps: any[],
      subjectSqft: number,
      normalizedAddress: string,
      subjectProperty: any,
      researchCandidates: any[],
      centerLat: number,
      centerLon: number,
      finalYearBuilt: number | null
    ) => {
      try {
        const sb = computeBathsCompat(subjectProperty.description);
        const subjectBaths = (sb ?? parseFloat(subjectProperty.description?.baths?.toString() || '0')) || 0;
        const epsilon = 1e-9;
        const subset = validComps.filter((c: any) => {
          const b = parseFloat(c.baths?.toString() || 'NaN');
          return Number.isFinite(b) && b <= subjectBaths + epsilon && Number.isFinite(Number(c.pricePerSqft));
        });
        // Outlier detection on subset
        const items = subset.map((c: any, idx: number) => ({ price: Number(c.pricePerSqft), idx, c }))
          .filter((it: any) => it.price && it.price > 0)
          .sort((a: any, b: any) => a.price - b.price);
        if (items.length >= 1) {
          const q1Index = Math.floor(items.length * 0.25);
          const q3Index = Math.floor(items.length * 0.75);
          const q1 = items[q1Index]?.price || items[0].price;
          const q3 = items[q3Index]?.price || items[items.length - 1].price;
          const iqr = q3 - q1;
          const lb = Math.max(q1 - 0.75 * iqr, 120);
          const ub = Math.min(q3 + 0.75 * iqr, 300);
          const used = items.filter((it: any) => it.price >= lb && it.price <= ub).map((it: any) => it.price);
          used.sort((a: number, b: number) => a - b);
          const med = used.length ? used[Math.floor(used.length / 2)] : items[Math.floor(items.length / 2)].price;
          altBaseline = { ppsf: med, arv: Math.round(med * subjectSqft), count: used.length || items.length };
        }
      } catch {}
      return await originalCalc(
        validComps,
        subjectSqft,
        normalizedAddress,
        subjectProperty,
        researchCandidates,
        centerLat,
        centerLon,
        finalYearBuilt
      );
    };
  }

  const res: any = await storage.analyzeProperty({ address });
  const baseArv = res?.arv ? Number(res.arv) : NaN;
  const basePpsf = res?.pricePerSqFt ? Number(res.pricePerSqFt) : NaN;
  const twoBathArv = res?.arvWith2ndBathroom?.estimate ? Number(res.arvWith2ndBathroom.estimate) : null;
  const twoBathPpsf = res?.arvWith2ndBathroom?.pricePerSqFt ? Number(res.arvWith2ndBathroom.pricePerSqFt) : null;

  console.log('\n=== RESULT SUMMARY ===');
  console.log(`Baseline ARV: $${Number.isFinite(baseArv) ? baseArv.toLocaleString() : 'N/A'} ($${Number.isFinite(basePpsf) ? basePpsf.toFixed(0) : 'N/A'}/sqft)`);
  if (twoBathArv != null) {
    console.log(`2-Bath ARV:   $${twoBathArv.toLocaleString()} ($${twoBathPpsf != null ? twoBathPpsf.toFixed(0) : 'N/A'}/sqft)`);
  } else {
    console.log('2-Bath ARV:   N/A (not applicable)');
  }
  if (altBaseline) {
    console.log(`\nAlt Baseline (bath ≤ subject): $${altBaseline.arv.toLocaleString()} ($${altBaseline.ppsf.toFixed(0)}/sqft, ${altBaseline.count} comps used)`);
  } else {
    console.log(`\nAlt Baseline (bath ≤ subject): not computed`);
  }
}

main().catch(err => {
  console.error('Run failed:', err);
  process.exit(1);
});
