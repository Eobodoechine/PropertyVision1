import type { ComparableProperty } from "../../shared/types";
import { ARVCalculationService } from "../step4-arv-calculation";

export function deriveOutlierSets(
  arvService: ARVCalculationService,
  comps: ComparableProperty[],
  subjectSqft: number
): {
  glaBucketed: ComparableProperty[];
  keptForARV: ComparableProperty[];
  excluded: Array<ComparableProperty & { reasonFlags: string[] }>;
} {
  const valid = comps.filter(c => isFinite(c.price) && c.price > 0 && isFinite(c.sqft) && c.sqft > 0);

  // Access private methods through type assertion
  const service = arvService as any;
  let gla = service.applyGLABucketing(valid, subjectSqft) as ComparableProperty[];
  if (!gla.length) gla = service.applyExpandedGLABucketing(valid, subjectSqft);

  const kept = gla.length >= 8
    ? service.modeALargeSampleOutlierDetection(gla)
    : service.modeBSmallSampleOutlierDetection(gla);

  const keptSet = new Set(kept.map(c => c.address));
  const glaSet = new Set(gla.map(c => c.address));

  const km = kept.map(c => c.price / c.sqft).filter(Number.isFinite).sort((a,b)=>a-b);
  const median = km.length ? service.calculatePercentile(km, 50) : NaN;

  const excluded = valid.filter(c => !keptSet.has(c.address)).map(c => {
    const flags: string[] = [];
    if (!glaSet.has(c.address)) flags.push("outside_gla_bucket");
    else flags.push(gla.length >= 8 ? "outlier_screen_modeA" : "outlier_screen_modeB");

    const ppsf = c.price / c.sqft;
    if (isFinite(median)) {
      if (ppsf < 0.75 * median) flags.push("low_outlier");
      else if (ppsf > 1.45 * median) flags.push("high_outlier");
    }
    return { ...c, reasonFlags: flags };
  });

  return { glaBucketed: gla, keptForARV: kept, excluded };
}
