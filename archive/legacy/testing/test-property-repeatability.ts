import 'dotenv/config';
import { VertexPropertyResearchService } from '../server/step2-property-research.js';

async function testPropertyRepeatability() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const numTests = 5; // Run 5 times to check consistency

  console.log('🔍 TESTING PROPERTY RESEARCH REPEATABILITY');
  console.log('============================================================');
  console.log(`📍 Address: ${address}`);
  console.log(`🔄 Running ${numTests} consecutive tests...`);
  console.log('');

  const service = new VertexPropertyResearchService();
  const results: any[] = [];

  for (let i = 1; i <= numTests; i++) {
    console.log(`🔄 RUN ${i}/${numTests}`);
    console.log('------------------------------------------------------------');

    try {
      const result = await service.researchProperty(address);
      results.push(result);

      if (result.success) {
        console.log(`   ✅ Success - SQFT: ${result.sqft}, Beds: ${result.beds}, Baths: ${result.baths}, Built: ${result.yearBuilt}`);
      } else {
        console.log(`   ❌ Failed - Error: ${result.error}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Exception: ${error.message}`);
      results.push({ success: false, error: error.message });
    }

    // Wait 3 seconds between calls to avoid rate limiting
    if (i < numTests) {
      console.log('   ⏱️  Waiting 3 seconds...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    console.log('');
  }

  // Analyze consistency
  console.log('📊 REPEATABILITY ANALYSIS');
  console.log('============================================================');

  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  console.log(`✅ Successful calls: ${successfulResults.length}/${numTests}`);
  console.log(`❌ Failed calls: ${failedResults.length}/${numTests}`);
  console.log('');

  if (successfulResults.length > 0) {
    console.log('📋 DETAILED RESULTS COMPARISON:');
    console.log('------------------------------------------------------------');

    successfulResults.forEach((result, i) => {
      console.log(`Run ${results.indexOf(result) + 1}: SQFT=${result.sqft}, Beds=${result.beds}, Baths=${result.baths}, Built=${result.yearBuilt}`);
    });

    // Check for consistency across successful results
    if (successfulResults.length > 1) {
      console.log('');
      console.log('🔍 CONSISTENCY CHECK:');
      console.log('------------------------------------------------------------');

      const firstResult = successfulResults[0];
      let isConsistent = true;
      const inconsistencies: string[] = [];

      for (let i = 1; i < successfulResults.length; i++) {
        const currentResult = successfulResults[i];

        if (currentResult.sqft !== firstResult.sqft) {
          inconsistencies.push(`SQFT: ${firstResult.sqft} vs ${currentResult.sqft}`);
          isConsistent = false;
        }
        if (currentResult.beds !== firstResult.beds) {
          inconsistencies.push(`Beds: ${firstResult.beds} vs ${currentResult.beds}`);
          isConsistent = false;
        }
        if (currentResult.baths !== firstResult.baths) {
          inconsistencies.push(`Baths: ${firstResult.baths} vs ${currentResult.baths}`);
          isConsistent = false;
        }
        if (currentResult.yearBuilt !== firstResult.yearBuilt) {
          inconsistencies.push(`Year Built: ${firstResult.yearBuilt} vs ${currentResult.yearBuilt}`);
          isConsistent = false;
        }
      }

      if (isConsistent) {
        console.log('✅ ALL RESULTS ARE CONSISTENT');
        console.log(`   📏 SQFT: ${firstResult.sqft}`);
        console.log(`   🛏️  Beds: ${firstResult.beds}`);
        console.log(`   🛁 Baths: ${firstResult.baths}`);
        console.log(`   📅 Built: ${firstResult.yearBuilt}`);
      } else {
        console.log('❌ INCONSISTENT RESULTS DETECTED:');
        inconsistencies.forEach(inc => console.log(`   • ${inc}`));
        console.log('');
        console.log('⚠️  This indicates Vertex AI is returning different data on each call!');
      }
    }
  }

  if (failedResults.length > 0) {
    console.log('');
    console.log('❌ FAILURE ANALYSIS:');
    console.log('------------------------------------------------------------');
    failedResults.forEach((result, i) => {
      console.log(`Failed run: ${result.error}`);
    });
  }

  console.log('');
  console.log('📈 RELIABILITY SCORE:');
  console.log('------------------------------------------------------------');
  const reliabilityPercent = (successfulResults.length / numTests) * 100;
  console.log(`${reliabilityPercent.toFixed(1)}% success rate (${successfulResults.length}/${numTests} successful calls)`);

  if (reliabilityPercent >= 90) {
    console.log('✅ EXCELLENT reliability');
  } else if (reliabilityPercent >= 70) {
    console.log('⚠️  GOOD reliability but could be improved');
  } else {
    console.log('❌ POOR reliability - needs investigation');
  }
}

testPropertyRepeatability().catch(console.error);