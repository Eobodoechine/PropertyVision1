// Fallback process: price/PPSF only
// Starting from z-scores we calculated

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

console.log('🔄 FALLBACK: Price/PPSF Only Process');
console.log('=====================================');

console.log('\n📊 Starting properties (with z-scores):');
propertiesWithZ.forEach(prop => {
  console.log(`${prop.address}: $${prop.price.toLocaleString()} | z=${prop.zScore.toFixed(2)}`);
});

// Step 1: Drop low outliers (z ≤ -1.0)
console.log('\n1️⃣ STEP 1: Drop low outliers (z ≤ -1.0)');

const afterLowOutlierRemoval = propertiesWithZ.filter(p => p.zScore > -1.0);
const droppedLowOutliers = propertiesWithZ.filter(p => p.zScore <= -1.0);

console.log(`\n✅ Kept properties (${afterLowOutlierRemoval.length}):`);
afterLowOutlierRemoval.forEach(prop => {
  console.log(`   ${prop.address}: z=${prop.zScore.toFixed(2)}, $${prop.price.toLocaleString()}`);
});

console.log(`\n❌ Dropped low outliers (${droppedLowOutliers.length}):`);
droppedLowOutliers.forEach(prop => {
  console.log(`   ${prop.address}: z=${prop.zScore.toFixed(2)}, $${prop.price.toLocaleString()}`);
});

// Step 2: Drop lone high-price outliers using different thresholds
console.log('\n2️⃣ STEP 2: Drop lone high-price outliers (price neighbor test)');

function testPriceIsolationThreshold(threshold: number, properties: PropertyWithZ[]) {
  console.log(`\n🔍 Testing ${(threshold * 100).toFixed(1)}% threshold:`);

  const finalProperties = [];
  const droppedIsolated = [];

  properties.forEach(candidate => {
    let hasNeighbor = false;
    let closestRatio = Infinity;
    let closestNeighbor = null;

    properties.forEach(other => {
      if (candidate === other) return;

      const priceDiff = Math.abs(candidate.price - other.price);
      const minPrice = Math.min(candidate.price, other.price);
      const priceRatio = priceDiff / minPrice;

      if (priceRatio < closestRatio) {
        closestRatio = priceRatio;
        closestNeighbor = other;
      }

      if (priceRatio <= threshold) {
        hasNeighbor = true;
      }
    });

    console.log(`   ${candidate.address} ($${candidate.price.toLocaleString()}): closest=${(closestRatio*100).toFixed(1)}% → ${hasNeighbor ? '✅ KEEP' : '❌ DROP'}`);

    if (hasNeighbor) {
      finalProperties.push(candidate);
    } else {
      droppedIsolated.push(candidate);
    }
  });

  return { finalProperties, droppedIsolated, threshold };
}

// Test different thresholds
const thresholds = [0.075, 0.10, 0.15, 0.20, 0.30];
const results = thresholds.map(threshold =>
  testPriceIsolationThreshold(threshold, afterLowOutlierRemoval)
);

// Step 3: ARV calculation for each threshold
console.log('\n3️⃣ STEP 3: ARV Calculation Results');

results.forEach(result => {
  const { finalProperties, threshold } = result;

  console.log(`\n📊 ${(threshold * 100).toFixed(1)}% threshold: ${finalProperties.length} final properties`);

  if (finalProperties.length >= 3) {
    const finalPpsf = finalProperties.map(p => p.ppsf).sort((a, b) => a - b);
    const finalMedianPpsf = finalPpsf[Math.floor(finalPpsf.length / 2)];
    const arv = finalMedianPpsf * subjectSqft;

    console.log('   ✅ SUFFICIENT for ARV calculation');
    console.log('   Final properties:');
    finalProperties.forEach(prop => {
      console.log(`      ${prop.address}: $${prop.ppsf.toFixed(2)}/sf`);
    });
    console.log(`   📊 Final PPSF values: [${finalPpsf.map(p => p.toFixed(2)).join(', ')}]`);
    console.log(`   📊 Median PPSF: $${finalMedianPpsf.toFixed(2)}/sf`);
    console.log(`   🏠 Subject sqft: ${subjectSqft.toLocaleString()}`);
    console.log(`   💰 ARV = $${finalMedianPpsf.toFixed(2)} × ${subjectSqft} = $${arv.toLocaleString()}`);
  } else {
    console.log(`   ❌ INSUFFICIENT for ARV (need ≥3, have ${finalProperties.length})`);
  }
});

// Find the most restrictive threshold that still yields ARV
console.log('\n🎯 RECOMMENDATION:');
const validResults = results.filter(r => r.finalProperties.length >= 3);

if (validResults.length > 0) {
  const mostRestrictive = validResults[0]; // First valid result = most restrictive
  const finalPpsf = mostRestrictive.finalProperties.map(p => p.ppsf).sort((a, b) => a - b);
  const finalMedianPpsf = finalPpsf[Math.floor(finalPpsf.length / 2)];
  const arv = finalMedianPpsf * subjectSqft;

  console.log(`Use ${(mostRestrictive.threshold * 100).toFixed(1)}% threshold for optimal balance of accuracy and conservatism`);
  console.log(`Final ARV: $${arv.toLocaleString()}`);
} else {
  console.log('❌ Even with relaxed thresholds, insufficient properties for ARV calculation');
  console.log('Consider expanding search radius or time window');
}