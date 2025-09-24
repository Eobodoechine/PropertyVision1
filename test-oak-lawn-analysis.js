// Comprehensive analysis for Oak Lawn, IL property
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '5849 W 90th St, Oak Lawn, IL 60453';

// Silent logging setup
const logCapture = [];
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  logCapture.push({ type: 'log', content: args.join(' '), timestamp: Date.now() });
};

console.error = (...args) => {
  logCapture.push({ type: 'error', content: args.join(' '), timestamp: Date.now() });
};

function showMessage(message) {
  originalLog(message);
}

showMessage('🏠 OAK LAWN, IL PROPERTY ANALYSIS');
showMessage('=================================');
showMessage(`📍 Address: ${TEST_ADDRESS}`);
showMessage('');

async function analyzeOakLawnProperty() {
  try {
    showMessage('🔇 STARTING COMPREHENSIVE ANALYSIS...');
    showMessage('===================================');

    const searchService = new ComprehensiveCompSearchV2();
    searchService.clearAllCaches();

    const searchStartTime = Date.now();
    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);
    const searchDuration = Date.now() - searchStartTime;

    // Restore logging
    console.log = originalLog;
    console.error = originalError;

    console.log('');
    console.log('📊 OAK LAWN ANALYSIS RESULTS');
    console.log('===========================');
    console.log(`⏱️  Total time: ${searchDuration}ms (${(searchDuration/1000).toFixed(1)}s)`);
    console.log(`📊 Log entries captured: ${logCapture.length}`);

    if (results) {
      console.log(`🔢 All comps found: ${results.all_comps?.length || 0}`);
      console.log(`✅ Qualified comps: ${results.qualified_comps?.length || 0}`);
      console.log(`💰 ARV calculated: ${results.arv ? 'Yes' : 'No'}`);

      if (results.arv && results.arv.estimate) {
        console.log(`💰 ARV estimate: $${results.arv.estimate.toLocaleString()}`);
        console.log(`💰 ARV confidence: ${results.arv.confidence}`);
      }

      if (results.searchMetadata) {
        console.log(`🎯 Search strategy: ${results.searchMetadata.strategy}`);
        console.log(`📊 Quality score: ${results.searchMetadata.qualityScore}`);
        console.log(`🔍 Search levels: ${results.searchMetadata.searchLevels}`);
      }

      // Show comparable properties
      if (results.qualified_comps && results.qualified_comps.length > 0) {
        console.log('');
        console.log('🏠 QUALIFIED COMPARABLE PROPERTIES:');
        console.log('==================================');

        results.qualified_comps.forEach((comp, index) => {
          const ppsf = comp.price && comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
          console.log(`${index + 1}. ${comp.address}`);
          console.log(`   💰 $${comp.price?.toLocaleString() || 'N/A'} | 📐 ${comp.sqft?.toLocaleString() || 'N/A'}sqft`);
          console.log(`   🏠 ${comp.beds || 'N/A'}BR/${comp.baths || 'N/A'}BA | 📅 Built: ${comp.yearBuilt || 'N/A'}`);
          console.log(`   📍 ${comp.distance?.toFixed(2) || 'N/A'}mi | 💲 $${ppsf}/sqft`);
          console.log('');
        });

        // Market summary
        const prices = results.qualified_comps.map(c => c.price).filter(p => p > 0);
        const sizes = results.qualified_comps.map(c => c.sqft).filter(s => s > 0);

        if (prices.length > 0) {
          const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
          const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
          const avgPpsf = avgPrice / avgSize;

          console.log('📈 MARKET SUMMARY:');
          console.log(`   Average price: $${Math.round(avgPrice).toLocaleString()}`);
          console.log(`   Average size: ${Math.round(avgSize).toLocaleString()} sqft`);
          console.log(`   Average PPSF: $${avgPpsf.toFixed(2)}`);
          console.log(`   Price range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
        }
      }

      // Renovation analysis
      if (results.renovation_analysis) {
        console.log('');
        console.log('🔧 RENOVATION ANALYSIS:');
        console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated?.length || 0}`);
        console.log(`   Market average: ${results.renovation_analysis.market_average?.length || 0}`);
        console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated?.length || 0}`);
      }

    } else {
      console.log('❌ No results returned from analysis');
    }

    return results;

  } catch (error) {
    console.log = originalLog;
    console.error = originalError;
    console.error('❌ Oak Lawn analysis failed:', error.message);
    return null;
  }
}

analyzeOakLawnProperty()
  .then((results) => {
    console.log('');
    console.log('🎯 OAK LAWN ANALYSIS COMPLETE');
    console.log('============================');
    if (results) {
      console.log('✅ Analysis completed successfully');
    } else {
      console.log('❌ Analysis failed');
    }
    process.exit(results ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Execution failed:', error);
    process.exit(1);
  });