// Strict neighbor rule based on PPSF instead of absolute price

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

const afterLowOutlierRemoval: PropertyWithZ[] = [
  { address: '2251 Headland', price: 279500, sqft: 1915, beds: 3, baths: 2, year_built: 1954, ppsf: 145.95, zScore: -0.41 },
  { address: '2674 Bryant', price: 215000, sqft: 1381, beds: 4, baths: 2, year_built: 1960, ppsf: 155.68, zScore: 0.00 },
  { address: '3083 McKenzie', price: 162000, sqft: 1023, beds: 3, baths: 1, year_built: 1955, ppsf: 158.36, zScore: 0.11 },
  { address: '2770 Hogan', price: 385000, sqft: 2240, beds: 4, baths: 3, year_built: 1962, ppsf: 171.88, zScore: 0.67 },
  { address: '2279 Lyle', price: 420000, sqft: 2022, beds: 4, baths: 3, year_built: 1965, ppsf: 207.72, zScore: 2.17 }
];

const subjectSqft = 2345;

console.log('🔍 STRICT NEIGHBOR RULE: PPSF-Based Analysis');
console.log('=============================================');

console.log('\n📊 Properties after low outlier removal (sorted by PPSF):');
const sortedByPpsf = [...afterLowOutlierRemoval].sort((a, b) => a.ppsf - b.ppsf);
sortedByPpsf.forEach((prop, i) => {
  console.log(`${i+1}. ${prop.address}: $${prop.ppsf.toFixed(2)}/sf ($${prop.price.toLocaleString()})`);
});

console.log('\n🔍 PPSF GAP ANALYSIS:');
for (let i = 0; i < sortedByPpsf.length - 1; i++) {
  const higher = sortedByPpsf[i + 1];
  const lower = sortedByPpsf[i];
  const ppsfGap = higher.ppsf - lower.ppsf;
  const percentage = (ppsfGap / lower.ppsf) * 100;

  console.log(`${lower.address} → ${higher.address}: $${ppsfGap.toFixed(2)}/sf gap (${percentage.toFixed(1)}%)`);
}

function testPpsfNeighborRule(threshold: number, properties: PropertyWithZ[]) {
  console.log(`\n🔍 Testing ${(threshold * 100).toFixed(1)}% PPSF threshold:`);

  const finalProperties = [];
  const droppedIsolated = [];

  properties.forEach(candidate => {
    let hasNeighbor = false;
    let closestRatio = Infinity;
    let closestNeighbor = null;

    properties.forEach(other => {
      if (candidate === other) return;

      const ppsfDiff = Math.abs(candidate.ppsf - other.ppsf);
      const minPpsf = Math.min(candidate.ppsf, other.ppsf);
      const ppsfRatio = ppsfDiff / minPpsf;

      if (ppsfRatio < closestRatio) {
        closestRatio = ppsfRatio;
        closestNeighbor = other;
      }

      if (ppsfRatio <= threshold) {
        hasNeighbor = true;
      }
    });

    const status = hasNeighbor ? '✅ KEEP' : '❌ DROP';
    console.log(`   ${candidate.address} ($${candidate.ppsf.toFixed(2)}/sf): closest PPSF neighbor=${(closestRatio*100).toFixed(1)}% → ${status}`);

    if (hasNeighbor) {
      finalProperties.push(candidate);
    } else {
      droppedIsolated.push(candidate);
    }
  });

  return { finalProperties, droppedIsolated, threshold };
}

// Test different PPSF thresholds
console.log('\n2️⃣ STEP 2: PPSF Neighbor Rule Testing');

const ppsfThresholds = [0.075, 0.10, 0.15, 0.20, 0.30];
const ppsfResults = ppsfThresholds.map(threshold =>
  testPpsfNeighborRule(threshold, afterLowOutlierRemoval)
);

// ARV calculation for each PPSF threshold
console.log('\n3️⃣ STEP 3: ARV Calculation with PPSF Neighbor Rule');

ppsfResults.forEach(result => {
  const { finalProperties, threshold } = result;

  console.log(`\n📊 ${(threshold * 100).toFixed(1)}% PPSF threshold: ${finalProperties.length} final properties`);

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
    console.log(`   💰 ARV = $${finalMedianPpsf.toFixed(2)} × ${subjectSqft} = $${arv.toLocaleString()}`);
  } else {
    console.log(`   ❌ INSUFFICIENT for ARV (need ≥3, have ${finalProperties.length})`);
  }
});

// Compare PPSF vs Price neighbor rules
console.log('\n🆚 COMPARISON: PPSF vs Price Neighbor Rules');

console.log('\nPrice-based neighbor gaps:');
afterLowOutlierRemoval.sort((a, b) => a.price - b.price).forEach((prop, i, arr) => {
  if (i < arr.length - 1) {
    const next = arr[i + 1];
    const priceGap = next.price - prop.price;
    const pricePercentage = (priceGap / prop.price) * 100;
    console.log(`${prop.address} → ${next.address}: ${pricePercentage.toFixed(1)}% price gap`);
  }
});

console.log('\nPPSF-based neighbor gaps:');
afterLowOutlierRemoval.sort((a, b) => a.ppsf - b.ppsf).forEach((prop, i, arr) => {
  if (i < arr.length - 1) {
    const next = arr[i + 1];
    const ppsfGap = next.ppsf - prop.ppsf;
    const ppsfPercentage = (ppsfGap / prop.ppsf) * 100;
    console.log(`${prop.address} → ${next.address}: ${ppsfPercentage.toFixed(1)}% PPSF gap`);
  }
});

// Find optimal PPSF threshold
console.log('\n🎯 OPTIMAL PPSF THRESHOLD:');
const validPpsfResults = ppsfResults.filter(r => r.finalProperties.length >= 3);

if (validPpsfResults.length > 0) {
  const mostRestrictive = validPpsfResults[0];
  const finalPpsf = mostRestrictive.finalProperties.map(p => p.ppsf).sort((a, b) => a - b);
  const finalMedianPpsf = finalPpsf[Math.floor(finalPpsf.length / 2)];
  const arv = finalMedianPpsf * subjectSqft;

  console.log(`✅ Use ${(mostRestrictive.threshold * 100).toFixed(1)}% PPSF threshold`);
  console.log(`   Properties: ${mostRestrictive.finalProperties.length}`);
  console.log(`   ARV: $${arv.toLocaleString()}`);
  console.log(`   This is more logical than price-based because PPSF normalizes for property size`);
} else {
  console.log('❌ No PPSF threshold yields sufficient properties');
}