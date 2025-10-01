// Correct implementation of the dual rule system you specified

interface PropertyWithZ {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  year_built: number;
  ppsf: number;
  zScore: number;
}

const propertiesWithZ: PropertyWithZ[] = [
  { address: '3238 Washington', price: 135000, sqft: 1978, beds: 3, baths: 2, year_built: 1960, ppsf: 68.25, zScore: -3.64 },
  { address: '2649 Headland', price: 182500, sqft: 1915, beds: 3, baths: 3, year_built: 1954, ppsf: 95.30, zScore: -2.52 },
  { address: '2251 Headland', price: 279500, sqft: 1915, beds: 3, baths: 2, year_built: 1954, ppsf: 145.95, zScore: -0.41 },
  { address: '2674 Bryant', price: 215000, sqft: 1381, beds: 4, baths: 2, year_built: 1960, ppsf: 155.68, zScore: 0.00 },
  { address: '3083 McKenzie', price: 162000, sqft: 1023, beds: 3, baths: 1, year_built: 1955, ppsf: 158.36, zScore: 0.11 },
  { address: '2770 Hogan', price: 385000, sqft: 2240, beds: 4, baths: 3, year_built: 1962, ppsf: 171.88, zScore: 0.67 },
  { address: '2279 Lyle', price: 420000, sqft: 2022, beds: 4, baths: 3, year_built: 1965, ppsf: 207.72, zScore: 2.17 }
];

const subjectSqft = 2345;

console.log('🔍 CORRECT DUAL RULE SYSTEM IMPLEMENTATION');
console.log('==========================================');

console.log('\n📊 Starting properties (with z-scores):');
propertiesWithZ.forEach(prop => {
  console.log(`${prop.address}: $${prop.price.toLocaleString()} | $${prop.ppsf.toFixed(2)}/sf | z=${prop.zScore.toFixed(2)}`);
});

// STEP 1: High-tier clustering (PPSF + Price conjunction)
console.log('\n1️⃣ HIGH-TIER CLUSTERING: PPSF-based z ≥ 1.0 with dual neighbor support');

const highTierCandidates = propertiesWithZ.filter(p => p.zScore >= 1.0);

console.log(`\n🔍 High-tier candidates (z ≥ 1.0): ${highTierCandidates.length}`);
highTierCandidates.forEach(prop => {
  console.log(`   ${prop.address}: z=${prop.zScore.toFixed(2)}, $${prop.ppsf.toFixed(2)}/sf`);
});

if (highTierCandidates.length === 0) {
  console.log('❌ No high-tier candidates found → Skip to fallback');
} else {
  console.log('\n🔍 Checking dual neighbor support for high-tier candidates:');
  console.log('   Requires: PPSF-close (|Δz| ≤ 0.5) AND price-close (≤ 7.5%)');

  const supportedHighTier = [];

  highTierCandidates.forEach(candidate => {
    console.log(`\n   Checking ${candidate.address} (z=${candidate.zScore.toFixed(2)}):`);

    let hasSupport = false;

    propertiesWithZ.forEach(other => {
      if (other === candidate) return;

      // Check PPSF-close: |z_i - z_j| ≤ 0.5
      const zDiff = Math.abs(candidate.zScore - other.zScore);
      const ppsfClose = zDiff <= 0.5;

      // Check price-close: |price_i - price_j| / min(price_i, price_j) ≤ 0.075
      const priceDiff = Math.abs(candidate.price - other.price);
      const minPrice = Math.min(candidate.price, other.price);
      const priceRatio = priceDiff / minPrice;
      const priceClose = priceRatio <= 0.075;

      const bothConditions = ppsfClose && priceClose;

      console.log(`      vs ${other.address}: z-diff=${zDiff.toFixed(3)} (${ppsfClose ? '✅' : '❌'}), price-diff=${(priceRatio*100).toFixed(1)}% (${priceClose ? '✅' : '❌'}) → ${bothConditions ? '✅ SUPPORT' : '❌ NO SUPPORT'}`);

      if (bothConditions) {
        hasSupport = true;
      }
    });

    if (hasSupport) {
      supportedHighTier.push(candidate);
      console.log(`   ✅ ${candidate.address} HAS DUAL SUPPORT`);
    } else {
      console.log(`   ❌ ${candidate.address} NO DUAL SUPPORT`);
    }
  });

  console.log(`\n📊 Supported high-tier properties: ${supportedHighTier.length}`);

  if (supportedHighTier.length > 0) {
    console.log('✅ HIGH-TIER CLUSTERING SUCCESS');
    // Would proceed with high-tier ARV calculation here
    return;
  } else {
    console.log('❌ NO SUPPORTED HIGH-TIER PROPERTIES → Proceed to fallback');
  }
}

