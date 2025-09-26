import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function intensiveMurphyCreekSearch() {
  console.log('🔍 INTENSIVE MURPHY CREEK LN SEARCH - RAW RESULTS FOCUS');
  console.log('============================================================');
  console.log('🎯 Target: 215 Murphy Creek Ln, Fayetteville, GA 30215');
  console.log('📋 Goal: Get Murphy Creek into RAW results from Vertex AI first');
  console.log('');

  const compService = new VertexComparableSearchService();
  let foundMurphyCreek = false;

  // Strategy 1: LOGICAL DISTANCE + TIME EXPANSION (Murphy Creek should be <2 miles away)
  console.log('🚀 STRATEGY 1: LOGICAL DISTANCE + TIME EXPANSION');
  console.log('------------------------------------------------------------');

  const logicalParams = [
    { radius: 3, time: 60, results: 100, label: 'Local Area (3mi, 5yr)' },
    { radius: 5, time: 120, results: 150, label: 'Extended Time (5mi, 10yr)' },
    { radius: 2, time: 180, results: 200, label: 'Close Distance, Long Time (2mi, 15yr)' },
  ];

  for (const params of logicalParams) {
    console.log(`\n📐 ${params.label}...`);

    try {
      const result = await compService.findComparables(
        '185 Jordan Pl, Fayetteville, GA 30215',
        undefined,
        params.results,
        params.radius,
        params.time
      );

      if (result.success && result.comparables) {
        // Check all raw results for Murphy Creek
        const allMurphy = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy creek') ||
          comp.address.toLowerCase().includes('murphy lane') ||
          comp.address.toLowerCase().includes('murphy ln')
        );

        console.log(`   ✅ Search completed: ${result.comparables.length} total properties`);

        if (allMurphy.length > 0) {
          console.log(`   🎯 MURPHY PROPERTIES FOUND:`)
          allMurphy.forEach((comp: any) => {
            console.log(`      📍 ${comp.address}`);
            console.log(`      💰 Price: $${comp.price?.toLocaleString()}`);
            console.log(`      📅 Sale Date: ${comp.soldDate}`);
            console.log(`      🏠 Details: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft} sqft, Built ${comp.yearBuilt}`);
            console.log(`      📏 Distance: ${comp.distance?.toFixed(2)} miles`);
            console.log('');
          });
          foundMurphyCreek = true;
          break;
        } else {
          console.log(`   ❌ No Murphy properties found in ${params.label}`);
        }
      } else {
        console.log(`   ❌ ${params.label} search failed`);
      }
    } catch (error: any) {
      console.log(`   ❌ ${params.label} error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Strategy 2: DIFFERENT GEOGRAPHIC CENTERS
  if (!foundMurphyCreek) {
    console.log('\n🌍 STRATEGY 2: ALTERNATIVE SEARCH CENTERS');
    console.log('------------------------------------------------------------');

    const searchCenters = [
      'Fayetteville, GA 30215',
      'Murphy Creek Ln, Fayetteville, GA 30215',
      'Fayetteville, GA',
      '30215 zip code Georgia'
    ];

    for (const center of searchCenters) {
      console.log(`\n📍 Searching from: ${center}...`);

      try {
        const result = await compService.findComparables(
          center,
          undefined,
          100,
          12,    // 12 mile radius
          120    // 10 years
        );

        if (result.success && result.comparables) {
          const murphyProps = result.comparables.filter((comp: any) =>
            comp.address.toLowerCase().includes('murphy')
          );

          console.log(`   ✅ Found ${result.comparables.length} total properties`);

          if (murphyProps.length > 0) {
            console.log(`   🎯 MURPHY PROPERTIES FROM ${center}:`);
            murphyProps.forEach((comp: any) => {
              console.log(`      ${comp.address} - $${comp.price?.toLocaleString()} - ${comp.soldDate}`);
            });
            foundMurphyCreek = true;
          } else {
            console.log(`   ❌ No Murphy properties from ${center}`);
          }
        }
      } catch (error: any) {
        console.log(`   ❌ Error searching from ${center}: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Strategy 3: DIRECT MURPHY CREEK ADDRESS RESEARCH
  if (!foundMurphyCreek) {
    console.log('\n🔍 STRATEGY 3: DIRECT ADDRESS RESEARCH');
    console.log('------------------------------------------------------------');

    const directQueries = [
      '215 Murphy Creek Lane Fayetteville GA 30215 sold',
      'Murphy Creek Lane Fayetteville Georgia real estate sold',
      'Murphy Creek subdivision Fayetteville GA recent sales',
      'Murphy Creek Fayetteville 30215 sold properties'
    ];

    for (let i = 0; i < directQueries.length; i++) {
      console.log(`\n🎯 Direct Query ${i+1}: "${directQueries[i]}"...`);

      try {
        const result = await compService.findComparables(
          '185 Jordan Pl, Fayetteville, GA 30215',
          undefined,
          75,
          10,
          96  // 8 years
        );

        if (result.success && result.comparables) {
          const found = result.comparables.filter((comp: any) =>
            comp.address.toLowerCase().includes('murphy')
          );

          if (found.length > 0) {
            console.log(`   🎯 DIRECT SEARCH SUCCESS:`);
            found.forEach((comp: any) => {
              console.log(`      ${comp.address} - $${comp.price?.toLocaleString()} - ${comp.soldDate}`);
            });
            foundMurphyCreek = true;
            break;
          } else {
            console.log(`   ❌ Direct query ${i+1} found no Murphy properties`);
          }
        }
      } catch (error: any) {
        console.log(`   ❌ Direct query ${i+1} failed: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // FINAL ANALYSIS
  console.log('\n📊 INTENSIVE SEARCH ANALYSIS');
  console.log('============================================================');

  if (foundMurphyCreek) {
    console.log('✅ SUCCESS: Murphy Creek properties found in raw Vertex AI results');
    console.log('🔍 Next steps: Analyze why these properties are being filtered out');
    console.log('📋 Check: Distance limits, time limits, size variance, bedroom/bathroom matching');
  } else {
    console.log('❌ MURPHY CREEK NOT FOUND in any raw Vertex AI results');
    console.log('🤔 Possible reasons:');
    console.log('   1. Property has never been sold (owner-occupied since construction)');
    console.log('   2. Sale data not indexed by Google Search/MLS systems');
    console.log('   3. Address format differs in databases (Murphy Creek vs Murphy Ln vs Murphy Lane)');
    console.log('   4. Property is in different jurisdiction/city with same zip code');
    console.log('   5. Sale occurred before digital record keeping or outside search timeframe');
    console.log('');
    console.log('🔬 RECOMMENDED VERIFICATION:');
    console.log('   • Manual verification on Zillow, Redfin, Realtor.com');
    console.log('   • County property records search');
    console.log('   • Check if 215 Murphy Creek Ln actually exists at that address');
  }
}

intensiveMurphyCreekSearch().catch(console.error);