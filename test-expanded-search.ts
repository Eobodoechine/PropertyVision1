import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

async function testExpandedSearch() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  console.log('🔍 EXPANDED SEARCH TEST');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`🏘️  Subdivision: Bailey Oaks`);
  console.log(`📊 Parameters: 50 results, 3 miles search radius`);
  console.log(`🎯 Goal: Find Bailey Ct and Murphy Creek properties`);
  console.log('');

  // Set subdivision environment variable
  process.env.SUBDIVISION = 'Bailey Oaks';

  const targetProperties = [
    '100 Bailey Ct', '110 Bailey Ct', '105 Bailey Ct',
    '125 Murphy Creek Ln', '215 Murphy Creek Ln', '150 Murphy Creek Ln'
  ];

  console.log('🎯 TARGET PROPERTIES TO FIND:');
  targetProperties.forEach((prop, i) => {
    console.log(`   ${i+1}. ${prop}, Fayetteville, GA 30215`);
  });
  console.log('');

  try {
    const result = await compService.findComparables(
      address,
      undefined, // property type
      50,       // max results (increased from 20)
      3,        // radius miles (increased from 5 to capture more)
      18        // time window months
    );

    if (result.success && result.comparables.length > 0) {
      console.log(`✅ Found ${result.comparables.length} qualified comps:`);
      console.log('');

      let foundTargets = [];

      result.comparables.forEach((comp: any, i: number) => {
        const ppsf = comp.price / comp.sqft;
        console.log(`   ${i+1}. ${comp.address}`);
        console.log(`      💰 $${comp.price.toLocaleString()} | 📐 ${comp.sqft}sqft | 💲 $${ppsf.toFixed(2)} PPSF`);
        console.log(`      📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate} | 📍 ${comp.distance?.toFixed(2)}mi`);

        // Check if this is one of our target properties
        const isTarget = targetProperties.some(target => comp.address.includes(target));
        if (isTarget) {
          console.log(`      🎯 TARGET PROPERTY FOUND! ✅`);
          foundTargets.push(comp.address);
        }
        console.log('');
      });

      console.log('📊 TARGET PROPERTY ANALYSIS:');
      console.log('============================================================');
      console.log(`🎯 Found ${foundTargets.length} of ${targetProperties.length} target properties:`);

      foundTargets.forEach(found => {
        console.log(`   ✅ ${found}`);
      });

      const missed = targetProperties.filter(target =>
        !foundTargets.some(found => found.includes(target))
      );

      if (missed.length > 0) {
        console.log('');
        console.log(`❌ Still missing ${missed.length} target properties:`);
        missed.forEach(missing => {
          console.log(`   ❌ ${missing}, Fayetteville, GA 30215`);
        });
      }

    } else {
      console.log('❌ No qualified comps found');
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

  } catch (error: any) {
    console.log(`❌ Search failed: ${error.message}`);
  }

  console.log('');
  console.log('💡 NEXT STEPS:');
  console.log('If targets still missing, try:');
  console.log('1. Multiple search runs (4-search strategy)');
  console.log('2. Further expand to 75 results');
  console.log('3. Extend radius to 4-5 miles for search');
}

testExpandedSearch().catch(console.error);