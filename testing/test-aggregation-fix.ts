import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testAggregationFix() {
  console.log('🧪 TESTING MULTIPLE-CALL AGGREGATION FIX');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  // Subject property details
  const subjectDetails = {
    sqft: 2331,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998
  };

  console.log(`📍 Address: ${address}`);
  console.log(`🏠 Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, Built ${subjectDetails.yearBuilt}`);
  console.log('');

  // Test the new aggregation logic
  console.log('🔍 TESTING SUBDIVISION SEARCH WITH AGGREGATION');
  console.log('------------------------------------------------------------');

  // Set subdivision to trigger aggregation
  process.env.SUBDIVISION = 'Bailey Oaks';

  try {
    const result = await compService.findComparables(
      address,
      undefined, // property type
      20,        // max results
      3,         // radius miles
      18,        // time window months
      subjectDetails
    );

    if (result.success) {
      console.log(`\n✅ SUCCESS: Found ${result.comparables.length} qualified comparables`);
      console.log('');

      result.comparables.forEach((comp: any, i: number) => {
        const ppsf = comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
        console.log(`${i+1}. ${comp.address}`);
        console.log(`   💰 Price: $${comp.price.toLocaleString()}`);
        console.log(`   📐 Size: ${comp.sqft} sqft`);
        console.log(`   🛏️  Beds/Baths: ${comp.beds}BR/${comp.baths}BA`);
        console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
        console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);
        console.log(`   💲 PPSF: $${ppsf}`);
        console.log('');
      });

      // Check if Bailey Oaks properties are included
      const baileyOaksProps = result.comparables.filter((comp: any) =>
        comp.address.toLowerCase().includes('bailey') ||
        comp.address.toLowerCase().includes('jordan pl')
      );

      console.log(`🏘️  Bailey Oaks/Jordan Pl properties found: ${baileyOaksProps.length}`);
      baileyOaksProps.forEach(comp => {
        console.log(`   - ${comp.address}`);
      });

    } else {
      console.log(`❌ FAILED: ${result.error}`);
    }

  } catch (error: any) {
    console.log(`❌ ERROR: ${error.message}`);
  }

  // Reset subdivision
  process.env.SUBDIVISION = '';

  console.log('\n🎯 AGGREGATION FIX ANALYSIS:');
  console.log('============================================================');
  console.log('The multiple-call aggregation should:');
  console.log('1. Make up to 3 subdivision calls automatically');
  console.log('2. Aggregate unique properties from all calls');
  console.log('3. Consistently find Bailey Oaks properties like 100/110 Bailey Ct');
  console.log('4. Only fallback to broader search if still <3 properties after aggregation');
}

testAggregationFix().catch(console.error);