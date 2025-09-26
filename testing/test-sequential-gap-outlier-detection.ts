// Test sequential gap outlier detection on Gemstone property comparables
// Based on the 9 comps that passed existing outlier tests

interface TestComparable {
  address: string;
  price: number;
  sqft: number;
  ppsf: number;
}

// Test with single high outlier to verify top-end anomaly detection
const gemstoneComps: TestComparable[] = [
  { address: "6278 Gemstone Ct S", price: 295000, sqft: 2670, ppsf: 110.49 },
  { address: "6284 Gemstone Ct S", price: 310000, sqft: 2680, ppsf: 115.67 },
  { address: "6256 Gemstone Ct S", price: 285000, sqft: 2650, ppsf: 107.55 },
  { address: "6289 Gemstone Ct S", price: 305000, sqft: 2690, ppsf: 113.38 },
  { address: "6271 Gemstone Ct S", price: 298000, sqft: 2675, ppsf: 111.40 },
  { address: "6262 Gemstone Ct S", price: 292000, sqft: 2660, ppsf: 109.77 },
  { address: "6276 Gemstone Ct S", price: 315000, sqft: 2700, ppsf: 116.67 },
  { address: "6258 Gemstone Ct S", price: 288000, sqft: 2645, ppsf: 108.88 },
  { address: "Single High Outlier", price: 425000, sqft: 2650, ppsf: 160.38 }, // Anomaly at top
  { address: "Distressed Sale 1", price: 233000, sqft: 2650, ppsf: 87.92 }, // First outlier
  { address: "Foreclosure", price: 195000, sqft: 2600, ppsf: 75.00 }, // Second outlier
  { address: "Short Sale", price: 210000, sqft: 2620, ppsf: 80.15 }, // Third outlier
  { address: "6281 Gemstone Ct S", price: 302000, sqft: 2685, ppsf: 112.48 }
];

/**
 * Sequential Gap Outlier Detection Algorithm
 * 1. Sort both price and PPSF arrays separately
 * 2. Check for >10% gaps between adjacent values in each sorted array
 * 3. Flag properties that "miss both" tests as outliers
 */
