import { ANALYZER_VERSION } from "./utils/version";
import type { ComparableProperty, ARVResult } from "../shared/types";

export class ARVCalculationService {
  // ===== Public entry =====

  calculateARV(comps: ComparableProperty[], subjectSqft: number): ARVResult {
    if (!comps.length || !isFinite(subjectSqft) || subjectSqft <= 0) {
      return {
        arv: 0,
        method: "invalid_input",
        dataPoints: 0,
        confidence: "low",
        coreComps: [],
        version: ANALYZER_VERSION
      };
    }

    // Outliers → GLA bucket → Mode A/B
    const filtered = this.detectAndFilterOutliers(comps, subjectSqft);
    const used = filtered.length ? filtered : comps;
    const forcedLow = !filtered.length;

    // Select 2–3 core comps (the ones that actually drive ARV)
    const subjectBaths = 1; // wire real subject baths later
    const core = this.selectTopKForARV(used, subjectSqft, 3, subjectBaths);
    if (!core.length) {
      return {
        arv: 0,
        method: "no_core_comps",
        dataPoints: 0,
        confidence: "low",
        coreComps: [],
        version: ANALYZER_VERSION
      };
    }

    // Build indications, applying bath penalty on the indication (not the sale price)
    const has2Bath = core.some(c => (c.baths ?? 0) >= 2);
    const premium = has2Bath && subjectBaths === 1
      ? this.estimateSecondBathPremium(subjectSqft, core)
      : null;

    const dataPoints = core.map(c => {
      const ppsf = c.price / c.sqft;
      const baseInd = ppsf * subjectSqft;
      const indication = (premium && (c.baths ?? 0) >= 2)
        ? this.applyBathPenaltyToIndication(subjectSqft, subjectBaths, c, premium)
        : baseInd;
      return { x: subjectSqft, y: indication, address: c.address, ppsf, score: (c as any).score ?? 0 };
    });

    // Reconcile indications → ARV point+range+confidence
    const res = this.calculateARVFromComps(
      dataPoints.map(d => ({ x: d.x, y: d.y, address: d.address })),
      subjectSqft
    );
    res.coreComps = dataPoints.map(d => ({
      address: d.address,
      ppsf: d.ppsf,
      indication: d.y,
      score: d.score
    }));
    res.dataPoints = dataPoints.length;
    res.version = ANALYZER_VERSION;
    if (forcedLow) {
      res.confidence = "low";
      res.method = `${res.method}+fallback`;
    }
    return res;
  }

  // ===== Outliers (wrapper) =====

  private detectAndFilterOutliers(comps: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    const valid = comps.filter(c => isFinite(c.price) && c.price > 0 && isFinite(c.sqft) && c.sqft > 0);
    if (valid.length < 3) return valid;

    let bucket = this.applyGLABucketing(valid, subjectSqft);
    if (!bucket.length) bucket = this.applyExpandedGLABucketing(valid, subjectSqft);

    return bucket.length >= 8
      ? this.modeALargeSampleOutlierDetection(bucket)
      : this.modeBSmallSampleOutlierDetection(bucket);
  }

  // ===== GLA Bucketing =====

  private applyGLABucketing(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    if (!isFinite(subjectSqft) || subjectSqft <= 0) return [];
    let min: number, max: number;
    if (subjectSqft < 800) { min = subjectSqft - 150; max = subjectSqft + 150; }
    else if (subjectSqft > 3000) { const m = Math.round(subjectSqft * 0.10); min = subjectSqft - m; max = subjectSqft + m; }
    else { const m = Math.round(subjectSqft * 0.10); min = subjectSqft - m; max = subjectSqft + m; }
    return comparables.filter(c => isFinite(c.sqft) && c.sqft > 0 && c.sqft >= min && c.sqft <= max);
  }

  private applyExpandedGLABucketing(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    if (!isFinite(subjectSqft) || subjectSqft <= 0) return [];
    const r = subjectSqft * 0.20; // ±20%
    const min = subjectSqft - r, max = subjectSqft + r;
    return comparables.filter(c => isFinite(c.sqft) && c.sqft > 0 && c.sqft >= min && c.sqft <= max);
  }

