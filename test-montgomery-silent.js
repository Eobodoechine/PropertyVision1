// Test Montgomery AL property analysis - COMPLETELY SILENT
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

// CAPTURE ALL LOGGING FROM THE START
const logCapture = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

// Intercept ALL console output immediately
console.log = (...args) => {
  logCapture.push({ type: 'log', content: args.join(' '), timestamp: Date.now() });
};

console.error = (...args) => {
  logCapture.push({ type: 'error', content: args.join(' '), timestamp: Date.now() });
};

console.warn = (...args) => {
  logCapture.push({ type: 'warn', content: args.join(' '), timestamp: Date.now() });
};

// Restore logging only for our control messages
function showMessage(message) {
  originalLog(message);
}

showMessage('🏠 MONTGOMERY ANALYSIS - COMPLETELY SILENT');
showMessage('==========================================');
showMessage(`📍 Address: ${TEST_ADDRESS}`);
showMessage('');

async function completelysilentAnalysis() {
  try {
    showMessage('🔇 STARTING COMPLETELY SILENT SEARCH...');
    showMessage('=====================================');

    const totalStartTime = Date.now();

    // Initialize service (this will be captured silently)
    const searchService = new ComprehensiveCompSearchV2();

    // Clear caches (this will be captured silently)
    searchService.clearAllCaches();

    showMessage('✅ Service initialized (all output captured)');

    // Run the full search with everything captured
    let results = null;
    let searchError = null;

    const searchStartTime = Date.now();

    try {
      results = await searchService.performOptimalSearchV2(TEST_ADDRESS);
    } catch (error) {
      searchError = error;
    }

    const searchDuration = Date.now() - searchStartTime;
    const totalDuration = Date.now() - totalStartTime;

    showMessage(`✅ Silent search completed in ${searchDuration}ms`);
    showMessage(`📊 Total captured log entries: ${logCapture.length}`);
    showMessage('');

    // RESTORE LOGGING FOR ANALYSIS
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;

    console.log('🔍 ANALYZING CAPTURED LOGS');
    console.log('==========================');

    // Analyze the captured logs
    const phases = {
      initialization: logCapture.filter(log =>
        log.content.includes('initialized') ||
        log.content.includes('cleared')
      ),
      subjectDetails: logCapture.filter(log =>
        log.content.includes('Subject details') ||
        log.content.includes('SQFT=') ||
        log.content.includes('Beds=')
      ),
      searchLevels: logCapture.filter(log =>
        log.content.includes('Level ') &&
        (log.content.includes('Tight Local') || log.content.includes('Extended'))
      ),
      vertexSearches: logCapture.filter(log =>
        log.content.includes('Launching') && log.content.includes('Vertex')
      ),
      propertyFiltering: logCapture.filter(log =>
        log.content.includes('FILTERING') ||
        log.content.includes('SIZE QUALIFIED') ||
        log.content.includes('BEDROOM OK')
      ),
      errors: logCapture.filter(log =>
        log.content.includes('❌') || log.type === 'error'
      ),
      finalResults: logCapture.filter(log =>
        log.content.includes('FINAL RESULTS') ||
        log.content.includes('ARV') ||
        log.content.includes('qualified comps')
      )
    };

    console.log('📈 PHASE BREAKDOWN:');
    Object.entries(phases).forEach(([phase, logs]) => {
      console.log(`   ${phase}: ${logs.length} log entries`);
    });
    console.log('');

    // Show search progression
    if (phases.searchLevels.length > 0) {
      console.log('🎯 SEARCH LEVELS EXECUTED:');
      phases.searchLevels.forEach((log, index) => {
        const match = log.content.match(/Level (\d+): (.+)/);
        if (match) {
          console.log(`   Level ${match[1]}: ${match[2]}`);
        }
      });
      console.log('');
    }

    // Show Vertex API usage
    if (phases.vertexSearches.length > 0) {
      console.log('🚀 VERTEX AI API CALLS:');
      let totalSearches = 0;
      phases.vertexSearches.forEach(log => {
        const match = log.content.match(/Launching (\d+) Vertex searches/);
        if (match) {
          const count = parseInt(match[1]);
          totalSearches += count;
          console.log(`   Batch: ${count} parallel searches`);
        }
      });
      console.log(`   Total API calls: ${totalSearches}`);
      console.log('');
    }

    // Show property processing summary
    if (phases.propertyFiltering.length > 0) {
      const qualified = logCapture.filter(log => log.content.includes('SIZE QUALIFIED')).length;
      const rejected = logCapture.filter(log => log.content.includes('Filtered out')).length;

      console.log('🏠 PROPERTY PROCESSING:');
      console.log(`   Properties evaluated: ${phases.propertyFiltering.length}`);
      console.log(`   Qualified: ${qualified}`);
      console.log(`   Rejected: ${rejected}`);
      console.log('');
    }

    // Show final results
    console.log('📊 SEARCH RESULTS:');
    if (searchError) {
      console.log(`   ❌ Search failed: ${searchError.message}`);
    } else if (results) {
      console.log(`   ✅ Search completed successfully`);
      console.log(`   All comps found: ${results.all_comps?.length || 0}`);
      console.log(`   Qualified comps: ${results.qualified_comps?.length || 0}`);
      console.log(`   ARV calculated: ${results.arv ? 'Yes' : 'No'}`);
      if (results.arv) {
        console.log(`   ARV estimate: $${results.arv.estimate?.toLocaleString() || 'N/A'}`);
        console.log(`   ARV confidence: ${results.arv.confidence || 'N/A'}`);
      }
      if (results.searchMetadata) {
        console.log(`   Search strategy: ${results.searchMetadata.strategy}`);
        console.log(`   Quality score: ${results.searchMetadata.qualityScore}`);
      }
    }

    console.log('');
    console.log(`⏱️  Total execution time: ${totalDuration}ms`);

    return {
      results,
      logCapture,
      searchDuration,
      totalDuration,
      phases
    };

  } catch (error) {
    // Restore logging for errors
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;

    console.error('❌ SILENT ANALYSIS FAILED:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

// Execute completely silent analysis
completelysilentAnalysis()
  .then((result) => {
    console.log('');
    console.log('🎯 SILENT ANALYSIS COMPLETE');
    console.log('===========================');
    if (result) {
      console.log(`✅ Successfully captured ${result.logCapture.length} log entries`);
      console.log(`📈 Analysis completed in ${result.totalDuration}ms (${result.searchDuration}ms search)`);
      console.log('🔇 No flashing output during execution');
    } else {
      console.log('❌ Silent analysis failed');
    }
    process.exit(result ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ EXECUTION FAILED:', error);
    process.exit(1);
  });