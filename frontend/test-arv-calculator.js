// Test the new ARV Calculator implementation
import { ARVCalculator } from './src/server/arvCalculator.js';

async function testARVCalculator() {
  console.log('🧮 TESTING NEW ARV CALCULATOR');
  console.log('============================');

  // Subject property
  const subjectProperty = {
    address: "3128 McKenzie Rd, East Point, GA 30344",
    sqft: 2345
  };

  // 6 comps from our test case
  const sixComps = [
    {
      id: "C1",
      address: "2649 Headland Dr, East Point, GA 30344",
      price: 182500,
      sqft: 1915,
      saleDate: "2025-09-15"
    },
    {
      id: "C2",
      address: "2649 Headland Dr, Atlanta, GA 30344", // Same address as C1
      price: 182500,
      sqft: 1915,
      saleDate: "2025-09-15"
    },
    {
      id: "C3",
      address: "2251 Headland Dr, East Point, GA 30344",
      price: 270000,
      sqft: 1850,
      saleDate: "2025-09-15"
    },
    {
      id: "C4",
      address: "2221 Plantation Dr, East Point, GA 30344",
      price: 300000,
      sqft: 1938,
      saleDate: "2025-09-15"
    },
    {
      id: "C5",
      address: "2815 Spain Dr, East Point, GA 30344",
      price: 325000,
      sqft: 2767,
      saleDate: "2025-09-15"
    },
    {
      id: "C6",
      address: "2198 Plantation Dr, East Point, GA 30344",
      price: 320000,
      sqft: 2500,
      saleDate: "2025-09-15"
    }
  ];

  console.log('\\n📊 INPUT DATA:');
  console.log(`Subject: ${subjectProperty.address}`);
  console.log(`Subject SQFT: ${subjectProperty.sqft}`);
  console.log('\\nComparables:');
  sixComps.forEach((comp, i) => {
    const ppsf = comp.price / comp.sqft;
    console.log(`${i+1}. ${comp.address}`);
    console.log(`   💰 $${comp.price.toLocaleString()} | 🏠 ${comp.sqft} sqft | 📐 $${ppsf.toFixed(2)}/sqft`);
  });

  console.log('\\n🧮 RUNNING ARV CALCULATION...');
  console.log('=====================================');

  try {
    const calculator = new ARVCalculator();
    const result = calculator.calculateARV(subjectProperty, sixComps);

    console.log('\\n📋 CALCULATION RESULT:');
    console.log('======================');

    console.log(`\\n🎯 METHOD USED: ${result.method_used}`);
    console.log(`📊 ARV Estimate: $${result.conservative?.arv_price?.toLocaleString()}`);
    console.log(`📐 ARV PPSF: $${result.conservative?.arv_ppsf?.toFixed(2)}/sqft`);

    console.log('\\n✅ KEPT COMPS:');
    result.kept_comps?.forEach(comp => {
      console.log(`   ${comp.id}: ${comp.address}`);
      console.log(`      💰 $${comp.price?.toLocaleString()} | 🏠 ${comp.sqft} sqft | 📐 $${comp.ppsf?.toFixed(2)}/sqft`);
      console.log(`      📝 Reason: ${comp.reason}`);
    });

    console.log('\\n❌ DROPPED COMPS:');
    result.dropped_comps?.forEach(comp => {
      console.log(`   ${comp.id}: ${comp.reason_codes?.join(', ') || 'No specific reason'}`);
    });

    console.log('\\n🚩 FLAGS:');
    Object.entries(result.flags || {}).forEach(([flag, value]) => {
      console.log(`   ${flag}: ${value}`);
    });

    console.log('\\n📝 NOTES:');
    console.log(`   ${result.notes}`);

    // Expected result comparison
    console.log('\\n📊 EXPECTED VS ACTUAL:');
    console.log('========================');
    console.log('Based on our manual calculation:');
    console.log('- Sorted PPSF: C1(95.31), C5(117.46), C6(128.00), C3(145.95), C4(154.81)');
    console.log('- n=5 after dedup, mid=2 (C6), lowerMaxGap=22.15');
    console.log('- Chain from C6: gap to C3 (17.95 < 22.15) ✓, gap to C4 (8.86 < 22.15) ✓');
    console.log('- Expected chain: {C6, C3, C4} = {128.00, 145.95, 154.81}');
    console.log('- Expected median: 145.95');
    console.log('- Expected ARV: 145.95 × 2345 = $352,641');

    const actualARV = result.conservative?.arv_price || 0;
    const expectedARV = 352641;
    const isCorrect = actualARV === expectedARV;

    console.log(`\\n${isCorrect ? '✅' : '❌'} RESULT: $${actualARV.toLocaleString()} ${isCorrect ? '(CORRECT!)' : `(Expected: $${expectedARV.toLocaleString()})`}`);

    if (!isCorrect) {
      console.log('\\n🔍 DEBUGGING INFO:');
      console.log('Actual chain comps:', result.kept_comps?.map(c => `${c.id}($${c.ppsf?.toFixed(2)})`).join(', '));
      console.log('Actual median PPSF:', result.conservative?.arv_ppsf?.toFixed(2));
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testARVCalculator();