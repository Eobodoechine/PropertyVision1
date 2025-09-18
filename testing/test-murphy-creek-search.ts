import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testMurphyCreekSearch() {
  console.log('🎯 MURPHY CREEK LN TARGETED SEARCH');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();
  const subjectDetails = { sqft: 2331, beds: 4, baths: 2.5, yearBuilt: 1998 };

  console.log(`📍 Target: ${address}`);
  console.log(`🎯 Seeking: 215 Murphy Creek Ln, Fayetteville, GA 30215`);
  console.log('');

  // Updated search terms for Murphy Creek
  const targetStreets = ['murphy creek', 'murphy creek ln', 'murphy creek lane'];

  // METHOD 1: Rapid multi-call with correct search terms
  console.log('🔄 METHOD 1: RAPID MURPHY CREEK SEARCH');
  console.log('------------------------------------------------------------');

  process.env.SUBDIVISION = ''; // Clear subdivision for broader search
  const murphyCreekResults = new Map();

  for (let call = 1; call <= 7; call++) {
    console.log(`   Call ${call}/7...`);

    try {
      const result = await compService.findComparables(
        address, undefined, 40, 5, 36, subjectDetails
      );

      if (result.success) {
        console.log(`      ✅ Found ${result.comparables.length} total comps`);

        // Check for Murphy Creek properties
        const murphyCreekProps = result.comparables.filter((comp: any) =>
          targetStreets.some(street => comp.address.toLowerCase().includes(street))
        );

        if (murphyCreekProps.length > 0) {
          console.log(`      🎯 FOUND MURPHY CREEK PROPERTIES:`);
          murphyCreekProps.forEach((comp: any) => {
            console.log(`         ${comp.address} - $${comp.price?.toLocaleString()}`);
            murphyCreekResults.set(comp.address, comp);
          });
        } else {
          console.log(`      ❌ No Murphy Creek properties found`);
        }

        // Store all for aggregation
        result.comparables.forEach((comp: any) => {
          if (targetStreets.some(street => comp.address.toLowerCase().includes(street))) {
            murphyCreekResults.set(comp.address, comp);
          }
        });

      } else {
        console.log(`      ❌ Call ${call} failed`);
      }
    } catch (error: any) {
      console.log(`      ❌ Error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  console.log(`\n📊 Murphy Creek Results: ${murphyCreekResults.size} unique properties found`);

  if (murphyCreekResults.size > 0) {
    console.log(`🎯 MURPHY CREEK PROPERTIES DISCOVERED:`);
    Array.from(murphyCreekResults.values()).forEach((comp: any, i: number) => {
      const ppsf = comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
      console.log(`\n${i+1}. ${comp.address}`);
      console.log(`   💰 Price: $${comp.price?.toLocaleString()}`);
      console.log(`   📐 Size: ${comp.sqft} sqft`);
      console.log(`   🛏️  ${comp.beds}BR/${comp.baths}BA`);
      console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
      console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);
      console.log(`   💲 PPSF: $${ppsf}`);
    });
  }

  // METHOD 2: Extra-wide search if not found
  if (murphyCreekResults.size === 0) {
    console.log('\n🔍 METHOD 2: EXTRA-WIDE SEARCH FOR MURPHY CREEK');
    console.log('------------------------------------------------------------');

    try {
      console.log(`   Searching 8mi radius, 48mo window, 60 results...`);

      const wideResult = await compService.findComparables(
        address, undefined, 60, 8, 48, subjectDetails
      );

      if (wideResult.success) {
        const murphyCreekProps = wideResult.comparables.filter((comp: any) =>
          targetStreets.some(street => comp.address.toLowerCase().includes(street))
        );

        console.log(`      ✅ Wide search: ${wideResult.comparables.length} total, ${murphyCreekProps.length} Murphy Creek`);

        murphyCreekProps.forEach((comp: any) => {
          console.log(`      🎯 ${comp.address} - $${comp.price?.toLocaleString()}`);
          murphyCreekResults.set(comp.address, comp);
        });
      }
    } catch (error: any) {
      console.log(`      ❌ Wide search failed: ${error.message}`);
    }
  }

  // FINAL ANALYSIS
  console.log('\n🔍 MURPHY CREEK SEARCH ANALYSIS');
  console.log('============================================================');

  if (murphyCreekResults.size > 0) {
    console.log(`✅ SUCCESS: Found ${murphyCreekResults.size} Murphy Creek properties`);
    console.log(`📊 These properties can be used as comparables for 185 Jordan Pl`);
  } else {
    console.log(`❌ Murphy Creek Ln properties not found. Possible reasons:`);
    console.log(`   1. 215 Murphy Creek Ln hasn't sold recently (within 48 months)`);
    console.log(`   2. Property is outside 8-mile search radius`);
    console.log(`   3. Sale data not available in Vertex AI grounded search`);
    console.log(`   4. Property may be owner-occupied (never sold)`);
    console.log(`   5. Different address format in database`);
  }

  return Array.from(murphyCreekResults.values());
}

testMurphyCreekSearch().catch(console.error);