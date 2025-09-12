import { ComparableProperty } from './step3-find-comparables';

interface ARVResult {
  arv: number;
  slope: number; // Price per square foot
  r2: number; // Coefficient of determination
  dataPoints: number;
  confidence: 'high' | 'medium' | 'low';
}

class ARVCalculationService {
  
  /**
   * Calculate ARV using zero-intercept linear regression (y = mx)
   * This finds the best-fit line through the origin using comparable sales data
   */
  calculateARV(comparables: ComparableProperty[], subjectSqft: number): ARVResult {
    if (comparables.length === 0) {
      return {
        arv: 0,
        slope: 0,
        r2: 0,
        dataPoints: 0,
        confidence: 'low'
      };
    }

    // Prepare data points: [sqft, price]
    const dataPoints = comparables.map(comp => ({
      x: comp.sqft,
      y: comp.price,
      address: comp.address
    }));

    console.log(`📊 ARV Calculation: ${dataPoints.length} data points`);
    dataPoints.forEach(point => {
      console.log(`   ${point.address}: ${point.x} sqft → $${point.y.toLocaleString()}`);
    });

    // Calculate zero-intercept linear regression
    const regression = this.zeroInterceptLinearRegression(dataPoints);
    
    // Calculate ARV
    const arv = Math.round(regression.slope * subjectSqft);
    
    // Determine confidence based on R² and data points
    let confidence: 'high' | 'medium' | 'low';
    if (dataPoints.length >= 4 && regression.r2 >= 0.8) {
      confidence = 'high';
    } else if (dataPoints.length >= 3 && regression.r2 >= 0.6) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    console.log(`📈 Zero-intercept regression results:`);
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
if (import.meta.url === `file://${process.argv[1]}`) {
  testARVCalculation().catch(console.error);
}

export { ARVCalculationService, testARVCalculation };
export type { ARVResult };
