// Controlled test using manual calculation data
import { ComprehensiveComparableSearchV3 } from './src/server/comprehensive-comp-search-v3.js';

interface TestProperty {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  year_built: number;
  ppsf: number;
}

async function debugControlledTest() {
  console.log('🔬 CONTROLLED TEST: Manual Calculation Data');
  console.log('==========================================');

  // Your exact manual calculation data
  const manualProperties: TestProperty[] = [
    { address: '3238 Washington', price: 135000, sqft: 1978, beds: 3, baths: 2, year_built: 1960, ppsf: 68.25 },
    { address: '2649 Headland', price: 182500, sqft: 1915, beds: 3, baths: 3, year_built: 1954, ppsf: 95.30 },
    { address: '2251 Headland', price: 279500, sqft: 1915, beds: 3, baths: 2, year_built: 1954, ppsf: 145.95 },
    { address: '2674 Bryant', price: 215000, sqft: 1381, beds: 4, baths: 2, year_built: 1960, ppsf: 155.75 },
    { address: '3083 McKenzie', price: 162000, sqft: 1023, beds: 3, baths: 1, year_built: 1955, ppsf: 158.36 },
    { address: '2770 Hogan', price: 385000, sqft: 2240, beds: 4, baths: 3, year_built: 1962, ppsf: 171.88 },
    { address: '2279 Lyle', price: 420000, sqft: 2022, beds: 4, baths: 3, year_built: 1965, ppsf: 207.72 }
  ];

  const subjectSqft = 2345;

  console.log('📊 INPUT DATA:');
  manualProperties.forEach((prop, i) => {
    console.log(`${i+1}. ${prop.address}: $${prop.price.toLocaleString()} | ${prop.sqft}sf | ${prop.beds}BR/${prop.baths}BA | $${prop.ppsf.toFixed(2)}/sf`);
  });

  // Step 1: Manual PPSF & Z-Score Calculation
  console.log('\n🔍 STEP 1: PPSF & Z-Score Calculation');
  const ppsfValues = manualProperties.map(p => p.ppsf).sort((a, b) => a - b);
  const medianPpsf = ppsfValues[Math.floor(ppsfValues.length / 2)]; // 155.75

  // Calculate MAD (Median Absolute Deviation)
  const deviations = ppsfValues.map(ppsf => Math.abs(ppsf - medianPpsf));
  const madPpsf = deviations.sort((a, b) => a - b)[Math.floor(deviations.length / 2)];

  console.log(`📈 Sorted PPSF: ${ppsfValues.map(p => p.toFixed(2)).join(', ')}`);
  console.log(`📊 Median PPSF: $${medianPpsf.toFixed(2)}`);
  console.log(`📊 MAD: ${madPpsf.toFixed(2)}`);

  // Calculate z-scores
  const propertiesWithZ = manualProperties.map(prop => {
    const zScore = 0.6745 * (prop.ppsf - medianPpsf) / madPpsf;
    return { ...prop, zScore };
  });

  console.log('\n📊 Z-Scores:');
  propertiesWithZ.forEach(prop => {
    console.log(`${prop.address}: z = ${prop.zScore.toFixed(2)}`);
  });

  // Step 2: High-tier check (z ≥ 1.0)
  console.log('\n🔍 STEP 2: High-tier Check (z ≥ 1.0)');
  const highTier = propertiesWithZ.filter(p => p.zScore >= 1.0);
  console.log(`📊 High-tier properties: ${highTier.length}`);

  if (highTier.length > 0) {
    highTier.forEach(prop => {
      console.log(`✅ ${prop.address}: z = ${prop.zScore.toFixed(2)}, $${prop.ppsf.toFixed(2)}/sf`);
    });

    // Check for supporters
    let hasSupport = false;
    for (const candidate of highTier) {
      for (const other of propertiesWithZ) {
        if (other === candidate) continue;

        const zDiff = Math.abs(candidate.zScore - other.zScore);
        const priceDiff = Math.abs(candidate.price - other.price);
        const minPrice = Math.min(candidate.price, other.price);
        const priceRatio = priceDiff / minPrice;

        if (zDiff <= 0.5 && priceRatio <= 0.075) {
          hasSupport = true;
          console.log(`✅ ${candidate.address} supported by ${other.address} (z-diff: ${zDiff.toFixed(3)}, price-diff: ${(priceRatio*100).toFixed(1)}%)`);
          break;
        }
      }
    }

    if (!hasSupport) {
      console.log('❌ No high-tier support found → Triggering fallback');
    }
  } else {
    console.log('❌ No high-tier properties → Triggering fallback');
  }

  // Step 3: Fallback Process
  console.log('\n🔍 STEP 3: Fallback Process');

  // Remove low outliers (z ≤ -1.0)
  const afterLowOutlierRemoval = propertiesWithZ.filter(p => p.zScore > -1.0);
  console.log(`📊 After low outlier removal: ${afterLowOutlierRemoval.length} properties`);

  afterLowOutlierRemoval.forEach(prop => {
    console.log(`✅ Kept: ${prop.address} (z = ${prop.zScore.toFixed(2)})`);
  });

  const dropped = propertiesWithZ.filter(p => p.zScore <= -1.0);
  dropped.forEach(prop => {
    console.log(`❌ Dropped: ${prop.address} (z = ${prop.zScore.toFixed(2)})`);
  });

  // Price isolation check (7.5% threshold)
  console.log('\n🔍 STEP 4: Price Isolation Check (7.5% threshold)');
  const finalProperties = [];
  const droppedIsolated = [];

  for (const candidate of afterLowOutlierRemoval) {
    let hasNeighbor = false;
    let closestRatio = Infinity;

    for (const other of afterLowOutlierRemoval) {
      if (other === candidate) continue;

      const priceDiff = Math.abs(candidate.price - other.price);
      const minPrice = Math.min(candidate.price, other.price);
      const priceRatio = priceDiff / minPrice;

      if (priceRatio < closestRatio) {
        closestRatio = priceRatio;
      }

      if (priceRatio <= 0.075) {
        hasNeighbor = true;
        console.log(`✅ ${candidate.address} has neighbor: ${other.address} (${(priceRatio*100).toFixed(1)}%)`);
        break;
      }
    }

    if (hasNeighbor) {
      finalProperties.push(candidate);
    } else {
      droppedIsolated.push(candidate);
      console.log(`❌ ISOLATED: ${candidate.address} (closest: ${(closestRatio*100).toFixed(1)}%)`);
    }
  }

  console.log(`\n📊 Final properties after isolation check: ${finalProperties.length}`);

  // Step 4: ARV Calculation
  console.log('\n🔍 STEP 5: ARV Calculation');

  if (finalProperties.length >= 3) {
    const finalPpsf = finalProperties.map(p => p.ppsf).sort((a, b) => a - b);
    const finalMedianPpsf = finalPpsf[Math.floor(finalPpsf.length / 2)];
    const arv = finalMedianPpsf * subjectSqft;

    console.log('✅ SUCCESS: ARV Calculation');
    console.log(`📊 Final properties: ${finalProperties.length}`);
    finalProperties.forEach(prop => {
      console.log(`   - ${prop.address}: $${prop.ppsf.toFixed(2)}/sf`);
    });
    console.log(`📊 Final median PPSF: $${finalMedianPpsf.toFixed(2)}`);
    console.log(`🏠 Subject sqft: ${subjectSqft.toLocaleString()}`);
    console.log(`💰 ARV: $${arv.toLocaleString()}`);

    return arv;
  } else {
    console.log('❌ FAILED: Insufficient properties for ARV calculation');
    console.log(`📊 Need ≥3, have ${finalProperties.length}`);
    return null;
  }
}

// Run the controlled test
debugControlledTest().then(arv => {
  if (arv) {
    console.log(`\n🎯 EXPECTED RESULT: $${arv.toLocaleString()}`);
  } else {
    console.log('\n❌ FAILED TO CALCULATE ARV');
  }
}).catch(error => {
  console.error('❌ Test failed:', error);
});