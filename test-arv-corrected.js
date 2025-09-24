// Test corrected ARV calculation with 20% size variance
import { ARVCalculationService } from './server/step4-arv-calculation.js';

console.log('💰 CORRECTED ARV CALCULATION TEST (±20% Standard)');
console.log('=================================================');

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

const subjectSqft = 2331;

async function testCorrectedARV() {
  try {
    console.log(`📍 Subject: 185 Jordan Pl, Fayetteville, GA 30215`);
    console.log(`🏠 Subject size: ${subjectSqft} sqft`);

    // Calculate new size range with ±20%
    const sizeVariance20 = subjectSqft * 0.20;
    const minSize = subjectSqft - sizeVariance20;
    const maxSize = subjectSqft + sizeVariance20;

    console.log(`\n📐 NEW SIZE RANGE (±20%):`);
    console.log(`   Range: ${minSize.toFixed(0)} - ${maxSize.toFixed(0)} sqft`);
    console.log(`   Subject: ${subjectSqft} sqft`);

    // Check which comps qualify
    console.log(`\n🔍 COMPARABLE QUALIFICATION CHECK:`);
    selectedComps.forEach((comp, index) => {
      const sizeVariance = Math.abs(comp.sqft - subjectSqft) / subjectSqft * 100;
      const qualifies = comp.sqft >= minSize && comp.sqft <= maxSize;
      const icon = qualifies ? '✅' : '❌';

      console.log(`${index + 1}. ${comp.address}`);
      console.log(`   📐 ${comp.sqft} sqft (${sizeVariance.toFixed(1)}% variance) ${icon}`);

      if (comp.sqft === 1897) { // Brookwood specifically
        console.log(`   🎯 BROOKWOOD: ${comp.sqft} sqft vs ${minSize.toFixed(0)} minimum`);
        console.log(`       Difference: ${comp.sqft - minSize.toFixed(0)} sqft ${qualifies ? '(NOW QUALIFIES!)' : '(still rejected)'}`);
      }
    });

    // Calculate ARV with corrected system
    console.log(`\n💰 CORRECTED ARV CALCULATION:`);
    console.log(`==========================================`);

    const arvService = new ARVCalculationService();
    const result = await arvService.calculateARV(selectedComps, subjectSqft);

    console.log(`\n📊 FINAL RESULT:`);
    console.log(`   Method: ${result.method}`);
    console.log(`   ARV: $${result.arv?.toLocaleString()}`);
    console.log(`   Confidence: ${result.confidence?.toUpperCase()}`);
    console.log(`   Data points: ${result.dataPoints}`);

    // Compare to old result
    console.log(`\n🔄 COMPARISON:`);
    console.log(`   OLD (±15% max): $362,579 (3 comps, excluded Brookwood)`);
    console.log(`   NEW (±20% std): $${result.arv?.toLocaleString()} (${result.dataPoints} comps)`);

    const improvement = ((result.arv || 0) - 362579) / 362579 * 100;
    if (improvement > 0) {
      console.log(`   📈 IMPROVEMENT: +$${((result.arv || 0) - 362579).toLocaleString()} (+${improvement.toFixed(1)}%)`);
    }

    return result;

  } catch (error) {
    console.error('❌ Test failed:', error);
    return null;
  }
}

testCorrectedARV();