  // ===== Mode A (n≥8): robust two-sided on log-PPSF =====

  private modeALargeSampleOutlierDetection(comps: ComparableProperty[]): ComparableProperty[] {
    const rows = comps.map(c => ({ comp: c, ppsf: c.price / c.sqft }))
                      .filter(r => isFinite(r.ppsf) && r.ppsf > 0)
                      .map(r => ({ ...r, log: Math.log(r.ppsf) }));
    if (rows.length < 3) return comps;

    const logVals = rows.map(r => r.log).sort((a,b)=>a-b);
    const med = this.calculatePercentile(logVals, 50);
    const absDevs = rows.map(r => Math.abs(r.log - med)).sort((a,b)=>a-b);
    const mad = this.calculatePercentile(absDevs, 50);
    const sigma = mad * 1.4826;

    let kept = rows, dropL: typeof rows = [], dropH: typeof rows = [];
    if (sigma > 0) {
      const zLow = -2.5, zHigh = 3.0; // strong low-tail, conservative high-tail
      kept = [];
      for (const r of rows) {
        const z = (r.log - med) / sigma;
        if (z < zLow) dropL.push(r);
        else if (z > zHigh) dropH.push(r);
        else kept.push(r);
      }
    } else {
      // Tight cluster → Tukey fallback on log-PPSF
      const q1 = this.calculatePercentile(logVals, 25);
      const q3 = this.calculatePercentile(logVals, 75);
      const iqr = q3 - q1;
      const lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
      kept = [];
      for (const r of rows) {
        if (r.log < lowFence) dropL.push(r);
        else if (r.log > highFence) dropH.push(r);
        else kept.push(r);
      }
    }
    return kept.map(k => k.comp);
  }

  // ===== Mode B (n<8): median-ratio + K=2 on log-PPSF, keep≥3 =====

  private modeBSmallSampleOutlierDetection(comps: ComparableProperty[]): ComparableProperty[] {
    const rows = comps.map(c => ({ comp: c, ppsf: c.price / c.sqft }))
                      .filter(r => isFinite(r.ppsf) && r.ppsf > 0)
                      .sort((a,b)=>a.ppsf-b.ppsf);
    if (rows.length < 3) return comps;

    const vals = rows.map(r => r.ppsf);
    const med = this.calculatePercentile([...vals], 50);
    const low = vals[0], high = vals[vals.length-1];
    const spread = high / Math.max(med, 1e-9);

    let tLow = 0.75, tHigh = 1.45;
    if (spread >= 1.30) { tLow = 0.70; tHigh = 1.60; }

    // First pass: median-ratio votes
    const votes = new Map<ComparableProperty, number>();
    for (const r of rows) {
      const ratio = r.ppsf / Math.max(med, 1e-9);
      const v = (ratio < tLow || ratio > tHigh) ? 1 : 0;
      votes.set(r.comp, v);
    }

    // Second pass: K=2 on log-PPSF (singleton cluster gets extra vote)
    const logs = vals.map(Math.log);
    let c1 = Math.min(...logs), c2 = Math.max(...logs);
    for (let it=0; it<8; it++) {
      const lab = logs.map(v => Math.abs(v - c1) <= Math.abs(v - c2) ? 0 : 1);
      const n0 = lab.filter(l=>l===0).length, n1 = logs.length - n0;
      const m0 = n0 ? logs.reduce((s,v,i)=>s + (lab[i]===0 ? v : 0), 0)/n0 : c1;
      const m1 = n1 ? logs.reduce((s,v,i)=>s + (lab[i]===1 ? v : 0), 0)/n1 : c2;
      c1 = m0; c2 = m1;
    }
    const labels = logs.map(v => Math.abs(v - c1) <= Math.abs(v - c2) ? 0 : 1);
    const size0 = labels.filter(l=>l===0).length, size1 = labels.length - size0;
    if (size0 === 1 || size1 === 1) {
      const idx = labels.findIndex(l => (size0 === 1 ? l === 0 : l === 1));
      const singleton = rows[idx].comp;
      votes.set(singleton, (votes.get(singleton) ?? 0) + 1);
    }

    // Drop if votes ≥2; guarantee ≥3 kept (restore by closest to median)
    const withVotes = rows.map(r => ({...r, v: votes.get(r.comp) ?? 0, dist: Math.abs(r.ppsf - med)}));
    let kept = withVotes.filter(r => r.v < 2);
    let dropped = withVotes.filter(r => r.v >= 2);
    if (kept.length < 3) {
      const need = 3 - kept.length;
      const restore = dropped.sort((a,b)=>a.dist-b.dist).slice(0, need);
      kept.push(...restore);
    }
    return kept.map(k => k.comp);
  }