// STEP 2: Fallback (price/PPSF only)
console.log('\n2️⃣ FALLBACK: Price/PPSF Only Process');

// Drop low PPSF outliers (z ≤ -1.0)
console.log('\n🔍 Step 2a: Drop low PPSF outliers (z ≤ -1.0)');

const afterLowOutlierRemoval = propertiesWithZ.filter(p => p.zScore > -1.0);
const droppedLowOutliers = propertiesWithZ.filter(p => p.zScore <= -1.0);

console.log(`✅ Kept ${afterLowOutlierRemoval.length} properties:`);
afterLowOutlierRemoval.forEach(prop => {
  console.log(`   ${prop.address}: z=${prop.zScore.toFixed(2)}`);
});

console.log(`❌ Dropped ${droppedLowOutliers.length} low PPSF outliers:`);
droppedLowOutliers.forEach(prop => {
  console.log(`   ${prop.address}: z=${prop.zScore.toFixed(2)}`);
});

// Apply strict price-neighbor rule (≤ 7.5%) to drop lone high-price outliers
console.log('\n🔍 Step 2b: Drop lone high-price outliers (strict price-neighbor ≤ 7.5%)');

const finalProperties = [];
const droppedIsolated = [];

afterLowOutlierRemoval.forEach(candidate => {
  console.log(`\n   Checking ${candidate.address} ($${candidate.price.toLocaleString()}):`);

  let hasNeighbor = false;
  let closestRatio = Infinity;
  let closestNeighbor = null;

  afterLowOutlierRemoval.forEach(other => {
    if (other === candidate) return;

    const priceDiff = Math.abs(candidate.price - other.price);
    const minPrice = Math.min(candidate.price, other.price);
    const priceRatio = priceDiff / minPrice;

    if (priceRatio < closestRatio) {
      closestRatio = priceRatio;
      closestNeighbor = other;
    }

    console.log(`      vs ${other.address} ($${other.price.toLocaleString()}): ${(priceRatio*100).toFixed(1)}% price diff ${priceRatio <= 0.075 ? '✅' : '❌'}`);

    if (priceRatio <= 0.075) {
      hasNeighbor = true;
    }
  });

  console.log(`   ▶️ Closest: ${closestNeighbor?.address} (${(closestRatio*100).toFixed(1)}%)`);
  console.log(`   ▶️ Has ≤7.5% price neighbor: ${hasNeighbor ? '✅ YES' : '❌ NO'}`);

  if (hasNeighbor) {
    finalProperties.push(candidate);
  } else {
    droppedIsolated.push(candidate);
  }
});

console.log(`\n📊 Final properties after strict price-neighbor rule: ${finalProperties.length}`);

console.log('✅ Kept properties:');
finalProperties.forEach(prop => {
  console.log(`   ${prop.address}: $${prop.price.toLocaleString()}, $${prop.ppsf.toFixed(2)}/sf`);
});

console.log('❌ Dropped isolated properties:');
droppedIsolated.forEach(prop => {
  console.log(`   ${prop.address}: $${prop.price.toLocaleString()}, $${prop.ppsf.toFixed(2)}/sf`);
});

// Step 3: ARV Calculation
console.log('\n3️⃣ ARV CALCULATION');

if (finalProperties.length >= 3) {
  const finalPpsf = finalProperties.map(p => p.ppsf).sort((a, b) => a - b);
  const finalMedianPpsf = finalPpsf[Math.floor(finalPpsf.length / 2)];
  const arv = finalMedianPpsf * subjectSqft;

  console.log('✅ SUFFICIENT properties for ARV calculation');
  console.log(`📊 Final PPSF values: [${finalPpsf.map(p => p.toFixed(2)).join(', ')}]`);
  console.log(`📊 Median PPSF: $${finalMedianPpsf.toFixed(2)}/sf`);
  console.log(`🏠 Subject sqft: ${subjectSqft.toLocaleString()}`);
  console.log(`💰 ARV = $${finalMedianPpsf.toFixed(2)} × ${subjectSqft} = $${arv.toLocaleString()}`);

  console.log('\n🎯 FINAL RESULT:');
  console.log(`ARV: $${Math.round(arv).toLocaleString()}`);
  console.log(`Properties used: ${finalProperties.length}`);
  console.log(`Algorithm: Fallback with strict price-neighbor rule`);

} else {
  console.log(`❌ INSUFFICIENT properties for ARV calculation (need ≥3, have ${finalProperties.length})`);
}

console.log('\n📋 ALGORITHM SUMMARY:');
console.log('1. High-tier clustering: PPSF-based (z ≥ 1.0) + dual neighbor support (PPSF-close AND price-close)');
console.log('2. Fallback: Drop low PPSF outliers (z ≤ -1), then strict price-neighbor rule (≤ 7.5%)');
console.log('3. This matches your exact specification of the dual rule system');