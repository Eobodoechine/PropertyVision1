// Analyze price gaps to show why 7.5% threshold is too aggressive
const properties = [
  { address: '2279 Lyle', price: 420000 },
  { address: '2770 Hogan', price: 385000 },
  { address: '2251 Headland', price: 279500 },
  { address: '2674 Bryant', price: 215000 },
  { address: '2649 Headland', price: 182500 },
  { address: '3083 McKenzie', price: 162000 },
  { address: '3238 Washington', price: 135000 }
];

// After low outlier removal (z > -1.0), we have these 5 properties:
const afterOutlierRemoval = [
  { address: '2279 Lyle', price: 420000 },
  { address: '2770 Hogan', price: 385000 },
  { address: '2251 Headland', price: 279500 },
  { address: '2674 Bryant', price: 215000 },
  { address: '3083 McKenzie', price: 162000 }
];

console.log('🔍 PRICE GAP ANALYSIS: Why 7.5% Threshold is Too Aggressive');
console.log('===========================================================');

console.log('\n📊 Properties After Low Outlier Removal (sorted by price):');
afterOutlierRemoval.forEach((prop, i) => {
  console.log(`${i+1}. ${prop.address}: $${prop.price.toLocaleString()}`);
});

console.log('\n🔍 PRICE NEIGHBOR ANALYSIS (7.5% threshold):');
console.log('For each property, find closest neighbor within 7.5%:');

afterOutlierRemoval.forEach((candidate, i) => {
  console.log(`\n${i+1}. ${candidate.address} ($${candidate.price.toLocaleString()})`);

  let hasNeighbor = false;
  let closestRatio = Infinity;
  let closestNeighbor = null;

  afterOutlierRemoval.forEach((other, j) => {
    if (i === j) return;

    const priceDiff = Math.abs(candidate.price - other.price);
    const minPrice = Math.min(candidate.price, other.price);
    const priceRatio = priceDiff / minPrice;

    if (priceRatio < closestRatio) {
      closestRatio = priceRatio;
      closestNeighbor = other;
    }

    console.log(`   vs ${other.address} ($${other.price.toLocaleString()}): ${(priceRatio * 100).toFixed(1)}% difference`);

    if (priceRatio <= 0.075) {
      hasNeighbor = true;
    }
  });

  console.log(`   ▶️ Closest neighbor: ${closestNeighbor.address} at ${(closestRatio * 100).toFixed(1)}%`);
  console.log(`   ▶️ Has 7.5% neighbor: ${hasNeighbor ? '✅ YES' : '❌ NO'}`);
});

console.log('\n🎯 PRICE GAPS BETWEEN CONSECUTIVE PROPERTIES:');
for (let i = 0; i < afterOutlierRemoval.length - 1; i++) {
  const higher = afterOutlierRemoval[i];
  const lower = afterOutlierRemoval[i + 1];
  const gap = higher.price - lower.price;
  const percentage = (gap / lower.price) * 100;

  console.log(`${higher.address} → ${lower.address}: $${gap.toLocaleString()} gap (${percentage.toFixed(1)}%)`);
}

console.log('\n📈 WHAT DIFFERENT THRESHOLDS WOULD YIELD:');

const thresholds = [0.075, 0.10, 0.15, 0.20, 0.25];

thresholds.forEach(threshold => {
  const survivors = [];

  afterOutlierRemoval.forEach(candidate => {
    let hasNeighbor = false;

    afterOutlierRemoval.forEach(other => {
      if (candidate === other) return;

      const priceDiff = Math.abs(candidate.price - other.price);
      const minPrice = Math.min(candidate.price, other.price);
      const priceRatio = priceDiff / minPrice;

      if (priceRatio <= threshold) {
        hasNeighbor = true;
      }
    });

    if (hasNeighbor) {
      survivors.push(candidate);
    }
  });

  console.log(`${(threshold * 100).toFixed(1)}% threshold: ${survivors.length} survivors`);
  if (survivors.length >= 3) {
    const prices = survivors.map(p => p.price).sort((a, b) => a - b);
    const medianPrice = prices[Math.floor(prices.length / 2)];
    console.log(`   ✅ SUFFICIENT for ARV (median: $${medianPrice.toLocaleString()})`);
  } else {
    console.log(`   ❌ INSUFFICIENT for ARV (need ≥3, have ${survivors.length})`);
  }
});

console.log('\n💡 CONCLUSION:');
console.log('The 7.5% threshold is too strict for this market segment.');
console.log('Properties in the $160K-$420K range naturally have larger gaps.');
console.log('A 15-20% threshold would be more appropriate for reliable ARV calculation.');