  // ===== ARV from indications (point + range + confidence) =====

  private calculateARVFromComps(
    dataPoints: Array<{ x: number; y: number; address: string }>,
    _subjectSqft: number
  ): ARVResult {
    const rows = dataPoints
      .filter(dp => isFinite(dp.y) && dp.y > 0)
      .map(dp => dp.y)
      .sort((a,b)=>a-b);

    if (!rows.length) {
      return {
        arv: 0, low: 0, high: 0,
        method: "no_indications",
        dataPoints: 0,
        confidence: "low",
        coreComps: []
      };
    }

    const n = rows.length;
    const median = (a:number[]) => a.length%2 ? a[(a.length-1)>>1] : (a[a.length>>1]+a[(a.length>>1)-1])/2;

    let point:number, method:string;
    if (n===1) { point = rows[0]; method = "single_indication"; }
    else if (n===2) { point = (rows[0]+rows[1])/2; method = "mean_of_two"; }
    else if (n===3) { point = median(rows); method = "median_of_three"; }
    else { const trimmed = rows.slice(1, rows.length-1); point = trimmed.reduce((s,v)=>s+v,0)/trimmed.length; method = "trimmed_mean"; }

    let low:number, high:number;
    if (n<=3) { low = rows[0]; high = rows[rows.length-1]; }
    else {
      const p25 = this.calculatePercentile(rows, 25);
      const p75 = this.calculatePercentile(rows, 75);
      low = Math.min(p25, point);
      high = Math.max(p75, point);
    }

    let confidence:"high"|"medium"|"low";
    if (n>=3) {
      const med = this.calculatePercentile(rows,50), p25=this.calculatePercentile(rows,25), p75=this.calculatePercentile(rows,75);
      const disp = Math.abs(p75 - p25) / Math.max(Math.abs(med), 1e-9);
      confidence = disp <= 0.10 ? "high" : disp <= 0.20 ? "medium" : "low";
    } else {
      const spread = rows[rows.length-1] / Math.max(rows[0], 1e-9);
      confidence = spread <= 1.10 ? "high" : spread <= 1.25 ? "medium" : "low";
    }

    return { arv: point, low, high, method, dataPoints: n, confidence, coreComps: [] };
  }

  // ===== Pipeline + Escalation =====

  private applyCompleteAnalysisPipeline(
    comps: ComparableProperty[],
    subjectSqft: number,
    opts?: { preBucketed?: boolean }
  ): ComparableProperty[] {
    let set = comps.filter(c => isFinite(c.price) && c.price > 0 && isFinite(c.sqft) && c.sqft > 0);
    if (!opts?.preBucketed) set = this.applyGLABucketing(set, subjectSqft);
    if (set.length < 3) return set;
    return set.length >= 8 ? this.modeALargeSampleOutlierDetection(set)
                           : this.modeBSmallSampleOutlierDetection(set);
  }

