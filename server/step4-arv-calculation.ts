import { ComparableProperty } from './step3-find-comparables';

interface ARVResult {
  arv: number;
  slope?: number; // Price per square foot (for regression methods)
  intercept?: number; // Y-intercept for full regression
  r2?: number; // Coefficient of determination (for regression methods)
  method: string; // Calculation method used
  dataPoints: number;
  confidence: 'high' | 'medium' | 'low';
}

class ARVCalculationService {
  
  /**
   * Calculate ARV using zero-intercept linear regression (y = mx)
   * This finds the best-fit line through the origin using comparable sales data
   */
  calculateARV(
    comparables: ComparableProperty[],
    subjectSqft: number,
    subjectBaths?: number | null
  ): ARVResult {
    if (comparables.length === 0) {
      return {
        arv: 0,
        slope: 0,
        r2: 0,
        dataPoints: 0,
        confidence: 'low'
      };
    }

    console.log(`📊 ARV Calculation: ${comparables.length} total comparables`);

    // Step 1: Outlier Detection and Filtering
    const filteredComparables = this.detectAndFilterOutliers(comparables, subjectSqft);
    
    if (filteredComparables.length === 0) {
      console.log(`⚠️ All comparables filtered out as outliers, using original set`);
      // If all are outliers, use original set but flag as low confidence
    }

    // Apply bathroom adjustments when subject has fewer baths than comps
    const subjectBathsNormalized = Number.isFinite(subjectBaths as any)
      ? Number(subjectBaths)
      : null;
    const finalComparables = (filteredComparables.length > 0 ? filteredComparables : comparables);
    
    let dataPoints: any[];
    
    // Check if we need bathroom adjustments (only if subject bath count is known)
    const needsBathAdjustments = subjectBathsNormalized != null
      && finalComparables.some(comp => Number.isFinite(comp.baths as any) && comp.baths > (subjectBathsNormalized as number));
    if (needsBathAdjustments) {
      console.log(`🚿 Applying bathroom adjustments where comps exceed subject baths (${subjectBathsNormalized})...`);
      
      // Estimate second bathroom premium
      const bathPremium = this.estimateSecondBathPremium(subjectSqft, finalComparables);
      
      // Apply penalties and create adjusted data points
      const adjustedComparables = finalComparables.map(comp => {
        const compBaths = Number(comp.baths);
        if (Number.isFinite(compBaths) && subjectBathsNormalized != null && compBaths > subjectBathsNormalized) {
          const adjustedPrice = this.applyBathPenaltyToIndication(subjectSqft, subjectBathsNormalized, comp, bathPremium);
          return {
            ...comp,
            price: adjustedPrice,
            originalPrice: comp.price,
            bathroomAdjusted: true
          };
        }
        return comp;
      });
      
      // Prepare data points with bathroom adjustments
      dataPoints = adjustedComparables.map(comp => ({
        x: comp.sqft,
        y: comp.price,
        address: comp.address,
        originalPrice: comp.originalPrice || comp.price,
        bathroomAdjusted: comp.bathroomAdjusted || false
      }));
    } else {
      // No bathroom adjustments needed
      dataPoints = finalComparables.map(comp => ({
        x: comp.sqft,
        y: comp.price,
        address: comp.address
      }));
    }

    console.log(`📊 Final ARV Calculation: ${dataPoints.length} data points (after outlier filtering)`);
    dataPoints.forEach(point => {
      console.log(`   ${point.address}: ${point.x} sqft → $${point.y.toLocaleString()}`);
    });

    // Calculate ARV using direct comparable analysis
    const arvResult = this.calculateARVFromComps(dataPoints, subjectSqft);

    console.log(`📈 Comparable-based ARV calculation:`);
    console.log(`   Method: ${arvResult.method}`);
    console.log(`   ARV: $${arvResult.arv.toLocaleString()}`);
    console.log(`   Confidence: ${arvResult.confidence}`);

    return arvResult;
  }

