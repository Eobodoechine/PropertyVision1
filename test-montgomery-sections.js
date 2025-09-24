// Test Montgomery AL property analysis - SECTIONED WITH VERBOSE LOGGING
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY PROPERTY ANALYSIS - SECTIONED APPROACH');
console.log('==================================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function analyzePropertyInSections() {
  try {
    const searchService = new ComprehensiveCompSearchV2();
    const totalStartTime = Date.now();

    console.log('🔥 SECTION 1: INITIALIZING SEARCH SERVICE');
    console.log('========================================');
    console.log('✅ Search service initialized');
    console.log('');

    console.log('🔥 SECTION 2: CLEARING CACHES');
    console.log('=============================');
    searchService.clearAllCaches();
    console.log('✅ All caches cleared');
    console.log('');

    console.log('🔥 SECTION 3: STARTING COMPREHENSIVE SEARCH');
    console.log('==========================================');
    console.log('🚀 Calling performOptimalSearchV2...');
    console.log('');

    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);

    const totalDuration = Date.now() - totalStartTime;

    console.log('');
    console.log('🔥 SECTION 4: ANALYZING RESULTS');
    console.log('===============================');

    // Basic results check
    console.log('📊 BASIC RESULTS:');
    console.log(`   Total time: ${totalDuration}ms (${(totalDuration/1000).toFixed(1)}s)`);
    console.log(`   All comps: ${results.all_comps ? results.all_comps.length : 'undefined'}`);
    console.log(`   Qualified comps: ${results.qualified_comps ? results.qualified_comps.length : 'undefined'}`);
    console.log(`   Has ARV: ${results.arv ? 'Yes' : 'No'}`);
    console.log(`   Has renovation analysis: ${results.renovation_analysis ? 'Yes' : 'No'}`);
    console.log('');

    if (!results.all_comps) {
      console.log('❌ CRITICAL: all_comps is undefined');
      return results;
    }

    if (!results.qualified_comps) {
      console.log('❌ CRITICAL: qualified_comps is undefined');
      return results;
    }

    console.log('🔥 SECTION 5: SEARCH METADATA ANALYSIS');
    console.log('=====================================');
    if (results.searchMetadata) {
      console.log(`   Version: ${results.searchMetadata.version}`);
      console.log(`   Strategy: ${results.searchMetadata.strategy}`);
      console.log(`   Search levels: ${results.searchMetadata.searchLevels}`);
      console.log(`   Quality score: ${results.searchMetadata.qualityScore}`);
      console.log(`   Cache hits: ${results.searchMetadata.cacheHits}`);
    } else {
      console.log('❌ No search metadata found');
    }
    console.log('');

    console.log('🔥 SECTION 6: QUALIFIED COMPS DETAILS');
    console.log('====================================');
    if (results.qualified_comps.length > 0) {
      console.log(`Found ${results.qualified_comps.length} qualified comparables:`);
      results.qualified_comps.forEach((comp, index) => {
        const ppsf = comp.price && comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
        console.log(`${index + 1}. ${comp.address}`);
        console.log(`   💰 $${comp.price?.toLocaleString() || 'N/A'} | 📐 ${comp.sqft || 'N/A'}sqft`);
        console.log(`   🏠 ${comp.beds || 'N/A'}BR/${comp.baths || 'N/A'}BA | 📅 Built: ${comp.yearBuilt || 'N/A'}`);
        console.log(`   📍 ${comp.distance?.toFixed(2) || 'N/A'}mi | 💲 $${ppsf}/sqft`);
        console.log('');
      });
    } else {
      console.log('❌ No qualified comparables found');
    }

    console.log('🔥 SECTION 7: RENOVATION ANALYSIS');
    console.log('================================');
    if (results.renovation_analysis) {
      console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated?.length || 0}`);
      console.log(`   Market average: ${results.renovation_analysis.market_average?.length || 0}`);
      console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated?.length || 0}`);

      if (results.renovation_analysis.likely_renovated?.length > 0) {
        console.log('\n   🔧 RENOVATED COMPARABLES:');
        results.renovation_analysis.likely_renovated.slice(0, 3).forEach((comp, index) => {
          const ppsf = comp.price && comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
          console.log(`   ${index + 1}. ${comp.address} - $${comp.price?.toLocaleString() || 'N/A'} ($${ppsf}/sqft)`);
        });
      }
    } else {
      console.log('❌ No renovation analysis found');
    }
    console.log('');

    console.log('🔥 SECTION 8: ARV ANALYSIS');
    console.log('=========================');
    if (results.arv) {
      console.log(`   Method: ${results.arv.method || 'N/A'}`);
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString() || 'N/A'}`);
      console.log(`   Confidence: ${results.arv.confidence || 'N/A'}`);
      console.log(`   Data points: ${results.arv.dataPoints || 'N/A'}`);
      if (results.arv.priceRange) {
        console.log(`   Price range: $${results.arv.priceRange.min?.toLocaleString() || 'N/A'} - $${results.arv.priceRange.max?.toLocaleString() || 'N/A'}`);
      }
    } else {
      console.log('❌ No ARV calculation found');
    }
    console.log('');

    console.log('🔥 SECTION 9: MARKET SUMMARY');
    console.log('===========================');
    if (results.qualified_comps?.length > 0) {
      const validComps = results.qualified_comps.filter(c => c.price > 0 && c.sqft > 0);
      if (validComps.length > 0) {
        const prices = validComps.map(c => c.price);
        const sizes = validComps.map(c => c.sqft);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
        const avgPpsf = avgPrice / avgSize;

        console.log(`   Average price: $${Math.round(avgPrice).toLocaleString()}`);
        console.log(`   Average size: ${Math.round(avgSize).toLocaleString()} sqft`);
        console.log(`   Average PPSF: $${avgPpsf.toFixed(2)}`);
        console.log(`   Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
        console.log(`   Size range: ${Math.min(...sizes).toLocaleString()} - ${Math.max(...sizes).toLocaleString()} sqft`);
      }
    } else {
      console.log('❌ No valid comparables for market summary');
    }

    console.log('');
    console.log('✅ ANALYSIS COMPLETED SUCCESSFULLY');

    return results;

  } catch (error) {
    console.log('');
    console.log('🔥 SECTION ERROR: ANALYSIS FAILED');
    console.log('================================');
    console.error('❌ ERROR:', error.message);
    console.error('❌ STACK:', error.stack);
    return null;
  }
}

// Execute sectioned analysis
analyzePropertyInSections()
  .then((results) => {
    console.log('');
    console.log('🎯 FINAL STATUS');
    console.log('==============');
    if (results) {
      console.log('✅ Montgomery property analysis completed');
    } else {
      console.log('❌ Montgomery property analysis failed');
    }
    process.exit(results ? 0 : 1);
  })
  .catch((error) => {
    console.log('');
    console.log('❌ EXECUTION FAILED');
    console.log('==================');
    console.error('Error:', error);
    process.exit(1);
  });