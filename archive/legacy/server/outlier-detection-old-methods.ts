// ARCHIVED: Old outlier detection methods from step4-arv-calculation.ts
// Replaced with Sequential Gap Outlier Detection on [current date]
// These methods used MAD-based and median-ratio approaches

import type { ComparableProperty } from "../../../shared/types";

export class ArchivedOutlierDetection {
  /**
   * Enhanced outlier detection using statistical methods (ARCHIVED)
   */
  private detectAndFilterOutliersOLD(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    console.log(`🔍 Starting enhanced outlier detection on ${comparables.length} comparables...`);

    // Apply GLA bucketing first
    const glaFilteredComps = this.applyGLABucketing(comparables, subjectSqft);
    console.log(`📊 GLA Bucket Results: ${glaFilteredComps.length} comps within size range`);

    if (glaFilteredComps.length === 0) {
      console.log(`⚠️ No comparables within GLA bucket, using all comparables`);
      return comparables;
    }

    // Determine sample-size mode
    const n = glaFilteredComps.length;
    const isLargeSample = n >= 8;

    console.log(`📊 Sample Size Mode: ${isLargeSample ? 'Mode A (n≥8)' : 'Mode B (n<8)'} - ${n} comparables`);

    let filteredComps = [...glaFilteredComps];

    if (isLargeSample) {
      // Mode A (n ≥ 8): Log-PPSF robust z (MAD) approach
      filteredComps = this.modeALargeSampleOutlierDetection(glaFilteredComps);
    } else {
      // Mode B (n < 8): Median-ratio and clustering approach
      filteredComps = this.modeBSmallSampleOutlierDetection(glaFilteredComps);
    }

    // Check if we need complex escalation
    if (filteredComps.length < 3) {
      console.log(`⚠️ Thin data detected (${filteredComps.length} < 3 comps)`);
      console.log(`📋 Timeline expansion requires re-searching - handled at full-analysis level`);
      console.log(`📋 Proceeding with GLA bucketing escalation only...`);
      filteredComps = this.applyComplexEscalation(comparables, subjectSqft, 2);
    }

    console.log(`📊 Enhanced Outlier Detection Results:`);
    console.log(`   Original comparables: ${comparables.length}`);
    console.log(`   Filtered comparables: ${filteredComps.length}`);
    console.log(`   Removed outliers: ${comparables.length - filteredComps.length}`);

    return filteredComps;
  }

  /**
   * Mode A (n ≥ 8): Log-PPSF robust z (MAD) outlier detection (ARCHIVED)
   */
  private modeALargeSampleOutlierDetection(comparables: ComparableProperty[]): ComparableProperty[] {
    console.log(`📊 Mode A: Large sample outlier detection (n=${comparables.length})`);

    // Calculate log-PPSF for robust statistics
    const logPpsfData = comparables.map(comp => ({
      comp,
      logPpsf: Math.log(comp.price / comp.sqft),
      ppsf: comp.price / comp.sqft
    }));

    // Calculate Median Absolute Deviation (MAD)
    const logPpsfValues = logPpsfData.map(d => d.logPpsf).sort((a, b) => a - b);
    const median = this.calculatePercentile(logPpsfValues, 50);

    // Calculate MAD
    const deviations = logPpsfData.map(d => Math.abs(d.logPpsf - median));
    const mad = this.calculatePercentile(deviations.sort((a, b) => a - b), 50);

    // Robust z-score threshold
    const robustZThreshold = -2.5;
    const threshold = median + robustZThreshold * (mad * 1.4826); // 1.4826 makes MAD consistent with std dev for normal distribution

    console.log(`   Log-PPSF median: ${median.toFixed(4)}`);
    console.log(`   MAD: ${mad.toFixed(4)}`);
    console.log(`   Robust z threshold: ${robustZThreshold} (log-PPSF < ${threshold.toFixed(4)})`);

    // Filter outliers
    const filteredComps = logPpsfData
      .filter(d => d.logPpsf >= threshold)
      .map(d => d.comp);

    const outliers = logPpsfData.filter(d => d.logPpsf < threshold);
    if (outliers.length > 0) {
      console.log(`❌ Dropped ${outliers.length} outliers (robust z < ${robustZThreshold}):`);
      outliers.forEach(outlier => {
        console.log(`   ${outlier.comp.address}: $${outlier.ppsf.toFixed(2)}/sqft (log-PPSF: ${outlier.logPpsf.toFixed(4)})`);
      });
    }

    return filteredComps;
  }

  /**
   * Mode B (n < 8): Median-ratio and clustering outlier detection (ARCHIVED)
   */
  private modeBSmallSampleOutlierDetection(comparables: ComparableProperty[]): ComparableProperty[] {
    console.log(`📊 Mode B: Small sample outlier detection (n=${comparables.length})`);

    // Calculate PPSF and sort
    const ppsfData = comparables.map(comp => ({
      comp,
      ppsf: comp.price / comp.sqft
    })).sort((a, b) => a.ppsf - b.ppsf);

    console.log(`   PPSF sorted: ${ppsfData.map(d => `$${d.ppsf.toFixed(2)}`).join(', ')}`);

    // Calculate median
    const ppsfValues = ppsfData.map(d => d.ppsf);
    const median = this.calculatePercentile(ppsfValues, 50);

    console.log(`   PPSF median: $${median.toFixed(2)}/sqft`);

    // Use tight median-ratio filtering for small samples
    const lowRatioThreshold = 0.75;  // 25% below median
    const highRatioThreshold = 1.45; // 45% above median

    const filteredComps = ppsfData.filter(d => {
      const ratio = d.ppsf / median;
      const keep = ratio >= lowRatioThreshold && ratio <= highRatioThreshold;

      if (!keep) {
        console.log(`❌ Outlier: ${d.comp.address} - $${d.ppsf.toFixed(2)}/sqft (ratio: ${ratio.toFixed(2)})`);
      }

      return keep;
    }).map(d => d.comp);

    console.log(`   Kept ${filteredComps.length}/${comparables.length} comparables (${lowRatioThreshold}-${highRatioThreshold} median ratio)`);

    return filteredComps;
  }

  // Helper methods would also be here...
  private calculatePercentile(sortedValues: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (upper >= sortedValues.length) {
      return sortedValues[sortedValues.length - 1];
    }

    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }
}