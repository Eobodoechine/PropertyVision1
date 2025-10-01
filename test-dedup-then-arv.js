// Test deduplication then ARV calculation
import { ARVCalculator } from './src/server/arvCalculator.js';

async function testDedupThenARV() {
  console.log('🧮 TESTING DEDUP → ARV FLOW');
  console.log('===========================');

  const calculator = new ARVCalculator();

  // Subject property
  const subjectProperty = {
    address: "3128 McKenzie Rd, East Point, GA 30344",
    sqft: 2345
  };

  // Original 6 comps with duplicate (same coordinates)
  const sixComps = [
    {
      id: "C1",
      address: "2649 Headland Dr, East Point, GA 30344",
      price: 182500,
      sqft: 1915,
      saleDate: "2025-09-15",
      lat: 33.6946462,
      lng: -84.4630528
    },
    {
      id: "C2",
      address: "2649 Headland Dr, Atlanta, GA 30344", // Same property, different city name
      price: 182500,
      sqft: 1915,
      saleDate: "2025-09-15",
      lat: 33.6946462,
      lng: -84.4630528
    },
    {
      id: "C3",
      address: "2251 Headland Dr, East Point, GA 30344",
      price: 270000,
      sqft: 1850,
      saleDate: "2025-09-15",
      lat: 33.6950123,
      lng: -84.4635678
    },
    {
      id: "C4",
      address: "2221 Plantation Dr, East Point, GA 30344",
      price: 300000,
      sqft: 1938,
      saleDate: "2025-09-15",
      lat: 33.6955789,
      lng: -84.4640234
    },
    {
      id: "C5",
      address: "2815 Spain Dr, East Point, GA 30344",
      price: 325000,
      sqft: 2767,
      saleDate: "2025-09-15",
      lat: 33.6960456,
      lng: -84.4645891
    },
    {
      id: "C6",
      address: "2198 Plantation Dr, East Point, GA 30344",
      price: 320000,
      sqft: 2500,
      saleDate: "2025-09-15",
      lat: 33.6965123,
      lng: -84.4650234
    }
  ];

  console.log('\\n📊 ORIGINAL INPUT (6 comps):');
  sixComps.forEach((comp, i) => {
    const ppsf = comp.price / comp.sqft;
    console.log(`${i+1}. ${comp.id}: ${comp.address}`);
    console.log(`   💰 $${comp.price.toLocaleString()} | 🏠 ${comp.sqft} sqft | 📐 $${ppsf.toFixed(2)}/sqft`);
  });

  // Step 1: Call deduplication manually
  console.log('\\n🧹 STEP 1: MANUAL DEDUPLICATION TEST');
  const cleaned = calculator.cleanAndPrepare(sixComps);

  console.log(`\\n📊 AFTER DEDUP: ${cleaned.length} comps`);
  cleaned.forEach((comp, i) => {
    console.log(`${i+1}. ${comp.id}: ${comp.address} - $${comp.ppsf.toFixed(2)}/sqft`);
  });

  // Step 2: Run full ARV calculation
  console.log('\\n🧮 STEP 2: FULL ARV CALCULATION');
  const result = calculator.calculateARV(subjectProperty, sixComps);

  console.log('\\n📋 FINAL RESULT:');
  console.log('================');
  console.log(`🎯 METHOD: ${result.method_used}`);
  console.log(`📊 ARV: $${result.conservative?.arv_price?.toLocaleString()}`);
  console.log(`📐 PPSF: $${result.conservative?.arv_ppsf?.toFixed(2)}/sqft`);
  console.log(`🏠 COMPS USED: ${result.kept_comps?.length}`);

  console.log('\\n✅ KEPT COMPS:');
  result.kept_comps?.forEach(comp => {
    console.log(`   ${comp.id}: $${comp.ppsf?.toFixed(2)}/sqft (${comp.reason})`);
  });

  console.log('\\n❌ DROPPED COMPS:');
  result.dropped_comps?.forEach(comp => {
    console.log(`   ${comp.id}: ${comp.reason_codes?.join(', ')}`);
  });

  console.log('\\n🎯 EXPECTED CENTRALUPPERCHAIN RESULT:');
  console.log('After dedup: C1($95.31), C5($117.46), C6($128.00), C3($145.95), C4($154.81)');
  console.log('n=5, mid=2 (C6), lowerMaxGap=22.15');
  console.log('Chain: C6→C3→C4 = {$128.00, $145.95, $154.81}');
  console.log('Expected median: $145.95/sqft × 2345 sqft = $342,252');
}

testDedupThenARV();