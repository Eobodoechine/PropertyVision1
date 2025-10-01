// Exact implementation of your specified algorithm

interface Property {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  year_built: number;
}

const properties: Property[] = [
  { address: '3238 Washington', price: 135000, sqft: 1978, beds: 3, baths: 2, year_built: 1960 },
  { address: '2649 Headland', price: 182500, sqft: 1915, beds: 3, baths: 3, year_built: 1954 },
  { address: '2251 Headland', price: 279500, sqft: 1915, beds: 3, baths: 2, year_built: 1954 },
  { address: '2674 Bryant', price: 215000, sqft: 1381, beds: 4, baths: 2, year_built: 1960 },
  { address: '3083 McKenzie', price: 162000, sqft: 1023, beds: 3, baths: 1, year_built: 1955 },
  { address: '2770 Hogan', price: 385000, sqft: 2240, beds: 4, baths: 3, year_built: 1962 },
  { address: '2279 Lyle', price: 420000, sqft: 2022, beds: 4, baths: 3, year_built: 1965 }
];

const subjectSqft = 2345;

console.log('🔍 EXACT ALGORITHM IMPLEMENTATION');
console.log('=================================');

// 1) Prep: compute PPSF and robust z
console.log('\n1️⃣ PREP: Compute PPSF and robust z');

const ppsf = properties.map(r => r.price / r.sqft);
console.log('PPSF values:', ppsf.map(p => p.toFixed(2)));

// Median
const sortedPpsf = [...ppsf].sort((a, b) => a - b);
const m = sortedPpsf[Math.floor(sortedPpsf.length / 2)];
console.log(`Median m = ${m.toFixed(2)}`);

// MAD
const absDeviations = ppsf.map(p => Math.abs(p - m));
const sortedAbsDeviations = absDeviations.sort((a, b) => a - b);
const mad = sortedAbsDeviations[Math.floor(sortedAbsDeviations.length / 2)];
console.log(`MAD = ${mad.toFixed(2)}`);

// Robust z
const z = ppsf.map(p => 0.6745 * (p - m) / mad);
console.log('Z-scores:', z.map(zi => zi.toFixed(2)));

console.log('\nProperty summary:');
properties.forEach((prop, i) => {
  console.log(`${prop.address}: $${prop.price.toLocaleString()} | $${ppsf[i].toFixed(2)}/sf | z=${z[i].toFixed(2)}`);
});

// 2) Try for a supported high cluster
console.log('\n2️⃣ TRY FOR SUPPORTED HIGH CLUSTER');

const highIdx = [];
z.forEach((zi, i) => {
  if (zi >= 1.0) {
    highIdx.push(i);
  }
});

console.log(`High-tier candidates (z ≥ 1.0): ${highIdx.length}`);
highIdx.forEach(i => {
  console.log(`  ${properties[i].address}: z=${z[i].toFixed(2)}`);
});

const keptHigh = [];

if (highIdx.length > 0) {
  console.log('\nChecking support for high-tier candidates:');

  for (const i of highIdx) {
    console.log(`\nChecking ${properties[i].address}:`);

    let support = 0;

    for (const j of highIdx) {
      if (j === i) continue;

      // PPSF-close: |z_i - z_j| ≤ 0.5
      const zDiff = Math.abs(z[i] - z[j]);
      const ppsfClose = zDiff <= 0.5;

      // Price-close: |price_i - price_j| / min(price_i, price_j) ≤ 0.075
      const priceDiff = Math.abs(properties[i].price - properties[j].price);
      const minPrice = Math.min(properties[i].price, properties[j].price);
      const priceRatio = priceDiff / minPrice;
      const priceClose = priceRatio <= 0.075;

      const bothConditions = ppsfClose && priceClose;

      console.log(`  vs ${properties[j].address}: z-diff=${zDiff.toFixed(3)} (${ppsfClose ? '✅' : '❌'}), price-diff=${(priceRatio*100).toFixed(1)}% (${priceClose ? '✅' : '❌'}) → ${bothConditions ? '✅' : '❌'}`);

      if (bothConditions) {
        support++;
      }
    }

    console.log(`  Support count: ${support} (need ≥2)`);

    if (support >= 2) {
      keptHigh.push(i);
      console.log(`  ✅ ${properties[i].address} KEPT (has sufficient support)`);
    } else {
      console.log(`  ❌ ${properties[i].address} DROPPED (insufficient support)`);
    }
  }
}

