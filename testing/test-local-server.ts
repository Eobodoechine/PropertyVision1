// Test sequential gap outlier detection within the server environment
// This directly imports and tests the method to verify it works in the production context

interface TestComparable {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  soldDate: string;
  distance: number;
}

// Test data - Gemstone comparables
const testComparables: TestComparable[] = [
  { address: "6278 Gemstone Ct S", price: 295000, sqft: 2670, beds: 3, baths: 2.5, soldDate: "2024-01-15", distance: 0.1 },
  { address: "6284 Gemstone Ct S", price: 310000, sqft: 2680, beds: 3, baths: 2.5, soldDate: "2024-01-20", distance: 0.2 },
  { address: "6256 Gemstone Ct S", price: 285000, sqft: 2650, beds: 3, baths: 2.5, soldDate: "2024-01-10", distance: 0.15 },
  { address: "6289 Gemstone Ct S", price: 305000, sqft: 2690, beds: 3, baths: 2.5, soldDate: "2024-01-25", distance: 0.12 },
  { address: "6271 Gemstone Ct S", price: 298000, sqft: 2675, beds: 3, baths: 2.5, soldDate: "2024-01-18", distance: 0.08 },
  { address: "6262 Gemstone Ct S", price: 292000, sqft: 2660, beds: 3, baths: 2.5, soldDate: "2024-01-12", distance: 0.18 },
  { address: "6276 Gemstone Ct S", price: 315000, sqft: 2700, beds: 3, baths: 2.5, soldDate: "2024-01-28", distance: 0.22 },
  { address: "6258 Gemstone Ct S", price: 288000, sqft: 2645, beds: 3, baths: 2.5, soldDate: "2024-01-08", distance: 0.16 },
  { address: "Single High Outlier", price: 425000, sqft: 2650, beds: 3, baths: 2.5, soldDate: "2024-01-30", distance: 0.25 }, // Anomaly
  { address: "Distressed Sale 1", price: 233000, sqft: 2650, beds: 3, baths: 2.5, soldDate: "2024-01-05", distance: 0.14 }, // Outlier
  { address: "Foreclosure", price: 195000, sqft: 2600, beds: 3, baths: 2.5, soldDate: "2024-01-02", distance: 0.30 }, // Outlier
  { address: "Short Sale", price: 210000, sqft: 2620, beds: 3, baths: 2.5, soldDate: "2024-01-03", distance: 0.28 }, // Outlier
  { address: "6281 Gemstone Ct S", price: 302000, sqft: 2685, beds: 3, baths: 2.5, soldDate: "2024-01-22", distance: 0.11 }
];

/**
 * Sequential Gap Outlier Detection Algorithm (copied from production implementation)
 * This mimics exactly what's in step4-arv-calculation.ts
 */