  private applyComplexEscalation(
    original: ComparableProperty[],
    subjectSqft: number,
    step: number = 1
  ): ComparableProperty[] {
    const valid = original.filter(c => isFinite(c.price) && c.price > 0 && isFinite(c.sqft) && c.sqft > 0);
    let current = valid;

    if (step === 1) return this.applyComplexEscalation(valid, subjectSqft, 2); // time expansion = re-search (external)
    if (step === 2) current = this.applyExpandedGLABucketing(valid, subjectSqft);
    if (step === 3) current = current; // allow 2-bath comps; penalty happens on indication
    if (step >= 4) return valid;       // distance/municipality = re-search (external)

    if (current.length >= 3) {
      const re = this.applyCompleteAnalysisPipeline(current, subjectSqft, { preBucketed: true });
      if (re.length >= 3) return re;
    }
    return this.applyComplexEscalation(valid, subjectSqft, step + 1);
  }

  // ===== Utilities =====

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    const n = sortedValues.length;
    if (n === 0) return NaN;
    if (n === 1) return sortedValues[0];
    const p = Math.min(100, Math.max(0, percentile)) / 100;
    const index = (n - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (upper === lower) return sortedValues[lower];
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  private monthsSince(dateISO?: string): number {
    if (!dateISO) return Infinity;
    const d = new Date(dateISO);
    if (isNaN(d.getTime())) return Infinity;
    return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  }

  private selectTopKForARV(
    comps: ComparableProperty[],
    subjectSqft: number,
    k: number = 3,
    subjectBaths: number = 1
  ): Array<ComparableProperty & { ppsf: number; indication: number; score: number }> {
    if (!comps.length) return [];
    const ppsfList = comps.map(c => c.price / c.sqft).filter(Number.isFinite).sort((a,b)=>a-b);
    const center = this.calculatePercentile(ppsfList, 50);

    const scored = comps.map(c => {
      const ppsf = c.price / c.sqft;
      const indication = ppsf * subjectSqft;
      let score = 100;

      const devPct = Math.abs(ppsf - center) / Math.max(center, 1e-9); // centrality
      score -= Math.min(25, Math.round(devPct * 100 * 0.8));

      const m = this.monthsSince(c.soldDateISO);                        // recency
      if (isFinite(m)) score -= m > 12 ? 10 : (m > 6 ? 5 : 0);

      const d = c.distanceMiles ?? 0;                                   // distance
      if (isFinite(d) && d > 0.5) score -= Math.min(20, Math.round(((d - 0.5) / 0.1) * 2));

      if ((c.baths ?? 0) > subjectBaths) score -= 8;                    // bath match
      if (c.confidence === "high") score += 5;                          // confidence nudge
      if (c.confidence === "low") score -= 5;

      return { ...(c as any), ppsf, indication, score: Math.max(0, score) };
    });

    scored.sort((a,b) => b.score - a.score || Math.abs(a.ppsf-center) - Math.abs(b.ppsf-center));

    if (k >= 3) {
      const top = scored.slice(0, k + 2);
      const med = center;
      const uppers = top.filter(c => c.ppsf >= med);
      const lowers = top.filter(c => c.ppsf < med);
      if (uppers.length && lowers.length) {
        const central = top.slice().sort((a,b)=>Math.abs(a.ppsf-med)-Math.abs(b.ppsf-med))[0];
        const upper = uppers[0];
        const rest = top.filter(c => c !== central && c !== upper);
        return [upper, central, ...(rest.slice(0,1))].slice(0, k);
      }
    }
    return scored.slice(0, k);
  }

  // ===== Bathroom premium (simple conservative stub; replace later) =====

  private estimateSecondBathPremium(_subjectSqft: number, _comps: ComparableProperty[]): { full: number; halfFactor: number } {
    // Replace with market-derived premium later (e.g., hedonic or paired sales)
    return { full: 10000, halfFactor: 0.6 };
  }

  private applyBathPenaltyToIndication(
    subjectSqft: number,
    subjectBaths: number,
    comp: ComparableProperty,
    premium: { full: number; halfFactor: number }
  ): number {
    // Apply on the *indication* (ppsf * subjectSqft), never on the raw sale price
    const base = (comp.price / comp.sqft) * subjectSqft;
    if ((comp.baths ?? subjectBaths) <= subjectBaths) return base;
    return Math.max(0, base - premium.full);
  }
}
