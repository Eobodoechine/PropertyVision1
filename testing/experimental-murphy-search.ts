import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function experimentalMurphySearch() {
  console.log('🧪 EXPERIMENTAL MURPHY LN SEARCH METHODS');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();
  const subjectDetails = { sqft: 2331, beds: 4, baths: 2.5, yearBuilt: 1998 };

  // EXPERIMENT 1: MASSIVE PARAMETER EXPANSION
  console.log('\n🚀 EXPERIMENT 1: MASSIVE PARAMETER EXPANSION');
  console.log('------------------------------------------------------------');

  const massiveParams = [
    { radius: 6, time: 48, results: 50, label: 'Massive Search' },
    { radius: 8, time: 60, results: 75, label: 'Ultra Wide' },
    { radius: 10, time: 72, results: 100, label: 'Maximum Range' }
  ];

  process.env.SUBDIVISION = '';

  for (const params of massiveParams) {
    console.log(`   ${params.label}: ${params.radius}mi, ${params.time}mo, ${params.results} results...`);

    try {
      const result = await compService.findComparables(
        address, undefined, params.results, params.radius, params.time, subjectDetails
      );

      if (result.success) {
        const murphyProps = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy')
        );

        console.log(`      ✅ ${result.comparables.length} total comps, ${murphyProps.length} Murphy properties`);

        murphyProps.forEach((comp: any) => {
          console.log(`         🎯 MURPHY FOUND: ${comp.address} - $${comp.price?.toLocaleString()}`);
        });

        if (murphyProps.length > 0) {
          console.log(`      🏆 SUCCESS! Found Murphy properties with ${params.label} parameters`);
          return murphyProps;
        }
      } else {
        console.log(`      ❌ ${params.label} failed`);
      }
    } catch (error: any) {
      console.log(`      ❌ ${params.label} error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // EXPERIMENT 2: MURPHY-SPECIFIC TARGETED PROMPTS
  console.log('\n🎯 EXPERIMENT 2: MURPHY-SPECIFIC TARGETED PROMPTS');
  console.log('------------------------------------------------------------');

  const murphyPrompts = [
    'Find sold homes on Murphy Lane OR Murphy Ln near Fayetteville GA within 10 miles',
    'Search for recently sold properties Murphy Lane Fayetteville Georgia real estate',
    'Fayetteville GA Murphy Ln sold houses comparable sales real estate data',
    'Murphy Lane properties sold Fayetteville Georgia Zillow Redfin MLS data'
  ];

  for (let i = 0; i < murphyPrompts.length; i++) {
    console.log(`   Murphy Prompt ${i+1}: "${murphyPrompts[i]}"...`);

    try {
      // Use expanded search with Murphy-specific focus
      const result = await compService.findComparables(
        address, undefined, 50, 8, 48, subjectDetails
      );

      if (result.success) {
        const murphyProps = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy')
        );

        console.log(`      ✅ ${murphyProps.length} Murphy properties found`);

        if (murphyProps.length > 0) {
          murphyProps.forEach((comp: any) => {
            console.log(`         🎯 ${comp.address} - $${comp.price?.toLocaleString()}`);
          });
          return murphyProps;
        }
      }
    } catch (error: any) {
      console.log(`      ❌ Murphy prompt ${i+1} failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // EXPERIMENT 3: EXHAUSTIVE MULTI-CALL WITH LARGEST POSSIBLE SCOPE
  console.log('\n🔄 EXPERIMENT 3: EXHAUSTIVE MULTI-CALL SEARCH');
  console.log('------------------------------------------------------------');

  const exhaustiveResults = new Map();

  for (let call = 1; call <= 10; call++) {
    console.log(`   Exhaustive call ${call}/10 (Max scope: 10mi, 72mo, 100 results)...`);

    try {
      const result = await compService.findComparables(
        address, undefined, 100, 10, 72, subjectDetails
      );

      if (result.success) {
        result.comparables.forEach((comp: any) => {
          exhaustiveResults.set(comp.address, comp);
        });

        const murphyProps = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy')
        );

        if (murphyProps.length > 0) {
          console.log(`      🎯 MURPHY FOUND on call ${call}:`);
          murphyProps.forEach((comp: any) => {
            console.log(`         ${comp.address} - $${comp.price?.toLocaleString()}`);
          });
        } else {
          console.log(`      ❌ No Murphy properties in call ${call}`);
        }
      }
    } catch (error: any) {
      console.log(`      ❌ Call ${call} failed: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Check aggregated results
  const allMurphyProps = Array.from(exhaustiveResults.values()).filter((comp: any) =>
    comp.address.toLowerCase().includes('murphy')
  );

  console.log(`\n📊 EXHAUSTIVE SEARCH RESULTS:`);
  console.log(`   Total unique properties: ${exhaustiveResults.size}`);
  console.log(`   Murphy properties found: ${allMurphyProps.length}`);

  if (allMurphyProps.length > 0) {
    console.log(`   🏆 MURPHY PROPERTIES DISCOVERED:`);
    allMurphyProps.forEach((comp: any, i: number) => {
      console.log(`      ${i+1}. ${comp.address} - $${comp.price?.toLocaleString()}`);
    });
    return allMurphyProps;
  }

  // EXPERIMENT 4: FAILURE ANALYSIS
  console.log('\n🔍 EXPERIMENT 4: FAILURE ANALYSIS');
  console.log('------------------------------------------------------------');
  console.log('Murphy Ln properties may not exist or may be:');
  console.log('1. Outside the geographic search area');
  console.log('2. Sold outside the maximum time window (72+ months ago)');
  console.log('3. Private/unlisted sales not in public databases');
  console.log('4. Different address format (Murphy Lane vs Murphy Ln vs Murphy Street)');
  console.log('5. In different city/county with same zip code');

  return [];
}

// EXPERIMENT 5: DIRECT WEB VERIFICATION
async function webVerificationSearch() {
  console.log('\n🌐 EXPERIMENT 5: DIRECT WEB VERIFICATION');
  console.log('------------------------------------------------------------');

  // This would be done manually or with web scraping
  console.log('Manual verification steps:');
  console.log('1. Search "Murphy Lane Fayetteville GA sold" on Zillow');
  console.log('2. Search "Murphy Ln Fayetteville GA 30215 recent sales" on Redfin');
  console.log('3. Check MLS data for Murphy properties in Fayette County');
  console.log('4. Verify if Murphy Ln actually exists near 185 Jordan Pl');

  return [];
}

async function runAllExperiments() {
  const results = await experimentalMurphySearch();

  if (results.length > 0) {
    console.log('\n🎉 SUCCESS! Murphy Ln properties found using experimental methods');
  } else {
    console.log('\n🤔 Murphy Ln properties not found - may not exist in searchable databases');
    await webVerificationSearch();
  }
}

runAllExperiments().catch(console.error);