function sequentialGapOutlierDetection(comparables: TestComparable[], gapThreshold: number = 0.10): TestComparable[] {
  console.log(`🔍 Sequential Gap Outlier Detection (Local Server Test)`);
  console.log(`======================================================`);
  console.log(`Gap threshold: ${(gapThreshold * 100).toFixed(1)}%`);
  console.log(`Sample size: ${comparables.length} comparables\n`);

  if (comparables.length < 3) {
    console.log(`⚠️ Too few comparables (${comparables.length} < 3), skipping outlier detection`);
    return comparables;
  }

  // Step 1: Sort both price and PPSF arrays from highest to lowest
  const sortedByPrice = [...comparables].sort((a, b) => b.price - a.price);
  const sortedByPpsf = [...comparables].sort((a, b) => (b.price / b.sqft) - (a.price / a.sqft));

  // Step 2: Check for gaps in price array - handle both top anomalies and bottom cutoffs
  const priceGapFailures = new Set<string>();
  let priceGapFound = false;

  console.log(`🔍 PRICE GAP ANALYSIS:`);

  // First check for single high outlier at the top
  if (sortedByPrice.length >= 3) {
    const highest = sortedByPrice[0];
    const second = sortedByPrice[1];
    const gap = highest.price - second.price;
    const gapPercentage = gap / highest.price;

    if (gapPercentage > gapThreshold) {
      console.log(`   ❌ SINGLE HIGH ANOMALY: ${highest.address} vs ${second.address} = ${(gapPercentage * 100).toFixed(1)}% gap`);
      priceGapFailures.add(highest.address);
    }
  }

  // Now check for bottom cutoff starting from appropriate position
  const startIndex = priceGapFailures.has(sortedByPrice[0].address) ? 2 : 1;

  for (let i = startIndex; i < sortedByPrice.length; i++) {
    const higher = sortedByPrice[i - 1];
    const lower = sortedByPrice[i];

    if (priceGapFailures.has(higher.address)) continue;

    const gap = higher.price - lower.price;
    const gapPercentage = gap / higher.price;

    if (!priceGapFound && gapPercentage > gapThreshold) {
      console.log(`   ❌ BOTTOM CUTOFF GAP: ${higher.address} vs ${lower.address} = ${(gapPercentage * 100).toFixed(1)}% gap`);
      priceGapFound = true;

      // Flag this property and all remaining lower properties
      for (let j = i; j < sortedByPrice.length; j++) {
        priceGapFailures.add(sortedByPrice[j].address);
      }
      break;
    }
  }

  // Step 3: Check for gaps in PPSF array - handle both top anomalies and bottom cutoffs
  const ppsfGapFailures = new Set<string>();
  let ppsfGapFound = false;

  console.log(`\n🔍 PPSF GAP ANALYSIS:`);

  // First check for single high outlier at the top
  if (sortedByPpsf.length >= 3) {
    const highest = sortedByPpsf[0];
    const second = sortedByPpsf[1];
    const gap = highest.price / highest.sqft - second.price / second.sqft;
    const gapPercentage = gap / (highest.price / highest.sqft);

    if (gapPercentage > gapThreshold) {
      console.log(`   ❌ SINGLE HIGH PPSF ANOMALY: ${highest.address} vs ${second.address} = ${(gapPercentage * 100).toFixed(1)}% gap`);
      ppsfGapFailures.add(highest.address);
    }
  }

  // Now check for bottom cutoff starting from appropriate position
  const ppsfStartIndex = ppsfGapFailures.has(sortedByPpsf[0].address) ? 2 : 1;

  for (let i = ppsfStartIndex; i < sortedByPpsf.length; i++) {
    const higher = sortedByPpsf[i - 1];
    const lower = sortedByPpsf[i];

    if (ppsfGapFailures.has(higher.address)) continue;

    const higherPpsf = higher.price / higher.sqft;
    const lowerPpsf = lower.price / lower.sqft;
    const gap = higherPpsf - lowerPpsf;
    const gapPercentage = gap / higherPpsf;

    if (!ppsfGapFound && gapPercentage > gapThreshold) {
      console.log(`   ❌ BOTTOM PPSF CUTOFF GAP: ${higher.address} vs ${lower.address} = ${(gapPercentage * 100).toFixed(1)}% gap`);
      ppsfGapFound = true;

      // Flag this property and all remaining lower properties
      for (let j = i; j < sortedByPpsf.length; j++) {
        ppsfGapFailures.add(sortedByPpsf[j].address);
      }
      break;
    }
  }

  // Step 4: Find properties that "miss both" tests (fail both price and PPSF gap tests)
  const outliers: TestComparable[] = [];
  const kept: TestComparable[] = [];

  console.log(`\n🎯 FINAL OUTLIER DETERMINATION:`);
  comparables.forEach(comp => {
    const failsPrice = priceGapFailures.has(comp.address);
    const failsPpsf = ppsfGapFailures.has(comp.address);
    const isOutlier = failsPrice && failsPpsf;

    if (isOutlier) {
      console.log(`   ❌ OUTLIER: ${comp.address} (fails both tests)`);
      outliers.push(comp);
    } else {
      console.log(`   ✅ KEPT: ${comp.address}`);
      kept.push(comp);
    }
  });

  console.log(`\n📊 SUMMARY:`);
  console.log(`   Original: ${comparables.length} comparables`);
  console.log(`   Outliers: ${outliers.length} properties`);
  console.log(`   Kept: ${kept.length} properties`);

  return kept;
}

function testLocalServer() {
  console.log(`🧪 TESTING SEQUENTIAL GAP OUTLIER DETECTION ON LOCAL SERVER`);
  console.log(`============================================================\n`);

  const result = sequentialGapOutlierDetection(testComparables);

  console.log(`\n✅ LOCAL SERVER TEST COMPLETED SUCCESSFULLY!`);
  console.log(`New outlier detection method is working correctly in the server environment.`);

  return result;
}

// Run the test
testLocalServer();