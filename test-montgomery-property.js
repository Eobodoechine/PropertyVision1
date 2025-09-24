// Test Montgomery AL property analysis
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 PROPERTY ANALYSIS - MONTGOMERY, AL');
console.log('===================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function analyzeProperty() {
  try {
    const searchService = new ComprehensiveCompSearchV2();

    console.log('🚀 Starting Comprehensive Analysis...');
    const startTime = Date.now();

    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n📊 ANALYSIS RESULTS');
    console.log('==================');

    // Core Results
    console.log(`⏱️  Total duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`🔢 All comps found: ${results.all_comps.length}`);
    console.log(`✅ Qualified comps: ${results.qualified_comps.length}`);

    // Search Strategy Details
    if (results.searchMetadata) {
      console.log(`\n🎯 SEARCH STRATEGY:`);
      console.log(`   Version: ${results.searchMetadata.version}`);
      console.log(`   Strategy: ${results.searchMetadata.strategy}`);
      console.log(`   Search levels: ${results.searchMetadata.searchLevels}`);
      console.log(`   Quality score: ${results.searchMetadata.qualityScore.toUpperCase()}`);
      console.log(`   Cache hits: ${results.searchMetadata.cacheHits}`);
    }

    // Renovation Analysis
    if (results.renovation_analysis) {
      console.log('\n🔧 RENOVATION ANALYSIS:');
      console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated.length}`);
      console.log(`   Market average: ${results.renovation_analysis.market_average.length}`);
      console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated.length}`);

      // Show top renovated comps
      if (results.renovation_analysis.likely_renovated.length > 0) {
        console.log('\n🏠 TOP RENOVATED COMPARABLES:');
        results.renovation_analysis.likely_renovated.slice(0, 5).forEach((comp, index) => {
          const ppsf = comp.price / comp.sqft;
          console.log(`${index + 1}. ${comp.address}`);
          console.log(`   💰 $${comp.price?.toLocaleString()} | 📐 ${comp.sqft}sqft | 🏠 ${comp.beds}BR/${comp.baths}BA`);
          console.log(`   📍 ${comp.distance?.toFixed(2)}mi | 💲 $${ppsf.toFixed(2)}/sqft | 📅 Built: ${comp.yearBuilt}`);
          console.log('');
        });
      }
    }

    // ARV Analysis
    if (results.arv) {
      console.log('💰 ARV CALCULATION:');
      console.log(`   Method: ${results.arv.method}`);
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString()}`);
      console.log(`   Confidence: ${results.arv.confidence.toUpperCase()}`);
      console.log(`   Data points: ${results.arv.dataPoints}`);
      console.log(`   Price range: $${results.arv.priceRange?.min?.toLocaleString()} - $${results.arv.priceRange?.max?.toLocaleString()}`);
    }

    // Market Summary
    if (results.qualified_comps.length > 0) {
      const prices = results.qualified_comps.map(c => c.price).filter(p => p > 0);
      const sizes = results.qualified_comps.map(c => c.sqft).filter(s => s > 0);
      const distances = results.qualified_comps.map(c => c.distance).filter(d => d > 0);

      if (prices.length > 0) {
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
        const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
        const avgPpsf = avgPrice / avgSize;

        console.log('\n📈 MARKET SUMMARY:');
        console.log(`   Average price: $${avgPrice.toLocaleString()}`);
        console.log(`   Average size: ${Math.round(avgSize).toLocaleString()} sqft`);
        console.log(`   Average PPSF: $${avgPpsf.toFixed(2)}`);
        console.log(`   Average distance: ${avgDistance.toFixed(2)} miles`);
        console.log(`   Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
      }
    }

    return results;

  } catch (error) {
    console.error('\n❌ ANALYSIS FAILED:', error);
    console.error('Stack trace:', error.stack);
    return null;
  }
}

// Execute analysis
analyzeProperty()
  .then((results) => {
    if (results) {
      console.log('\n✅ Property analysis completed successfully');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Analysis execution failed:', error);
    process.exit(1);
  });