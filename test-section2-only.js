// Test Section 2 Only - Cache Clearing
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY PROPERTY ANALYSIS - SECTION 2 ONLY');
console.log('===============================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function testSection2Only() {
  try {
    console.log('🔥 SECTION 1: INITIALIZING SEARCH SERVICE');
    console.log('========================================');
    const searchService = new ComprehensiveCompSearchV2();
    console.log('✅ Search service initialized');
    console.log('');

    console.log('🔥 SECTION 2: CLEARING CACHES');
    console.log('=============================');

    // Check cache stats before clearing
    console.log('📊 CACHE STATS BEFORE CLEARING:');
    try {
      const stats = searchService.getSystemStats();
      console.log(`   Progressive search cache: ${stats.progressiveSearchCache?.entries || 0} entries`);
      console.log(`   Distance validator cache: ${stats.distanceValidatorCache?.entries || 0} entries`);
    } catch (e) {
      console.log('   Unable to get cache stats');
    }
    console.log('');

    const startTime = Date.now();
    searchService.clearAllCaches();
    const duration = Date.now() - startTime;

    console.log('✅ All caches cleared');
    console.log(`⏱️  Cache clearing time: ${duration}ms`);
    console.log('');

    // Check cache stats after clearing
    console.log('📊 CACHE STATS AFTER CLEARING:');
    try {
      const stats = searchService.getSystemStats();
      console.log(`   Progressive search cache: ${stats.progressiveSearchCache?.entries || 0} entries`);
      console.log(`   Distance validator cache: ${stats.distanceValidatorCache?.entries || 0} entries`);
    } catch (e) {
      console.log('   Unable to get cache stats');
    }
    console.log('');

    console.log('✅ SECTION 2 COMPLETED SUCCESSFULLY');
    return searchService;

  } catch (error) {
    console.error('❌ SECTION 2 FAILED:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

// Execute Section 2 only
testSection2Only()
  .then((service) => {
    console.log('');
    console.log('🎯 SECTION 2 RESULT');
    console.log('==================');
    if (service) {
      console.log('✅ Cache clearing successful');
    } else {
      console.log('❌ Cache clearing failed');
    }
    process.exit(service ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ EXECUTION FAILED:', error);
    process.exit(1);
  });