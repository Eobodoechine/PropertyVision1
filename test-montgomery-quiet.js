// Test Montgomery AL property analysis - QUIET VERSION
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

// Suppress verbose logging
const originalLog = console.log;
console.log = (...args) => {
  const message = args.join(' ');
  // Only show important messages, filter out verbose search details
  if (
    message.includes('🏠 PROPERTY ANALYSIS') ||
    message.includes('📊 ANALYSIS RESULTS') ||
    message.includes('⏱️  Total duration') ||
    message.includes('🔢 All comps') ||
    message.includes('✅ Qualified comps') ||
    message.includes('🎯 SEARCH STRATEGY') ||
    message.includes('🔧 RENOVATION ANALYSIS') ||
    message.includes('💰 ARV CALCULATION') ||
    message.includes('📈 MARKET SUMMARY') ||
    message.includes('🏠 TOP RENOVATED') ||
    message.includes('✅ Property analysis') ||
    message.includes('❌') ||
    !message.includes('🔍') && !message.includes('📐') && !message.includes('🚀')
  ) {
    originalLog(...args);
  }
};

console.log('🏠 PROPERTY ANALYSIS - MONTGOMERY, AL');
console.log('===================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function analyzeProperty() {
  try {
    const searchService = new ComprehensiveCompSearchV2();

    console.log('🚀 Starting analysis (quiet mode)...');
    const startTime = Date.now();

    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n📊 ANALYSIS RESULTS');
    console.log('==================');
    console.log(`⏱️  Total duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
    console.log(`🔢 All comps found: ${results.all_comps.length}`);
    console.log(`✅ Qualified comps: ${results.qualified_comps.length}`);

    // ARV Analysis
    if (results.arv) {
      console.log('\n💰 ARV CALCULATION:');
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString()}`);
      console.log(`   Confidence: ${results.arv.confidence.toUpperCase()}`);
      console.log(`   Data points: ${results.arv.dataPoints}`);
    }

    // Renovation Analysis Summary
    if (results.renovation_analysis) {
      console.log('\n🔧 RENOVATION ANALYSIS:');
      console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated.length}`);
      console.log(`   Market average: ${results.renovation_analysis.market_average.length}`);
      console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated.length}`);
    }

    // Market Summary
    if (results.qualified_comps.length > 0) {
      const prices = results.qualified_comps.map(c => c.price).filter(p => p > 0);
      const sizes = results.qualified_comps.map(c => c.sqft).filter(s => s > 0);

      if (prices.length > 0) {
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
        const avgPpsf = avgPrice / avgSize;

        console.log('\n📈 MARKET SUMMARY:');
        console.log(`   Average price: $${avgPrice.toLocaleString()}`);
        console.log(`   Average size: ${Math.round(avgSize).toLocaleString()} sqft`);
        console.log(`   Average PPSF: $${avgPpsf.toFixed(2)}`);
        console.log(`   Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
      }
    }

    return results;

  } catch (error) {
    console.log = originalLog; // Restore logging for errors
    console.error('\n❌ ANALYSIS FAILED:', error.message);
    return null;
  }
}

analyzeProperty()
  .then((results) => {
    console.log = originalLog; // Restore logging
    if (results) {
      console.log('\n✅ Property analysis completed successfully');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.log = originalLog; // Restore logging
    console.error('\n❌ Analysis execution failed:', error);
    process.exit(1);
  });