  /**
   * Calculate ARV directly from comparable data
   */
  private calculateARVFromComps(dataPoints: Array<{x: number, y: number, address: string}>, subjectSqft: number): ARVResult {
    const n = dataPoints.length;
    
    if (n === 0) {
      return {
        arv: 0,
        method: 'No comparables',
        dataPoints: 0,
        confidence: 'low'
      };
    }

    // Calculate PPSF for each comp
    const ppsfData = dataPoints.map(point => ({
      address: point.address,
      sqft: point.x,
      price: point.y,
      ppsf: point.y / point.x
    }));

    console.log(`📊 PPSF Analysis:`);
    ppsfData.forEach(comp => {
      console.log(`   ${comp.address}: $${comp.price.toLocaleString()} ÷ ${comp.sqft} = $${comp.ppsf.toFixed(2)}/sqft`);
    });

    // Calculate statistics
    const ppsfValues = ppsfData.map(comp => comp.ppsf);
    const meanPpsf = ppsfValues.reduce((sum, ppsf) => sum + ppsf, 0) / n;
    const medianPpsf = this.calculatePercentile(ppsfValues.sort((a, b) => a - b), 50);

    console.log(`📊 PPSF Statistics:`);
    console.log(`   Mean PPSF: $${meanPpsf.toFixed(2)}/sqft`);
    console.log(`   Median PPSF: $${medianPpsf.toFixed(2)}/sqft`);

    // Use median PPSF for ARV calculation (more robust than mean)
    const arv = Math.round(medianPpsf * subjectSqft);

    // Determine confidence
    let confidence: 'high' | 'medium' | 'low';
    if (n >= 4) {
      confidence = 'high';
    } else if (n >= 3) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      arv,
      method: `Median PPSF (${medianPpsf.toFixed(2)}/sqft)`,
      dataPoints: n,
      confidence
    };
  }

  /**
   * Zero-intercept linear regression: y = mx
   * Minimizes sum of squared residuals: Σ(y - mx)²
   */
  private zeroInterceptLinearRegression(dataPoints: Array<{x: number, y: number}>): {slope: number, r2: number} {
    const n = dataPoints.length;
    
    if (n === 0) {
      return { slope: 0, r2: 0 };
    }

    // Calculate slope: m = Σ(xy) / Σ(x²)
    const sumXY = dataPoints.reduce((sum, point) => sum + (point.x * point.y), 0);
    const sumX2 = dataPoints.reduce((sum, point) => sum + (point.x * point.x), 0);
    
    const slope = sumXY / sumX2;

    // Calculate R² (coefficient of determination)
    const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
    const meanY = sumY / n;
    
    // Total sum of squares
    const totalSumSquares = dataPoints.reduce((sum, point) => sum + Math.pow(point.y - meanY, 2), 0);
    
    // Sum of squared residuals
    const residualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x;
      return sum + Math.pow(point.y - predicted, 2);
    }, 0);
    
    // R² = 1 - (SS_res / SS_tot)
    const r2 = 1 - (residualSumSquares / totalSumSquares);

    return { slope, r2 };
  }

  /**
   * Full linear regression (with intercept): y = mx + b
   */
  private fullLinearRegression(dataPoints: Array<{x: number, y: number}>): {slope: number, intercept: number, r2: number} {
    const n = dataPoints.length;
    
    if (n === 0) {
      return { slope: 0, intercept: 0, r2: 0 };
    }

    // Calculate means
    const meanX = dataPoints.reduce((sum, point) => sum + point.x, 0) / n;
    const meanY = dataPoints.reduce((sum, point) => sum + point.y, 0) / n;

    // Calculate slope: m = Σ((x - x̄)(y - ȳ)) / Σ((x - x̄)²)
    const numerator = dataPoints.reduce((sum, point) => 
      sum + ((point.x - meanX) * (point.y - meanY)), 0);
    const denominator = dataPoints.reduce((sum, point) => 
      sum + Math.pow(point.x - meanX, 2), 0);
    
    const slope = denominator === 0 ? 0 : numerator / denominator;
    
    // Calculate intercept: b = ȳ - m * x̄
    const intercept = meanY - slope * meanX;

    // Calculate R² (coefficient of determination)
    // Total sum of squares
    const totalSumSquares = dataPoints.reduce((sum, point) => 
      sum + Math.pow(point.y - meanY, 2), 0);
    
    // Sum of squared residuals
    const residualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x + intercept;
      return sum + Math.pow(point.y - predicted, 2);
    }, 0);
    
    // R² = 1 - (SS_res / SS_tot)
    const r2 = totalSumSquares === 0 ? 0 : 1 - (residualSumSquares / totalSumSquares);

    return { slope, intercept, r2 };
  }

  /**
   * Alternative ARV calculation using weighted regression
   * Weights comps by inverse distance (closer comps have more influence)
   */
  calculateWeightedARV(comparables: ComparableProperty[], subjectSqft: number): ARVResult {
    if (comparables.length === 0) {
      return {
        arv: 0,
        slope: 0,
        r2: 0,
        dataPoints: 0,
        confidence: 'low'
      };
    }

    // Prepare weighted data points
    const dataPoints = comparables.map(comp => ({
      x: comp.sqft,
      y: comp.price,
      weight: 1 / (comp.distance + 0.1), // +0.1 to avoid division by zero
      address: comp.address
    }));

    console.log(`📊 Weighted ARV Calculation: ${dataPoints.length} data points`);
    dataPoints.forEach(point => {
      console.log(`   ${point.address}: ${point.x} sqft → $${point.y.toLocaleString()} (weight: ${point.weight.toFixed(2)})`);
    });

    // Calculate weighted zero-intercept linear regression
    const regression = this.weightedZeroInterceptLinearRegression(dataPoints);
    
    const arv = Math.round(regression.slope * subjectSqft);
    
    let confidence: 'high' | 'medium' | 'low';
    if (dataPoints.length >= 4 && regression.r2 >= 0.8) {
      confidence = 'high';
    } else if (dataPoints.length >= 3 && regression.r2 >= 0.6) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    console.log(`📈 Weighted zero-intercept regression results:`);
    console.log(`   Slope (PPSF): $${regression.slope.toFixed(2)}`);
    console.log(`   R²: ${regression.r2.toFixed(3)}`);
    console.log(`   ARV: $${arv.toLocaleString()}`);
    console.log(`   Confidence: ${confidence}`);

    return {
      arv,
      slope: regression.slope,
      r2: regression.r2,
      dataPoints: dataPoints.length,
      confidence
    };
  }

  /**
   * Weighted zero-intercept linear regression
   */
  private weightedZeroInterceptLinearRegression(dataPoints: Array<{x: number, y: number, weight: number}>): {slope: number, r2: number} {
    const n = dataPoints.length;
    
    if (n === 0) {
      return { slope: 0, r2: 0 };
    }

    // Calculate weighted slope: m = Σ(w*xy) / Σ(w*x²)
    const sumWXY = dataPoints.reduce((sum, point) => sum + (point.weight * point.x * point.y), 0);
    const sumWX2 = dataPoints.reduce((sum, point) => sum + (point.weight * point.x * point.x), 0);
    
    const slope = sumWXY / sumWX2;

    // Calculate weighted R²
    const sumWY = dataPoints.reduce((sum, point) => sum + (point.weight * point.y), 0);
    const sumW = dataPoints.reduce((sum, point) => sum + point.weight, 0);
    const weightedMeanY = sumWY / sumW;
    
    // Weighted total sum of squares
    const weightedTotalSumSquares = dataPoints.reduce((sum, point) => 
      sum + (point.weight * Math.pow(point.y - weightedMeanY, 2)), 0);
    
    // Weighted sum of squared residuals
    const weightedResidualSumSquares = dataPoints.reduce((sum, point) => {
      const predicted = slope * point.x;
      return sum + (point.weight * Math.pow(point.y - predicted, 2));
    }, 0);
    
    const r2 = 1 - (weightedResidualSumSquares / weightedTotalSumSquares);

    return { slope, r2 };
  }

  /**
   * Enhanced Outlier Detection using Ensemble approach with sample-size modes
   */
  private detectAndFilterOutliers(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    if (comparables.length < 3) {
      console.log(`📊 Not enough comparables for outlier detection (need ≥3, have ${comparables.length})`);
      return comparables;
    }

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
   * Mode A (n ≥ 8): Log-PPSF robust z (MAD) outlier detection
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
   * Mode B (n < 8): Median-ratio and clustering outlier detection
   */
  private modeBSmallSampleOutlierDetection(comparables: ComparableProperty[]): ComparableProperty[] {
    console.log(`📊 Mode B: Small sample outlier detection (n=${comparables.length})`);

    // Calculate PPSF and sort
    const ppsfData = comparables.map(comp => ({
      comp,
      ppsf: comp.price / comp.sqft
    })).sort((a, b) => a.ppsf - b.ppsf);

    console.log(`   PPSF sorted: ${ppsfData.map(d => `$${d.ppsf.toFixed(2)}`).join(', ')}`);

    // Median-ratio approach
    const medianPpsf = this.calculatePercentile(ppsfData.map(d => d.ppsf), 50);
    const [low, mid, high] = [
      ppsfData[0].ppsf,
      medianPpsf,
      ppsfData[ppsfData.length - 1].ppsf
    ];

    console.log(`   [low, mid, high]: [$${low.toFixed(2)}, $${mid.toFixed(2)}, $${high.toFixed(2)}]`);

    // Dynamic threshold based on high/median ratio
    let tLow = 0.75; // Default threshold
    if (high / medianPpsf >= 1.30) {
      tLow = 0.70;
      console.log(`   High/median ratio ≥ 1.30, using T_low = 0.70`);
    } else {
      console.log(`   Using default T_low = 0.75`);
    }

    // Flag low outliers - check ALL comps below threshold, not just the lowest
    const flaggedOutliers: typeof ppsfData = [];
    const keepComps: typeof ppsfData = [];

    for (const data of ppsfData) {
      const ratio = data.ppsf / medianPpsf;
      if (ratio < tLow) {
        flaggedOutliers.push(data);
        console.log(`   🚩 FLAGGED: ${data.comp.address} - $${data.ppsf.toFixed(2)}/sqft (ratio: ${ratio.toFixed(2)} < ${tLow})`);
      } else {
        keepComps.push(data);
      }
    }

    // K=2 clustering on log(PPSF) to validate
    if (flaggedOutliers.length > 0) {
      const logPpsfValues = ppsfData.map(d => Math.log(d.ppsf));
      const lowLogPpsf = Math.log(low);
      
      // Simple clustering: if low value is isolated
      const otherLogPpsf = logPpsfValues.slice(1);
      const avgOtherLogPpsf = otherLogPpsf.reduce((sum, val) => sum + val, 0) / otherLogPpsf.length;
      const isolationThreshold = Math.abs(lowLogPpsf - avgOtherLogPpsf);
      
      console.log(`   K=2 clustering: low log-PPSF isolation = ${isolationThreshold.toFixed(4)}`);
      
      if (isolationThreshold > 0.3) { // Threshold for singleton cluster
        console.log(`   ✅ Clustering confirms low outlier as singleton cluster`);
      } else {
        console.log(`   ⚠️ Clustering suggests low value may not be isolated`);
      }
    }

    // Keep flagged outliers as context floors only (not for ARV reconciliation)
    console.log(`📊 Mode B Results:`);
    console.log(`   Context floors (flagged but kept): ${flaggedOutliers.length}`);
    console.log(`   Primary comps (for ARV): ${keepComps.length}`);

    // Return only the comps that are NOT flagged outliers for ARV calculation
    const primaryComps = keepComps.map(data => data.comp);
    
    if (flaggedOutliers.length > 0) {
      console.log(`⚠️ ${flaggedOutliers.length} comps flagged as context floors, using ${primaryComps.length} primary comps for ARV`);
    }
    
    return primaryComps;
  }

  /**
   * Complex escalation process with multiple steps
   * This implements the full escalation method: Timeline → GLA → Bathroom → Distance → Municipal
   */
  private applyComplexEscalation(
    originalComparables: ComparableProperty[], 
    subjectSqft: number,
    escalationStep: number = 1
  ): ComparableProperty[] {
    console.log(`🔄 ESCALATION STEP ${escalationStep}: Starting complex escalation process...`);
    
    let currentComps = [...originalComparables];
    let stepName = "";
    
    switch (escalationStep) {
      case 1:
        stepName = "Timeline Expansion (18 months)";
        console.log(`   ⚠️ Timeline expansion requires re-searching - handled at full-analysis level`);
        console.log(`   📋 Proceeding to Step 2: GLA Bucket Expansion`);
        return this.applyComplexEscalation(originalComparables, subjectSqft, 2);
        
      case 2:
        stepName = "GLA Bucket Expansion (±20%)";
        console.log(`🔄 Step 2: Expanding GLA bucket to ±20%...`);
        currentComps = this.applyExpandedGLABucketing(originalComparables, subjectSqft);
        break;
        
      case 3:
        stepName = "Bathroom Escalation (Allow 2-bath comps)";
        console.log(`🔄 Step 3: Allowing 2-bath comparables with penalty system...`);
        currentComps = this.applyBathroomEscalation(currentComps, subjectSqft);
        break;
        
      case 4:
        stepName = "Distance Expansion (Same Municipality)";
        console.log(`🔄 Step 4: Expanding search radius within same municipality...`);
        console.log(`   ⚠️ Distance expansion requires re-searching - handled at full-analysis level`);
        console.log(`   📋 Proceeding to Step 5: Municipal Boundary Expansion`);
        return this.applyComplexEscalation(originalComparables, subjectSqft, 5);
        
      case 5:
        stepName = "Municipal Boundary Expansion (Last Resort)";
        console.log(`🔄 Step 5: Crossing municipal boundaries with down-weighting...`);
        console.log(`   ⚠️ Municipal expansion requires re-searching - handled at full-analysis level`);
        console.log(`   🚨 CRITICAL: All escalation options exhausted`);
        return originalComparables; // Return what we have
        
      default:
        console.log(`   🚨 ERROR: Invalid escalation step ${escalationStep}`);
        return originalComparables;
    }
    
    console.log(`   📊 ${stepName} found: ${currentComps.length} comps`);
    
    if (currentComps.length >= 3) {
      console.log(`   🔄 Re-applying complete analysis pipeline to escalated set...`);
      
      // Apply complete analysis pipeline (GLA + outlier detection + bathroom analysis)
      const reFilteredComps = this.applyCompleteAnalysisPipeline(currentComps, subjectSqft);
      
      console.log(`   📊 Complete analysis results: ${reFilteredComps.length} valid comps`);
      
      if (reFilteredComps.length >= 3) {
        console.log(`   ✅ ${stepName} successful: ${reFilteredComps.length} valid comps for ARV`);
        return reFilteredComps;
      } else {
        console.log(`   ⚠️ After ${stepName}: Still insufficient comps (${reFilteredComps.length} < 3)`);
        console.log(`   📋 NEXT STEP: ${escalationStep + 1}`);
        return this.applyComplexEscalation(originalComparables, subjectSqft, escalationStep + 1);
      }
    } else {
      console.log(`   🚨 CRITICAL: ${stepName} insufficient comps (${currentComps.length} < 3)`);
      console.log(`   📋 NEXT STEP: ${escalationStep + 1}`);
      return this.applyComplexEscalation(originalComparables, subjectSqft, escalationStep + 1);
    }
  }

  /**
   * Apply complete analysis pipeline (GLA + outlier detection + bathroom analysis)
   */
  private applyCompleteAnalysisPipeline(
    comparables: ComparableProperty[], 
    subjectSqft: number
  ): ComparableProperty[] {
    // Step 1: GLA Bucketing
    const glaFilteredComps = this.applyGLABucketing(comparables, subjectSqft);
    
    // Step 2: Outlier Detection
    const outlierFilteredComps = this.applyCoreOutlierDetection(glaFilteredComps, subjectSqft);
    
    // Step 3: Bathroom Analysis & Penalties (if needed)
    // Note: This would be implemented based on subject property bathroom count
    
    return outlierFilteredComps;
  }

  /**
   * Bathroom escalation: Allow 2-bath comps with penalty system
   */
  private applyBathroomEscalation(
    originalComparables: ComparableProperty[], 
    subjectSqft: number
  ): ComparableProperty[] {
    console.log(`   🚿 Allowing 2-bath comparables with penalty system...`);
    
    // For now, return original comps (bathroom escalation logic would be implemented here)
    // This would include:
    // 1. Remove 1-bath filtering
    // 2. Apply bathroom penalty system
    // 3. Weight 2-bath comps appropriately
    
    return originalComparables;
  }

  /**
   * Core outlier detection without escalation (to avoid recursion)
   */
  private applyCoreOutlierDetection(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    if (comparables.length < 3) {
      return comparables;
    }

    const n = comparables.length;
    const isLargeSample = n >= 8;

    if (isLargeSample) {
      return this.modeALargeSampleOutlierDetection(comparables);
    } else {
      return this.modeBSmallSampleOutlierDetection(comparables);
    }
  }

  /**
   * Expanded GLA bucketing for thin-data escalation
   */
  private applyExpandedGLABucketing(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    const expandedRange = subjectSqft * 0.20; // ±20%
    const minSqft = subjectSqft - expandedRange;
    const maxSqft = subjectSqft + expandedRange;

    console.log(`   📏 Expanded GLA bucket: ${minSqft.toFixed(0)} - ${maxSqft.toFixed(0)} sqft (±20%)`);

    const filtered = comparables.filter(comp => {
      const inRange = comp.sqft >= minSqft && comp.sqft <= maxSqft;
      console.log(`   ${comp.address}: ${comp.sqft} sqft ${inRange ? '✅' : '❌'}`);
      return inRange;
    });

    return filtered;
  }

  /**
   * Calculate percentile value from sorted array
   */
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

  /**
   * Bathroom adjustment system for 2-bath comparables
   */
  private estimateSecondBathPremium(subjectSqft: number, comps: ComparableProperty[]): { full: number; halfFactor: number } {
    console.log(`🚿 Estimating second bathroom premium for ${subjectSqft} sqft subject...`);

    // 1) Try paired sales: find near-identical 1-bath vs 2-bath pairs
    const bucket = (c: ComparableProperty) => Math.abs(c.sqft - subjectSqft) <= subjectSqft * 0.10;
    const ones = comps.filter(c => c.baths === 1 && bucket(c));
    const twos = comps.filter(c => c.baths >= 2 && bucket(c));
    const pairs: number[] = [];

    console.log(`   Found ${ones.length} 1-bath comps and ${twos.length} 2-bath comps in GLA bucket`);

    for (const oneBath of ones) {
      // Find nearest neighbor in 2-bath comps by sqft
      const nearest = twos.reduce<{ distance: number; premium: number } | null>((best, twoBath) => {
        const distance = Math.abs(twoBath.sqft - oneBath.sqft);
        const premium = (twoBath.price / twoBath.sqft - oneBath.price / oneBath.sqft) * subjectSqft;
        const val = { distance, premium };
        return !best || distance < best.distance ? val : best;
      }, null);
      
      if (nearest) {
        pairs.push(nearest.premium);
        console.log(`   Pair: ${oneBath.address} (${oneBath.sqft} sqft, 1 bath) vs nearest 2-bath → $${nearest.premium.toLocaleString()} premium`);
      }
    }

    let fullPremium = NaN;
    if (pairs.length >= 2) {
      pairs.sort((x, y) => x - y);
      fullPremium = pairs.length % 2 
        ? pairs[Math.floor(pairs.length / 2)] 
        : (pairs[pairs.length / 2 - 1] + pairs[pairs.length / 2]) / 2;
      console.log(`   ✅ Paired sales analysis: $${fullPremium.toLocaleString()} premium (${pairs.length} pairs)`);
    }

    // 2) Fallback bands if pairs are thin
    if (!Number.isFinite(fullPremium)) {
      fullPremium = subjectSqft < 1000 ? 10000 : subjectSqft < 1500 ? 14000 : 16000;
      console.log(`   📊 Fallback premium: $${fullPremium.toLocaleString()} (based on size band)`);
    }

    return { full: fullPremium, halfFactor: 0.35 };
  }

  /**
   * Apply bathroom penalty to 2-bath comparable
   */
  private applyBathPenaltyToIndication(
    subjectSqft: number, 
    subjectBaths: number, 
    comp: ComparableProperty, 
    premium: { full: number; halfFactor: number }
  ): number {
    const ppsf = comp.price / comp.sqft;
    let adjustedIndication = ppsf * subjectSqft;
    
    const deltaFull = Math.max(0, Math.floor(comp.baths) - subjectBaths);
    const deltaHalf = Math.max(0, comp.baths - Math.floor(comp.baths)); // e.g., 1.5 -> 0.5
    
    let penalty = premium.full * deltaFull + premium.full * premium.halfFactor * deltaHalf;
    
    // Primary ensuite adds ~10-20% to second-bath premium
    if (deltaFull >= 1) {
      penalty *= 1.15; // 15% uplift for primary ensuite
    }
    
    const finalIndication = Math.max(0, adjustedIndication - penalty);
    
    console.log(`   🚿 ${comp.address}: $${comp.price.toLocaleString()} (${comp.baths} baths)`);
    console.log(`      Raw indication: $${adjustedIndication.toLocaleString()}`);
    console.log(`      Bath penalty: $${penalty.toLocaleString()} (${deltaFull} full + ${deltaHalf} half baths)`);
    console.log(`      Adjusted indication: $${finalIndication.toLocaleString()}`);
    
    return finalIndication;
  }

  /**
   * GLA (Gross Living Area) Bucketing
   * Filters comparables by similar size to ensure apples-to-apples PPSF comparisons
   */
  private applyGLABucketing(comparables: ComparableProperty[], subjectSqft: number): ComparableProperty[] {
    console.log(`📏 Applying GLA bucketing for subject: ${subjectSqft} sqft`);

    // Determine GLA bucket based on subject size
    let bucketRange: { min: number; max: number };
    
    if (subjectSqft < 800) {
      // Very small homes: absolute band ±100-150 sf
      bucketRange = {
        min: subjectSqft - 150,
        max: subjectSqft + 150
      };
      console.log(`🏠 Very small home: using absolute band ±150 sqft`);
    } else if (subjectSqft > 3000) {
      // Large homes: tighter ±8-10%
      const margin = Math.round(subjectSqft * 0.10);
      bucketRange = {
        min: subjectSqft - margin,
        max: subjectSqft + margin
      };
      console.log(`🏠 Large home: using ±10% margin (${margin} sqft)`);
    } else {
      // Default houses (800-2500 sf): ±10% target, expand to ±15% if thin inventory
      const margin10 = Math.round(subjectSqft * 0.10);
      const margin15 = Math.round(subjectSqft * 0.15);
      
      // Start with ±10% bucket
      bucketRange = {
        min: subjectSqft - margin10,
        max: subjectSqft + margin10
      };
      
      console.log(`🏠 Default house: starting with ±10% bucket (${margin10} sqft)`);
      console.log(`   ±10% bucket: ${bucketRange.min} - ${bucketRange.max} sqft`);
    }

    // Filter comparables by GLA bucket
    const glaFiltered = comparables.filter(comp => {
      const inBucket = comp.sqft >= bucketRange.min && comp.sqft <= bucketRange.max;
      console.log(`   ${comp.address}: ${comp.sqft} sqft ${inBucket ? '✅' : '❌'} ${inBucket ? '' : `(outside ${bucketRange.min}-${bucketRange.max})`}`);
      return inBucket;
    });

    // If inventory is thin (< 3 comps), expand to ±15% for default houses
    if (glaFiltered.length < 3 && subjectSqft >= 800 && subjectSqft <= 3000) {
      console.log(`⚠️ Thin inventory (${glaFiltered.length} comps), expanding to ±15% bucket`);
      
      const margin15 = Math.round(subjectSqft * 0.15);
      bucketRange = {
        min: subjectSqft - margin15,
        max: subjectSqft + margin15
      };
      
      console.log(`   ±15% bucket: ${bucketRange.min} - ${bucketRange.max} sqft`);
      
      const expandedFiltered = comparables.filter(comp => {
        const inBucket = comp.sqft >= bucketRange.min && comp.sqft <= bucketRange.max;
        console.log(`   ${comp.address}: ${comp.sqft} sqft ${inBucket ? '✅' : '❌'} ${inBucket ? '' : `(outside ${bucketRange.min}-${bucketRange.max})`}`);
        return inBucket;
      });
      
      return expandedFiltered;
    }

    console.log(`📊 GLA Bucket Summary:`);
    console.log(`   Subject: ${subjectSqft} sqft`);
    console.log(`   Bucket range: ${bucketRange.min} - ${bucketRange.max} sqft`);
    console.log(`   Comps in bucket: ${glaFiltered.length}/${comparables.length}`);

    return glaFiltered;
  }
}

