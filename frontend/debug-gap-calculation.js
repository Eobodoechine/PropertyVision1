// Step 1: Controlled test with your exact gap calculation scenario
import { ARVCalculator } from './src/server/arvCalculator.js';

async function debugGapCalculation() {
  console.log('🐛 DEBUG: GAP CALCULATION ANALYSIS');
  console.log('===================================');

  const calculator = new ARVCalculator();

  // Your exact scenario: gaps[0] = 117.46 - 95.30 = 22.16
  const subjectProperty = {
    address: "Test Property",
    sqft: 2345
  };

  // Controlled test data matching your gap calculation
  const testComps = [
    {
      id: "C1",
      address: "Comp 1 - Low",
      price: 95.30 * 2345, // $95.30/sqft
      sqft: 2345,
      saleDate: "2025-09-15",
      lat: 33.6946462,
      lng: -84.4630528
    },
    {
      id: "C2",
      address: "Comp 2 - Mid-Low",
      price: 117.46 * 2345, // $117.46/sqft
      sqft: 2345,
      saleDate: "2025-09-15",
      lat: 33.6950123,
      lng: -84.4635678
    },
    {
      id: "C3",
      address: "Comp 3 - Mid",
      price: 128.00 * 2345, // $128.00/sqft
      sqft: 2345,
      saleDate: "2025-09-15",
      lat: 33.6955789,
      lng: -84.4640234
    },
    {
      id: "C4",
      address: "Comp 4 - Mid-High",
      price: 145.95 * 2345, // $145.95/sqft
      sqft: 2345,
      saleDate: "2025-09-15",
      lat: 33.6960456,
      lng: -84.4645891
    },
    {
      id: "C5",
      address: "Comp 5 - High",
      price: 154.80 * 2345, // $154.80/sqft
      sqft: 2345,
      saleDate: "2025-09-15",
      lat: 33.6965123,
      lng: -84.4650234
    }
  ];

  console.log('\n📊 CONTROLLED TEST DATA:');
  console.log('Expected PPSF sequence: 95.30, 117.46, 128.00, 145.95, 154.80');
  console.log('Expected gaps: [22.16, 10.54, 17.95, 8.85]');
  console.log('Expected largest gap: 22.16 at index 0');
  console.log('Expected action: Remove isolated low (95.30)');

  testComps.forEach((comp, i) => {
    const ppsf = comp.price / comp.sqft;
    console.log(`${comp.id}: $${comp.price.toLocaleString()} | ${comp.sqft}sqft | $${ppsf.toFixed(2)}/sqft`);
  });

  console.log('\n🔍 STEP-BY-STEP DEBUG:');
  console.log('======================');

  // Step 1: Raw data validation
  console.log('\n1️⃣ RAW DATA VALIDATION:');
  const rawPPSF = testComps.map(comp => comp.price / comp.sqft);
  console.log('Raw PPSF values:', rawPPSF.map(p => p.toFixed(2)));

  // Step 2: Test deduplication
  console.log('\n2️⃣ DEDUPLICATION TEST:');
  const cleaned = calculator.cleanAndPrepare(testComps);
  console.log(`Input: ${testComps.length} comps → Output: ${cleaned.length} comps`);
  cleaned.forEach(comp => {
    console.log(`${comp.id}: $${comp.ppsf.toFixed(2)}/sqft`);
  });

  // Step 3: Sort and gap calculation
  console.log('\n3️⃣ SORTING & GAP ANALYSIS:');
  const sorted = [...cleaned].sort((a, b) => a.ppsf - b.ppsf);
  console.log('Sorted PPSF:', sorted.map(c => `${c.id}($${c.ppsf.toFixed(2)})`).join(', '));

  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].ppsf - sorted[i].ppsf;
    gaps.push(gap);
    console.log(`gaps[${i}] = ${sorted[i + 1].ppsf.toFixed(2)} - ${sorted[i].ppsf.toFixed(2)} = ${gap.toFixed(2)}`);
  }

  const maxGap = Math.max(...gaps);
  const maxGapIndex = gaps.indexOf(maxGap);
  console.log(`Largest gap: ${maxGap.toFixed(2)} at index ${maxGapIndex}`);

  // Step 4: Full ARV calculation
  console.log('\n4️⃣ FULL ARV CALCULATION:');
  const result = calculator.calculateARV(subjectProperty, testComps);

  console.log('\n📋 SYSTEM RESULT:');
  console.log(`Method: ${result.method_used}`);
  console.log(`ARV: $${result.conservative?.arv_price?.toLocaleString()}`);
  console.log(`PPSF: $${result.conservative?.arv_ppsf?.toFixed(2)}/sqft`);
  console.log(`Comps used: ${result.kept_comps?.length}`);

  console.log('\n✅ KEPT COMPS:');
  result.kept_comps?.forEach(comp => {
    console.log(`   ${comp.id}: $${comp.ppsf?.toFixed(2)}/sqft (${comp.reason})`);
  });

  console.log('\n❌ DROPPED COMPS:');
  result.dropped_comps?.forEach(comp => {
    console.log(`   ${comp.id}: ${comp.reason_codes?.join(', ')}`);
  });

  // Step 5: Compare with expected
  console.log('\n5️⃣ EXPECTED vs ACTUAL:');
  console.log('Expected: Remove C1 (95.30), keep C2-C5, use CentralUpperChain');
  console.log('Expected final PPSF values: 117.46, 128.00, 145.95, 154.80');

  const actualKeptPPSF = result.kept_comps?.map(c => c.ppsf?.toFixed(2)).join(', ');
  console.log(`Actual kept PPSF: ${actualKeptPPSF}`);

  // Check if low was removed
  const removedLow = result.dropped_comps?.some(c => c.id === 'C1');
  console.log(`✅ Low comp (C1) removed: ${removedLow ? 'YES' : 'NO'}`);

  return result;
}

debugGapCalculation().catch(console.error);