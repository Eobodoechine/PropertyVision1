// Test original method (comprehensive-comp-search.js) vs V2
import { ComprehensiveCompSearchService } from './server/comprehensive-comp-search.js';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';

console.log('🧪 TESTING ORIGINAL COMPREHENSIVE SEARCH METHOD');
console.log('===============================================');
console.log(`📍 Test address: ${TEST_ADDRESS}`);
console.log('');

async function testOriginalMethod() {
  try {
    const searchService = new ComprehensiveCompSearchService();

    console.log('🚀 Starting Original Comprehensive Search...');
    const startTime = Date.now();

    const results = await searchService.performComprehensiveSearch(TEST_ADDRESS);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n📊 ORIGINAL METHOD TEST RESULTS');
    console.log('===============================');

    // Core Results
    console.log(`⏱️  Total duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`🔢 All comps found: ${results.all_comps.length}`);
    console.log(`✅ Qualified comps: ${results.qualified_comps.length}`);

    // Renovation Analysis
    console.log('\n🔧 RENOVATION ANALYSIS:');
    console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated.length} (use for ARV)`);
    console.log(`   Market average: ${results.renovation_analysis.market_average.length} (baseline)`);
    console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated.length} (exclude from ARV)`);

    // Show renovated comps in detail
    if (results.renovation_analysis.likely_renovated.length > 0) {
      console.log('\n🏠 LIKELY RENOVATED COMPARABLES:');
      results.renovation_analysis.likely_renovated.forEach((comp, index) => {
        const ppsf = comp.price / comp.sqft;
        console.log(`${index + 1}. ${comp.address}`);
        console.log(`   💰 $${comp.price?.toLocaleString()} | 📐 ${comp.sqft}sqft | 🏠 ${comp.beds}BR/${comp.baths}BA`);
        console.log(`   📍 ${comp.distance?.toFixed(2)}mi | 💲 $${ppsf.toFixed(2)}/sqft | 📅 Built: ${comp.yearBuilt}`);
        console.log('');
      });
    }

    // ARV Analysis
    if (results.arv) {
      console.log('💰 ARV CALCULATION:');
      console.log(`   Method: ${results.arv.method}`);
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString()}`);
      console.log(`   Confidence: ${results.arv.confidence.toUpperCase()}`);
      console.log(`   Data points: ${results.arv.dataPoints}`);
    }

    // Summary comparison points
    console.log('\n📋 SUMMARY FOR COMPARISON:');
    console.log(`   Search method: Original (4 redundant searches)`);
    console.log(`   Total time: ${(duration/1000).toFixed(1)}s`);
    console.log(`   Total comps: ${results.all_comps.length}`);
    console.log(`   Qualified comps: ${results.qualified_comps.length}`);
    console.log(`   Renovated comps: ${results.renovation_analysis.likely_renovated.length}`);
    console.log(`   ARV: $${results.arv?.estimate?.toLocaleString() || 'N/A'}`);

    return results;

  } catch (error) {
    console.error('\n❌ ORIGINAL METHOD TEST FAILED:', error);
    console.error('Stack trace:', error.stack);
    return null;
  }
}

// Execute test
testOriginalMethod()
  .then((results) => {
    if (results) {
      console.log('\n✅ Original method test completed successfully');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  });