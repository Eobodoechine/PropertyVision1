// Compute PPSF and robust z-scores using MAD (Median Absolute Deviation)

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

console.log('📊 PPSF & ROBUST Z-SCORE CALCULATION (MAD)');
console.log('==========================================');

// Step 1: Calculate PPSF for each property
const propertiesWithPpsf = properties.map(prop => ({
  ...prop,
  ppsf: prop.price / prop.sqft
}));

console.log('\n1️⃣ STEP 1: Calculate PPSF');
propertiesWithPpsf.forEach((prop, i) => {
  console.log(`${prop.address}: $${prop.price.toLocaleString()} ÷ ${prop.sqft}sf = $${prop.ppsf.toFixed(2)}/sf`);
});

// Step 2: Sort PPSF values and find median
const ppsfValues = propertiesWithPpsf.map(p => p.ppsf).sort((a, b) => a - b);

console.log('\n2️⃣ STEP 2: Sorted PPSF ($/sf)');
console.log(`[${ppsfValues.map(ppsf => ppsf.toFixed(2)).join(', ')}]`);

const medianPpsf = ppsfValues[Math.floor(ppsfValues.length / 2)];
console.log(`\n📊 Median(PPSF) = $${medianPpsf.toFixed(2)}/sf`);

// Step 3: Calculate deviations from median
console.log('\n3️⃣ STEP 3: Calculate deviations from median');
const deviations = ppsfValues.map(ppsf => {
  const deviation = Math.abs(ppsf - medianPpsf);
  console.log(`|${ppsf.toFixed(2)} - ${medianPpsf.toFixed(2)}| = ${deviation.toFixed(2)}`);
  return deviation;
});

// Step 4: Calculate MAD (Median Absolute Deviation)
const sortedDeviations = deviations.sort((a, b) => a - b);
const mad = sortedDeviations[Math.floor(sortedDeviations.length / 2)];

console.log('\n4️⃣ STEP 4: Calculate MAD');
console.log(`Sorted deviations: [${sortedDeviations.map(d => d.toFixed(2)).join(', ')}]`);
console.log(`📊 MAD = ${mad.toFixed(2)}`);

// Step 5: Calculate robust z-scores
console.log('\n5️⃣ STEP 5: Calculate robust z-scores');
console.log('z ≈ 0.6745 × (PPSF - Median) / MAD');

const propertiesWithZ = propertiesWithPpsf.map(prop => {
  const zScore = 0.6745 * (prop.ppsf - medianPpsf) / mad;
  return { ...prop, zScore };
});

console.log('\n📊 FINAL RESULTS:');
console.log('Property | PPSF | z-score');
console.log('---------|------|--------');

propertiesWithZ
  .sort((a, b) => a.ppsf - b.ppsf) // Sort by PPSF for clarity
  .forEach(prop => {
    const zFormatted = prop.zScore >= 0 ? `+${prop.zScore.toFixed(2)}` : prop.zScore.toFixed(2);
    console.log(`${prop.address.padEnd(16)} | ${prop.ppsf.toFixed(2).padStart(6)} | ${zFormatted.padStart(6)}`);
  });

// Step 6: High-tier analysis (z ≥ 1.0)
console.log('\n6️⃣ STEP 6: High-tier check (z ≥ 1.0)');
const highTier = propertiesWithZ.filter(p => p.zScore >= 1.0);

if (highTier.length > 0) {
  console.log(`✅ High-tier properties found: ${highTier.length}`);
  highTier.forEach(prop => {
    console.log(`   ${prop.address}: z = ${prop.zScore.toFixed(2)}, $${prop.ppsf.toFixed(2)}/sf`);
  });
} else {
  console.log('❌ No high-tier properties (z ≥ 1.0)');
}

// Summary statistics
console.log('\n📈 SUMMARY STATISTICS:');
console.log(`Properties: ${properties.length}`);
console.log(`PPSF range: $${Math.min(...ppsfValues).toFixed(2)} - $${Math.max(...ppsfValues).toFixed(2)}`);
console.log(`Median PPSF: $${medianPpsf.toFixed(2)}`);
console.log(`MAD: ${mad.toFixed(2)}`);
console.log(`Z-score range: ${Math.min(...propertiesWithZ.map(p => p.zScore)).toFixed(2)} to ${Math.max(...propertiesWithZ.map(p => p.zScore)).toFixed(2)}`);

export { propertiesWithZ, medianPpsf, mad };