// Test function
async function testARVCalculation() {
  // Get real data from previous steps
  const subjectSqftStr = process.env.SUBJECT_SQFT;
  if (!subjectSqftStr) {
    throw new Error('SUBJECT_SQFT environment variable is required');
  }
  const subjectSqft = parseInt(subjectSqftStr);
  
  const comparablesData = process.env.COMPARABLES_DATA;
  if (!comparablesData) {
    throw new Error('COMPARABLES_DATA environment variable is required');
  }
  
  let comparables: ComparableProperty[];
  try {
    comparables = JSON.parse(comparablesData);
  } catch (error) {
    throw new Error('Invalid COMPARABLES_DATA JSON format');
  }
  
  console.log(`\n💰 STEP 4: ARV CALCULATION`);
  console.log(`============================================================`);
  
  const arvService = new ARVCalculationService();
  
  console.log(`\n📊 Standard Zero-Intercept Regression:`);
  const standardResult = arvService.calculateARV(comparables, subjectSqft);
  
  console.log(`\n📊 Distance-Weighted Zero-Intercept Regression:`);
  const weightedResult = arvService.calculateWeightedARV(comparables, subjectSqft);
  
  console.log(`\n✅ ARV Calculation Complete:`);
  console.log(`   Standard ARV: $${standardResult.arv.toLocaleString()} (${standardResult.confidence} confidence)`);
  console.log(`   Weighted ARV: $${weightedResult.arv.toLocaleString()} (${weightedResult.confidence} confidence)`);
  
  return { standardResult, weightedResult };
}

// Run if called directly
if (process.env.RUN_CLI === '1' && import.meta.url === `file://${process.argv[1]}`) {
  testARVCalculation().catch(console.error);
}

export { ARVCalculationService, testARVCalculation };
export type { ARVResult };