console.log(`\nKept high-tier properties: ${keptHigh.length}`);

let used = [];

if (keptHigh.length >= 3) {
  used = keptHigh;
  console.log('✅ HIGH CLUSTER SUCCESS - using high-tier properties');
} else {
  console.log('❌ NO HIGH CLUSTER → Proceeding to fallback');

  // 3) Fallback (strict neighbor)
  console.log('\n3️⃣ FALLBACK: Strict neighbor');

  // (a) Drop low PPSF outliers: z ≤ -1.0
  console.log('\nStep 3a: Drop low PPSF outliers (z ≤ -1.0)');

  const afterLowDrop = [];
  properties.forEach((prop, i) => {
    if (z[i] > -1.0) {
      afterLowDrop.push(i);
      console.log(`  ✅ Kept: ${prop.address} (z=${z[i].toFixed(2)})`);
    } else {
      console.log(`  ❌ Dropped: ${prop.address} (z=${z[i].toFixed(2)})`);
    }
  });

  console.log(`Properties after low outlier removal: ${afterLowDrop.length}`);

  // (b) Drop lone high-price outliers: no neighbor with price within 7.5%
  console.log('\nStep 3b: Drop lone high-price outliers (strict price neighbor ≤ 7.5%)');

  const finalUsed = [];

  for (const i of afterLowDrop) {
    console.log(`\nChecking ${properties[i].address} ($${properties[i].price.toLocaleString()}):`);

    let hasNeighbor = false;

    for (const j of afterLowDrop) {
      if (j === i) continue;

      const priceDiff = Math.abs(properties[i].price - properties[j].price);
      const minPrice = Math.min(properties[i].price, properties[j].price);
      const priceRatio = priceDiff / minPrice;

      console.log(`  vs ${properties[j].address} ($${properties[j].price.toLocaleString()}): ${(priceRatio*100).toFixed(1)}% ${priceRatio <= 0.075 ? '✅' : '❌'}`);

      if (priceRatio <= 0.075) {
        hasNeighbor = true;
      }
    }

    if (hasNeighbor) {
      finalUsed.push(i);
      console.log(`  ✅ KEPT: ${properties[i].address} (has price neighbor)`);
    } else {
      console.log(`  ❌ DROPPED: ${properties[i].address} (no price neighbor)`);
    }
  }

  used = finalUsed;
}

console.log(`\nFinal properties for ARV: ${used.length}`);
used.forEach(i => {
  console.log(`  ${properties[i].address}: $${ppsf[i].toFixed(2)}/sf`);
});

// 4) Compute ARV (PPSF-based)
console.log('\n4️⃣ COMPUTE ARV');

if (used.length >= 2) {  // Accept ≥2 for thin market as you specified
  const arvPpsf = used.map(i => ppsf[i]).sort((a, b) => a - b);
  const arvMedianPpsf = arvPpsf[Math.floor(arvPpsf.length / 2)];
  const arv = arvMedianPpsf * subjectSqft;

  console.log('✅ SUFFICIENT properties for ARV calculation');
  console.log(`PPSF values: [${arvPpsf.map(p => p.toFixed(2)).join(', ')}]`);
  console.log(`Median PPSF: $${arvMedianPpsf.toFixed(2)}/sf`);
  console.log(`Subject sqft: ${subjectSqft.toLocaleString()}`);
  console.log(`ARV = ${arvMedianPpsf.toFixed(2)} × ${subjectSqft} = $${arv.toLocaleString()}`);

  console.log('\n🎯 FINAL RESULT:');
  console.log(`ARV: $${Math.round(arv).toLocaleString()}`);

} else {
  console.log(`❌ INSUFFICIENT properties for ARV (need ≥2, have ${used.length})`);
}

console.log('\n📋 ALGORITHM COMPLETED');
console.log('Following your exact specification:');
console.log('1. Compute PPSF and robust z-scores using MAD');
console.log('2. Try for supported high cluster (z ≥ 1.0 + dual neighbor support)');
console.log('3. Fallback: drop low PPSF outliers + strict price neighbor rule');
console.log('4. Compute ARV using median PPSF of remaining properties');