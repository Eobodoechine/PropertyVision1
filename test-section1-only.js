// Test Section 1 Only - Initialize Search Service
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY PROPERTY ANALYSIS - SECTION 1 ONLY');
console.log('===============================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function testSection1Only() {
  try {
    console.log('🔥 SECTION 1: INITIALIZING SEARCH SERVICE');
    console.log('========================================');

    const startTime = Date.now();
    const searchService = new ComprehensiveCompSearchV2();
    const duration = Date.now() - startTime;

    console.log('✅ Search service initialized');
    console.log(`⏱️  Initialization time: ${duration}ms`);
    console.log('');

    // Check what services are available
    console.log('📋 AVAILABLE SERVICES:');
    console.log(`   Comp Service: ${searchService.compService ? '✅' : '❌'}`);
    console.log(`   ARV Service: ${searchService.arvService ? '✅' : '❌'}`);
    console.log(`   Normalizer: ${searchService.normalizer ? '✅' : '❌'}`);
    console.log(`   Deduplicator: ${searchService.deduplicator ? '✅' : '❌'}`);
    console.log(`   Progressive Search: ${searchService.progressiveSearch ? '✅' : '❌'}`);
    console.log(`   Distance Validator: ${searchService.distanceValidator ? '✅' : '❌'}`);
    console.log('');

    console.log('✅ SECTION 1 COMPLETED SUCCESSFULLY');
    return searchService;

  } catch (error) {
    console.error('❌ SECTION 1 FAILED:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

// Execute Section 1 only
testSection1Only()
  .then((service) => {
    console.log('');
    console.log('🎯 SECTION 1 RESULT');
    console.log('==================');
    if (service) {
      console.log('✅ Service initialization successful');
    } else {
      console.log('❌ Service initialization failed');
    }
    process.exit(service ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ EXECUTION FAILED:', error);
    process.exit(1);
  });