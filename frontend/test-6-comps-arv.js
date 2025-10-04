// Test 6 comps ARV calculation with Vertex AI
import 'dotenv/config';

async function test6CompsARV() {
  console.log('🧮 TESTING 6 COMPS ARV CALCULATION');
  console.log('=====================================');

  // Subject property
  const subjectProperty = {
    address: "3128 McKenzie Rd, East Point, GA 30344",
    sqft: 2345,
    beds: 4,
    baths: 3,
    year_built: 1955,
    property_type: "single-family detached"
  };

  // 6 comps from Level 1 + Level 2 (all within 2.0 miles)
  const sixComps = [
    {
      id: "C1",
      address: "2649 Headland Dr, East Point, GA 30344",
      price: 182500,
      sqft: 1915,
      ppsf: 95.31,
      beds: 3,
      baths: 3,
      year_built: 1954,
      distance: 1.60
    },
    {
      id: "C2",
      address: "2649 Headland Dr, Atlanta, GA 30344",
      price: 182500,
      sqft: 1915,
      ppsf: 95.31,
      beds: 3,
      baths: 3,
      year_built: 1954,
      distance: 1.60
    },
    {
      id: "C3",
      address: "2251 Headland Dr, East Point, GA 30344",
      price: 270000,
      sqft: 1850,
      ppsf: 145.95,
      beds: 4,
      baths: 2,
      year_built: 1954,
      distance: 1.70
    },
    {
      id: "C4",
      address: "2221 Plantation Dr, East Point, GA 30344",
      price: 300000,
      sqft: 1938,
      ppsf: 154.79,
      beds: 3,
      baths: 2,
      year_built: 1961,
      distance: 1.75
    },
    {
      id: "C5",
      address: "2815 Spain Dr, East Point, GA 30344",
      price: 325000,
      sqft: 2767,
      ppsf: 117.46,
      beds: 4,
      baths: 3,
      year_built: 1965,
      distance: 0.97
    },
    {
      id: "C6",
      address: "2198 Plantation Dr, East Point, GA 30344",
      price: 320000,
      sqft: 2500,
      ppsf: 128.00,
      beds: 3,
      baths: 2,
      year_built: 1958,
      distance: 1.20
    }
  ];

  console.log('\n📊 INPUT DATA:');
  console.log(`Subject: ${subjectProperty.address}`);
  console.log(`Subject SQFT: ${subjectProperty.sqft}`);
  console.log('\nComparables:');
  sixComps.forEach((comp, i) => {
    console.log(`${i+1}. ${comp.address}`);
    console.log(`   💰 $${comp.price.toLocaleString()} | 🏠 ${comp.sqft} sqft | 📐 $${comp.ppsf.toFixed(2)}/sqft | 📍 ${comp.distance}mi`);
  });

  // Call Vertex AI ARV calculation
  try {
    const { VertexAIValuationService } = await import('./src/server/vertexAIValuation.js');

    const valuationService = new VertexAIValuationService();

    // Format data for the valuation service
    const inputData = {
      subject: {
        sqft: subjectProperty.sqft,
        property_type: subjectProperty.property_type
      },
      comps: sixComps.map(comp => ({
        id: comp.id,
        address: comp.address,
        unit: null,
        price: comp.price,
        sqft: comp.sqft,
        sale_date: "2025-09-15", // Recent date
        property_type: "single_family"
      }))
    };

    console.log('\n🤖 CALLING VERTEX AI VALUATION SERVICE...');
    const result = await valuationService.calculateARVWithAI(inputData.subject, inputData.comps);

    console.log('\n📋 VERTEX AI RESPONSE:');
    console.log('====================');

    if (result.success) {
      const parsed = result.result;

      console.log(`\n🎯 METHOD USED: ${parsed.method_used}`);
      console.log(`✅ SUCCESS: ${result.success}`);
      console.log(`📊 ARV Estimate: $${result.arv?.estimate?.toLocaleString()}`);
      console.log(`🎯 Confidence: ${result.arv?.confidence}`);

      console.log('\n✅ KEPT COMPS:');
      parsed.kept_comps?.forEach(comp => {
        console.log(`   ${comp.id}: ${comp.address}`);
        console.log(`      💰 $${comp.price?.toLocaleString()} | 🏠 ${comp.sqft} sqft | 📐 $${comp.ppsf?.toFixed(2)}/sqft`);
        console.log(`      📝 Reason: ${comp.reason}`);
      });

      console.log('\n❌ DROPPED COMPS:');
      parsed.dropped_comps?.forEach(comp => {
        console.log(`   ${comp.id}: ${comp.reason_codes?.join(', ') || 'No specific reason'}`);
      });

      console.log('\n🏠 ARV RESULTS:');
      console.log(`   💚 Conservative ARV: $${parsed.conservative?.arv_price?.toLocaleString()} ($${parsed.conservative?.arv_ppsf?.toFixed(2)}/sqft)`);
      console.log(`   💪 Aggressive ARV: $${parsed.aggressive?.arv_price?.toLocaleString()} ($${parsed.aggressive?.arv_ppsf?.toFixed(2)}/sqft)`);

      console.log('\n🚩 FLAGS:');
      Object.entries(parsed.flags || {}).forEach(([flag, value]) => {
        console.log(`   ${flag}: ${value}`);
      });

      console.log('\n📝 NOTES:');
      console.log(`   ${parsed.notes}`);

      // Compare to current 3-comp ARV
      console.log('\n📊 COMPARISON TO CURRENT V5:');
      console.log(`   Current V5 ARV (3 comps): $288,792.63`);
      console.log(`   New ARV (6 comps): $${parsed.conservative?.arv_price?.toLocaleString()}`);
      const difference = parsed.conservative?.arv_price - 288792.63;
      const percentChange = (difference / 288792.63) * 100;
      console.log(`   Difference: ${difference >= 0 ? '+' : ''}$${difference?.toLocaleString()} (${percentChange >= 0 ? '+' : ''}${percentChange?.toFixed(1)}%)`);

    } else {
      console.log(`❌ FAILED: ${result.reason}`);
      console.log('Details:', result.details);
    }

  } catch (error) {
    console.error('❌ Error calling Vertex AI:', error);
  }
}

test6CompsARV().catch(console.error);