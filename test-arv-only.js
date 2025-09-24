// Test ARV calculation with the 4 selected comparables
import { ARVCalculationService } from './server/step4-arv-calculation.js';

console.log('💰 ARV CALCULATION TEST');
console.log('======================');

// The 4 qualified comparables from the V2 test
const selectedComps = [
  {
    address: '105 Bailey Ct, Fayetteville, GA 30215',
    price: 392000,
    sqft: 2134,
    beds: 4,
    baths: 2,
    yearBuilt: 1994,
    distance: 0.30,
    ppsf: 183.69
  },
  {
    address: '175 Sterling Way, Fayetteville, GA 30215',
    price: 380000,
    sqft: 2443,
    beds: 4,
    baths: 3,
    yearBuilt: 1997,
    distance: 0.19,
    ppsf: 155.46
  },
  {
    address: '195 Sterling Way, Fayetteville, GA 30215',
    price: 395000,
    sqft: 2584,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998,
    distance: 0.82,
    ppsf: 152.86
  },
  {
    address: '115 Brookwood Ln, Fayetteville, GA 30215',
    price: 360000,
    sqft: 1897,
    beds: 3,
    baths: 2,
    yearBuilt: 1993,
    distance: 1.14,
    ppsf: 189.77
  }
];

const subjectSqft = 2331; // Subject property square footage

async function calculateARV() {
  try {
    console.log(`📍 Subject: 185 Jordan Pl, Fayetteville, GA 30215`);
    console.log(`🏠 Subject size: ${subjectSqft} sqft`);
    console.log(`📊 Using ${selectedComps.length} comparables for ARV calculation\n`);

    // Display comparables
    console.log('📋 SELECTED COMPARABLES:');
    selectedComps.forEach((comp, index) => {
      console.log(`${index + 1}. ${comp.address}`);
      console.log(`   💰 $${comp.price.toLocaleString()} | 📐 ${comp.sqft}sqft | 📍 ${comp.distance}mi`);
      console.log(`   💲 $${comp.ppsf.toFixed(2)}/sqft | 🏠 ${comp.beds}BR/${comp.baths}BA | 📅 ${comp.yearBuilt}`);
      console.log('');
    });

    // Calculate basic statistics
    const prices = selectedComps.map(c => c.price);
    const ppsfValues = selectedComps.map(c => c.ppsf);

    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

    const avgPpsf = ppsfValues.reduce((sum, p) => sum + p, 0) / ppsfValues.length;
    const medianPpsf = ppsfValues.sort((a, b) => a - b)[Math.floor(ppsfValues.length / 2)];

    console.log('📊 COMPARABLE STATISTICS:');
    console.log(`   Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
    console.log(`   Average price: $${avgPrice.toLocaleString()}`);
    console.log(`   Median price: $${medianPrice.toLocaleString()}`);
    console.log(`   PPSF range: $${Math.min(...ppsfValues).toFixed(2)} - $${Math.max(...ppsfValues).toFixed(2)}`);
    console.log(`   Average PPSF: $${avgPpsf.toFixed(2)}`);
    console.log(`   Median PPSF: $${medianPpsf.toFixed(2)}`);
    console.log('');

    // Calculate ARV using different methods
    console.log('💰 ARV CALCULATIONS:');
    console.log('===================');

    // Method 1: Median PPSF × Subject Sqft
    const arvMedianPpsf = medianPpsf * subjectSqft;
    console.log(`🎯 Method 1 - Median PPSF: $${medianPpsf.toFixed(2)} × ${subjectSqft} sqft = $${arvMedianPpsf.toLocaleString()}`);

    // Method 2: Average PPSF × Subject Sqft
    const arvAvgPpsf = avgPpsf * subjectSqft;
    console.log(`📊 Method 2 - Average PPSF: $${avgPpsf.toFixed(2)} × ${subjectSqft} sqft = $${arvAvgPpsf.toLocaleString()}`);

    // Method 3: Size-adjusted comparison (find most similar sized comp)
    const sizeAdjusted = selectedComps.map(comp => {
      const sizeRatio = subjectSqft / comp.sqft;
      const adjustedPrice = comp.price * sizeRatio;
      return {
        ...comp,
        adjustedPrice,
        sizeVariance: Math.abs(comp.sqft - subjectSqft) / subjectSqft * 100
      };
    }).sort((a, b) => a.sizeVariance - b.sizeVariance);

    console.log(`🔄 Method 3 - Size-adjusted from closest match:`);
    const closestMatch = sizeAdjusted[0];
    console.log(`   Closest: ${closestMatch.address} (${closestMatch.sizeVariance.toFixed(1)}% size difference)`);
    console.log(`   Calculation: $${closestMatch.price.toLocaleString()} × (${subjectSqft}/${closestMatch.sqft}) = $${closestMatch.adjustedPrice.toLocaleString()}`);

    // Method 4: Distance-weighted average
    const totalWeight = selectedComps.reduce((sum, comp) => sum + (1 / (comp.distance + 0.1)), 0);
    const weightedArv = selectedComps.reduce((sum, comp) => {
      const weight = (1 / (comp.distance + 0.1)) / totalWeight;
      return sum + (comp.ppsf * weight);
    }, 0) * subjectSqft;

    console.log(`📍 Method 4 - Distance-weighted: $${weightedArv.toLocaleString()}`);

    // Use the ARV service if available
    try {
      const arvService = new ARVCalculationService();
      const officialArv = await arvService.calculateARV(selectedComps, subjectSqft);

      console.log('\n🏛️ OFFICIAL ARV SERVICE RESULT:');
      console.log(`   Method: ${officialArv.method}`);
      console.log(`   Estimate: $${officialArv.estimate.toLocaleString()}`);
      console.log(`   Confidence: ${officialArv.confidence.toUpperCase()}`);
      console.log(`   Data points: ${officialArv.dataPoints}`);
    } catch (e) {
      console.log('\n⚠️ Official ARV service not available, using manual calculations');
    }

    // Recommended ARV range
    const allEstimates = [arvMedianPpsf, arvAvgPpsf, closestMatch.adjustedPrice, weightedArv];
    const minEstimate = Math.min(...allEstimates);
    const maxEstimate = Math.max(...allEstimates);
    const recommendedArv = (arvMedianPpsf + weightedArv) / 2; // Average of median PPSF and distance-weighted

    console.log('\n🎯 RECOMMENDED ARV:');
    console.log(`   Range: $${minEstimate.toLocaleString()} - $${maxEstimate.toLocaleString()}`);
    console.log(`   Recommended: $${recommendedArv.toLocaleString()}`);
    console.log(`   Confidence: HIGH (4 quality comps within 1.14 miles)`);

    return {
      median: arvMedianPpsf,
      average: arvAvgPpsf,
      sizeAdjusted: closestMatch.adjustedPrice,
      distanceWeighted: weightedArv,
      recommended: recommendedArv,
      range: { min: minEstimate, max: maxEstimate }
    };

  } catch (error) {
    console.error('❌ ARV calculation failed:', error);
    return null;
  }
}

calculateARV();