function sequentialGapOutlierDetection(comps: TestComparable[], gapThreshold: number = 0.10): {
  outliers: TestComparable[];
  kept: TestComparable[];
  priceGapFailures: TestComparable[];
  ppsfGapFailures: TestComparable[];
  analysis: {
    priceGaps: Array<{address: string, gap: number, percentage: number}>;
    ppsfGaps: Array<{address: string, gap: number, percentage: number}>;
  };
} {
  console.log(`\\n🔍 SEQUENTIAL GAP OUTLIER DETECTION`);
  console.log(`===================================================`);
  console.log(`Gap threshold: ${(gapThreshold * 100).toFixed(1)}%`);
  console.log(`Sample size: ${comps.length} comparables\\n`);

  // Step 1: Sort prices and PPSF arrays separately (highest to lowest)
  const sortedByPrice = [...comps].sort((a, b) => b.price - a.price);
  const sortedByPpsf = [...comps].sort((a, b) => b.ppsf - a.ppsf);

  console.log(`📊 SORTED BY PRICE:`);
  sortedByPrice.forEach((comp, i) => {
    console.log(`   ${i + 1}. ${comp.address}: $${comp.price.toLocaleString()}`);
  });

  console.log(`\\n📊 SORTED BY PPSF:`);
  sortedByPpsf.forEach((comp, i) => {
    console.log(`   ${i + 1}. ${comp.address}: $${comp.ppsf.toFixed(2)}/sqft`);
  });

  // Step 2: Check for gaps in price array - handle both top anomalies and bottom cutoffs
  const priceGapFailures = new Set<string>();
  const priceGaps: Array<{address: string, gap: number, percentage: number}> = [];
  let priceGapFound = false;

  console.log(`\\n🔍 PRICE GAP ANALYSIS (remove single top anomalies and everything below first big gap):`);

  // First check for single high outlier at the top
  if (sortedByPrice.length >= 3) {
    const highest = sortedByPrice[0];
    const second = sortedByPrice[1];
    const gap = highest.price - second.price;
    const gapPercentage = gap / highest.price;

    if (gapPercentage > gapThreshold) {
      console.log(`   ❌ SINGLE HIGH ANOMALY DETECTED: ${highest.address} ($${highest.price.toLocaleString()}) vs ${second.address} ($${second.price.toLocaleString()}) = ${(gapPercentage * 100).toFixed(1)}% gap`);
      console.log(`   🔺 REMOVING TOP ANOMALY: ${highest.address}`);
      priceGapFailures.add(highest.address);
      // Continue checking from second property down
    }
  }

  // Now check for bottom cutoff starting from appropriate position
  const startIndex = priceGapFailures.has(sortedByPrice[0].address) ? 2 : 1;

  for (let i = startIndex; i < sortedByPrice.length; i++) {
    const higher = sortedByPrice[i - 1]; // Higher price (previous in sorted array)
    const lower = sortedByPrice[i];      // Lower price (current in sorted array)

    // Skip if higher property was already removed as top anomaly
    if (priceGapFailures.has(higher.address)) continue;

    const gap = higher.price - lower.price;
    const gapPercentage = gap / higher.price;

    priceGaps.push({ address: lower.address, gap, percentage: gapPercentage });

    if (!priceGapFound && gapPercentage > gapThreshold) {
      console.log(`   ❌ BOTTOM CUTOFF GAP DETECTED: ${higher.address} ($${higher.price.toLocaleString()}) vs ${lower.address} ($${lower.price.toLocaleString()}) = ${(gapPercentage * 100).toFixed(1)}% gap`);
      console.log(`   🔻 REMOVING ALL PROPERTIES FROM HERE DOWN:`);
      priceGapFound = true;

      // Flag this property and all remaining lower properties
      for (let j = i; j < sortedByPrice.length; j++) {
        priceGapFailures.add(sortedByPrice[j].address);
        console.log(`      ❌ REMOVED: ${sortedByPrice[j].address} ($${sortedByPrice[j].price.toLocaleString()})`);
      }
      break; // Stop checking once we find the first gap
    } else if (!priceGapFound) {
      console.log(`   ✅ Price OK: ${higher.address} ($${higher.price.toLocaleString()}) vs ${lower.address} ($${lower.price.toLocaleString()}) = ${(gapPercentage * 100).toFixed(1)}% gap`);
    }
  }

  // Step 3: Check for gaps in PPSF array - handle both top anomalies and bottom cutoffs
  const ppsfGapFailures = new Set<string>();
  const ppsfGaps: Array<{address: string, gap: number, percentage: number}> = [];
  let ppsfGapFound = false;

  console.log(`\\n🔍 PPSF GAP ANALYSIS (remove single top anomalies and everything below first big gap):`);

  // First check for single high outlier at the top
  if (sortedByPpsf.length >= 3) {
    const highest = sortedByPpsf[0];
    const second = sortedByPpsf[1];
    const gap = highest.ppsf - second.ppsf;
    const gapPercentage = gap / highest.ppsf;

    if (gapPercentage > gapThreshold) {
      console.log(`   ❌ SINGLE HIGH PPSF ANOMALY DETECTED: ${highest.address} ($${highest.ppsf.toFixed(2)}/sqft) vs ${second.address} ($${second.ppsf.toFixed(2)}/sqft) = ${(gapPercentage * 100).toFixed(1)}% gap`);
      console.log(`   🔺 REMOVING TOP PPSF ANOMALY: ${highest.address}`);
      ppsfGapFailures.add(highest.address);
      // Continue checking from second property down
    }
  }

  // Now check for bottom cutoff starting from appropriate position
  const ppsfStartIndex = ppsfGapFailures.has(sortedByPpsf[0].address) ? 2 : 1;

  for (let i = ppsfStartIndex; i < sortedByPpsf.length; i++) {
    const higher = sortedByPpsf[i - 1]; // Higher PPSF (previous in sorted array)
    const lower = sortedByPpsf[i];      // Lower PPSF (current in sorted array)

    // Skip if higher property was already removed as top anomaly
    if (ppsfGapFailures.has(higher.address)) continue;

    const gap = higher.ppsf - lower.ppsf;
    const gapPercentage = gap / higher.ppsf;

    ppsfGaps.push({ address: lower.address, gap, percentage: gapPercentage });

    if (!ppsfGapFound && gapPercentage > gapThreshold) {
      console.log(`   ❌ BOTTOM PPSF CUTOFF GAP DETECTED: ${higher.address} ($${higher.ppsf.toFixed(2)}/sqft) vs ${lower.address} ($${lower.ppsf.toFixed(2)}/sqft) = ${(gapPercentage * 100).toFixed(1)}% gap`);
      console.log(`   🔻 REMOVING ALL PROPERTIES FROM HERE DOWN:`);
      ppsfGapFound = true;

      // Flag this property and all remaining lower properties
      for (let j = i; j < sortedByPpsf.length; j++) {
        ppsfGapFailures.add(sortedByPpsf[j].address);
        console.log(`      ❌ REMOVED: ${sortedByPpsf[j].address} ($${sortedByPpsf[j].ppsf.toFixed(2)}/sqft)`);
      }
      break; // Stop checking once we find the first gap
    } else if (!ppsfGapFound) {
      console.log(`   ✅ PPSF OK: ${higher.address} ($${higher.ppsf.toFixed(2)}/sqft) vs ${lower.address} ($${lower.ppsf.toFixed(2)}/sqft) = ${(gapPercentage * 100).toFixed(1)}% gap`);
    }
  }

  // Step 4: Find properties that "miss both" tests (fail both price and PPSF gap tests)
  const outliers: TestComparable[] = [];
  const kept: TestComparable[] = [];

  console.log(`\\n🎯 FINAL OUTLIER DETERMINATION:`);
  comps.forEach(comp => {
    const failsPrice = priceGapFailures.has(comp.address);
    const failsPpsf = ppsfGapFailures.has(comp.address);
    const isOutlier = failsPrice && failsPpsf;

    if (isOutlier) {
      console.log(`   ❌ OUTLIER: ${comp.address} (fails both price and PPSF gap tests)`);
      outliers.push(comp);
    } else {
      console.log(`   ✅ KEPT: ${comp.address} (${failsPrice ? 'fails price' : 'passes price'}, ${failsPpsf ? 'fails PPSF' : 'passes PPSF'})`);
      kept.push(comp);
    }
  });

  console.log(`\\n📊 SUMMARY:`);
  console.log(`   Original: ${comps.length} comparables`);
  console.log(`   Outliers: ${outliers.length} properties`);
  console.log(`   Kept: ${kept.length} properties`);
  console.log(`   Price gap failures: ${priceGapFailures.size} properties`);
  console.log(`   PPSF gap failures: ${ppsfGapFailures.size} properties`);

  return {
    outliers,
    kept,
    priceGapFailures: comps.filter(c => priceGapFailures.has(c.address)),
    ppsfGapFailures: comps.filter(c => ppsfGapFailures.has(c.address)),
    analysis: { priceGaps, ppsfGaps }
  };
}

// Test with different gap thresholds
function runTests() {
  console.log(`🧪 TESTING SEQUENTIAL GAP OUTLIER DETECTION ON GEMSTONE COMPS`);
  console.log(`================================================================`);

  // Test with 10% threshold (your original specification)
  const result10 = sequentialGapOutlierDetection(gemstoneComps, 0.10);

  console.log(`\\n\\n🧪 TESTING WITH 5% THRESHOLD (more strict)`);
  console.log(`================================================`);
  const result5 = sequentialGapOutlierDetection(gemstoneComps, 0.05);

  console.log(`\\n\\n🧪 TESTING WITH 15% THRESHOLD (more lenient)`);
  console.log(`=================================================`);
  const result15 = sequentialGapOutlierDetection(gemstoneComps, 0.15);

  console.log(`\\n\\n📊 THRESHOLD COMPARISON:`);
  console.log(`========================`);
  console.log(`5% threshold:  ${result5.outliers.length} outliers, ${result5.kept.length} kept`);
  console.log(`10% threshold: ${result10.outliers.length} outliers, ${result10.kept.length} kept`);
  console.log(`15% threshold: ${result15.outliers.length} outliers, ${result15.kept.length} kept`);
}

// Run the test
runTests();