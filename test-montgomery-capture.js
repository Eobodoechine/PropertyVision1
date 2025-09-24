// Test Montgomery AL property analysis - CAPTURE VERBOSE LOGGING
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY ANALYSIS - VERBOSE LOG CAPTURE');
console.log('===========================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function analyzeWithLogCapture() {
  try {
    // Initialize service
    const searchService = new ComprehensiveCompSearchV2();
    searchService.clearAllCaches();
    console.log('✅ Service initialized and caches cleared');
    console.log('');

    // CAPTURE SETUP
    const logCapture = [];
    const originalLog = console.log;
    const originalError = console.error;

    // Capture all console output without printing
    console.log = (...args) => {
      logCapture.push({ type: 'log', content: args.join(' '), timestamp: Date.now() });
    };

    console.error = (...args) => {
      logCapture.push({ type: 'error', content: args.join(' '), timestamp: Date.now() });
    };

    console.log('🔇 STARTING SILENT COMPREHENSIVE SEARCH...');
    console.log('==========================================');

    const searchStartTime = Date.now();
    let results = null;
    let searchError = null;

    try {
      // Run the full search with all verbose logging captured
      results = await searchService.performOptimalSearchV2(TEST_ADDRESS);
    } catch (error) {
      searchError = error;
    }

    const searchDuration = Date.now() - searchStartTime;

    // RESTORE LOGGING
    console.log = originalLog;
    console.error = originalError;

    console.log(`✅ Silent search completed in ${searchDuration}ms`);
    console.log(`📊 Captured ${logCapture.length} log entries`);
    console.log('');

    // ANALYZE CAPTURED LOGS
    console.log('🔍 ANALYZING CAPTURED LOGS');
    console.log('==========================');

    // Count different types of messages
    const sectionLogs = logCapture.filter(log => log.content.includes('SECTION') || log.content.includes('STEP'));
    const errorLogs = logCapture.filter(log => log.content.includes('❌') || log.type === 'error');
    const successLogs = logCapture.filter(log => log.content.includes('✅'));
    const propertyLogs = logCapture.filter(log => log.content.includes('FILTERING') || log.content.includes('Added:'));
    const searchLogs = logCapture.filter(log => log.content.includes('Launching') && log.content.includes('Vertex'));
    const levelLogs = logCapture.filter(log => log.content.includes('Level ') && log.content.includes(':'));

    console.log('📈 LOG ANALYSIS:');
    console.log(`   Total entries: ${logCapture.length}`);
    console.log(`   Section headers: ${sectionLogs.length}`);
    console.log(`   Error messages: ${errorLogs.length}`);
    console.log(`   Success messages: ${successLogs.length}`);
    console.log(`   Property processing: ${propertyLogs.length}`);
    console.log(`   Vertex searches: ${searchLogs.length}`);
    console.log(`   Search levels: ${levelLogs.length}`);
    console.log('');

    // Show search progression
    if (levelLogs.length > 0) {
      console.log('🎯 SEARCH LEVEL PROGRESSION:');
      levelLogs.forEach(log => {
        const match = log.content.match(/Level (\d+): (.+)/);
        if (match) {
          console.log(`   Level ${match[1]}: ${match[2]}`);
        }
      });
      console.log('');
    }

    // Show vertex searches launched
    if (searchLogs.length > 0) {
      console.log('🚀 VERTEX AI SEARCHES:');
      searchLogs.forEach(log => {
        const match = log.content.match(/Launching (\d+) Vertex searches/);
        if (match) {
          console.log(`   Launched ${match[1]} parallel searches`);
        }
      });
      console.log('');
    }

    // Show errors encountered
    if (errorLogs.length > 0) {
      console.log('❌ ERRORS ENCOUNTERED:');
      errorLogs.slice(0, 5).forEach((log, index) => {
        console.log(`   ${index + 1}. ${log.content}`);
      });
      if (errorLogs.length > 5) {
        console.log(`   ... and ${errorLogs.length - 5} more errors`);
      }
      console.log('');
    }

    // Show final results
    console.log('📊 FINAL RESULTS:');
    if (searchError) {
      console.log(`   ❌ Search failed: ${searchError.message}`);
    } else if (results) {
      console.log(`   ✅ Search completed successfully`);
      console.log(`   All comps: ${results.all_comps?.length || 0}`);
      console.log(`   Qualified comps: ${results.qualified_comps?.length || 0}`);
      console.log(`   ARV calculated: ${results.arv ? 'Yes' : 'No'}`);
      if (results.arv) {
        console.log(`   ARV estimate: $${results.arv.estimate?.toLocaleString() || 'N/A'}`);
      }
    } else {
      console.log(`   ⚠️  No results returned`);
    }
    console.log('');

    // Show sample property processing logs
    const propertyProcessingLogs = logCapture.filter(log =>
      log.content.includes('FILTERING') ||
      log.content.includes('SIZE QUALIFIED') ||
      log.content.includes('BEDROOM OK')
    );

    if (propertyProcessingLogs.length > 0) {
      console.log('🏠 SAMPLE PROPERTY PROCESSING:');
      propertyProcessingLogs.slice(0, 3).forEach((log, index) => {
        console.log(`   ${index + 1}. ${log.content}`);
      });
      console.log(`   ... processed ${propertyProcessingLogs.length} total properties`);
      console.log('');
    }

    return {
      results,
      logCapture,
      searchDuration,
      analysis: {
        totalLogs: logCapture.length,
        errors: errorLogs.length,
        vertexSearches: searchLogs.length,
        propertiesProcessed: propertyLogs.length
      }
    };

  } catch (error) {
    console.error('❌ LOG CAPTURE FAILED:', error.message);
    return null;
  }
}

// Execute log capture analysis
analyzeWithLogCapture()
  .then((result) => {
    console.log('🎯 LOG CAPTURE COMPLETE');
    console.log('======================');
    if (result) {
      console.log(`✅ Successfully captured and analyzed ${result.analysis.totalLogs} log entries`);
      console.log(`📈 Search took ${result.searchDuration}ms with ${result.analysis.vertexSearches} API calls`);
    } else {
      console.log('❌ Log capture analysis failed');
    }
    process.exit(result ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ EXECUTION FAILED:', error);
    process.exit(1);
  });