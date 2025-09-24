// Test the new Comprehensive Search V2 with all fixes
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';

console.log('🧪 TESTING COMPREHENSIVE SEARCH V2 - ALL FIXES');
console.log('===============================================');
console.log(`📍 Test address: ${TEST_ADDRESS}`);
console.log('');

async function testComprehensiveV2() {
  try {
    const searchService = new ComprehensiveCompSearchV2();

    // Clear all caches for clean test
    searchService.clearAllCaches();

    console.log('🚀 Starting Comprehensive Search V2...');
    const startTime = Date.now();

    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n📊 TEST RESULTS ANALYSIS');
    console.log('========================');

    // Core Results
    console.log(`⏱️  Total duration: ${duration}ms`);
    console.log(`🔢 All comps found: ${results.all_comps.length}`);
    console.log(`✅ Qualified comps: ${results.qualified_comps.length}`);

    // Search Metadata Analysis
    console.log('\n🔍 SEARCH METADATA:');
    console.log(`   Version: ${results.searchMetadata.version}`);
    console.log(`   Strategy: ${results.searchMetadata.strategy}`);
    console.log(`   Search levels: ${results.searchMetadata.searchLevels}`);
    console.log(`   Quality score: ${results.searchMetadata.qualityScore.toUpperCase()}`);
    console.log(`   Cache hits: ${results.searchMetadata.cacheHits}`);

    // Normalization Results
    if (results.searchMetadata.normalizationSummary) {
      const norm = results.searchMetadata.normalizationSummary;
      console.log('\n🔧 NORMALIZATION ANALYSIS:');
      console.log(`   Original count: ${norm.originalCount}`);
      console.log(`   Duplicates found: ${norm.duplicatesFound}`);
      console.log(`   Conflicts resolved: ${norm.conflictsResolved}`);
      console.log(`   Final count: ${norm.finalCount}`);
      console.log(`   Confidence: ${norm.highConfidence}H/${norm.mediumConfidence}M/${norm.lowConfidence}L`);
    }

    // Deduplication Results
    if (results.searchMetadata.deduplicationSummary) {
      const dedup = results.searchMetadata.deduplicationSummary;
      console.log('\n🔗 DEDUPLICATION ANALYSIS:');
      console.log(`   Original count: ${dedup.originalCount}`);
      console.log(`   Duplicates removed: ${dedup.duplicatesRemoved}`);
      console.log(`   Conflicts resolved: ${dedup.conflictsResolved}`);
      console.log(`   Final count: ${dedup.finalCount}`);
      console.log(`   Confidence groups: ${dedup.highConfidenceGroups}H/${dedup.mediumConfidenceGroups}M/${dedup.lowConfidenceGroups}L`);
    }

    // Distance Validation Results
    if (results.searchMetadata.distanceValidationSummary) {
      const dist = results.searchMetadata.distanceValidationSummary;
      console.log('\n📍 DISTANCE VALIDATION ANALYSIS:');
      console.log(`   Total processed: ${dist.totalProcessed}`);
      console.log(`   Valid count: ${dist.validCount}`);
      console.log(`   Rejected count: ${dist.rejectedCount}`);
      console.log(`   Average distance: ${dist.avgDistance.toFixed(2)} miles`);
      console.log(`   Geocoding errors: ${dist.geocodingErrors}`);
      console.log(`   Cache hits: ${dist.cacheHits}`);
    }

    // Qualified Comparables Analysis
    console.log('\n🏠 QUALIFIED COMPARABLES:');
    if (results.qualified_comps.length > 0) {
      results.qualified_comps.forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.address}`);
        console.log(`   💰 $${comp.price?.toLocaleString()} | 📐 ${comp.sqft}sqft | 🏠 ${comp.beds}BR/${comp.baths}BA`);
        console.log(`   📍 ${comp.distance?.toFixed(2)}mi | 💲 $${(comp.price / comp.sqft).toFixed(2)}/sqft`);
        console.log(`   📅 Built: ${comp.yearBuilt} | 🔄 Merged from: ${comp.mergedFrom || 1} sources`);
        console.log('');
      });
    } else {
      console.log('   ❌ No qualified comparables found');
    }

    // ARV Analysis
    if (results.arv) {
      console.log('💰 ARV CALCULATION:');
      console.log(`   Method: ${results.arv.method}`);
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString()}`);
      console.log(`   Confidence: ${results.arv.confidence.toUpperCase()}`);
      console.log(`   Data points: ${results.arv.dataPoints}`);
    } else {
      console.log('💰 ARV: Not calculated');
    }

    // Renovation Analysis
    console.log('\n🔧 RENOVATION ANALYSIS:');
    console.log(`   Likely renovated: ${results.renovation_analysis.likely_renovated.length}`);
    console.log(`   Market average: ${results.renovation_analysis.market_average.length}`);
    console.log(`   Likely unrenovated: ${results.renovation_analysis.likely_unrenovated.length}`);

    // Consistency Scores
    console.log('\n📊 CONSISTENCY SCORES:');
    if (results.consistency_scores.size > 0) {
      for (const [address, score] of results.consistency_scores) {
        console.log(`   ${address}: ${score} appearances`);
      }
    } else {
      console.log('   No consistency data available');
    }

    // Compare with Original Issues
    console.log('\n🔍 ISSUE RESOLUTION CHECK:');
    console.log('==========================');

    // Check for duplicate addresses
    const addresses = results.qualified_comps.map(c => c.address);
    const uniqueAddresses = new Set(addresses);
    if (addresses.length === uniqueAddresses.size) {
      console.log('✅ FIXED: No duplicate addresses in final results');
    } else {
      console.log('❌ STILL BROKEN: Duplicate addresses found');
    }

    // Check for consistent sqft values
    const addressSqftMap = new Map();
    let inconsistentSqft = false;
    results.qualified_comps.forEach(comp => {
      if (addressSqftMap.has(comp.address)) {
        if (addressSqftMap.get(comp.address) !== comp.sqft) {
          inconsistentSqft = true;
          console.log(`❌ INCONSISTENT SQFT: ${comp.address} has multiple sqft values`);
        }
      } else {
        addressSqftMap.set(comp.address, comp.sqft);
      }
    });

    if (!inconsistentSqft) {
      console.log('✅ FIXED: Consistent sqft values for all properties');
    }

    // Check distance calculations
    const validDistances = results.qualified_comps.filter(c => c.distance && c.distance <= 2.0);
    if (validDistances.length === results.qualified_comps.length) {
      console.log('✅ FIXED: All distances properly calculated and within limits');
    } else {
      console.log('❌ DISTANCE ISSUES: Some properties have invalid distances');
    }

    // Performance comparison
    if (duration < 120000) { // Less than 2 minutes
      console.log(`✅ PERFORMANCE: Search completed in ${(duration/1000).toFixed(1)}s (vs 205s original)`);
    } else {
      console.log(`⚠️  PERFORMANCE: Search took ${(duration/1000).toFixed(1)}s (longer than expected)`);
    }

    // Get system stats
    const stats = searchService.getSystemStats();
    console.log('\n📈 SYSTEM STATISTICS:');
    console.log(`   Progressive search cache: ${stats.progressiveSearchCache.entries} entries`);
    console.log(`   Distance cache: ${stats.distanceValidatorCache.geocodeEntries} geocode entries`);
    console.log(`   Failed addresses: ${stats.distanceValidatorCache.failedAddresses}`);

    return results;

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    console.error('Stack trace:', error.stack);
    return null;
  }
}

// Execute test
testComprehensiveV2()
  .then((results) => {
    if (results) {
      console.log('\n✅ Comprehensive Search V2 test completed successfully');
      console.log(`🎯 Quality Score: ${results.searchMetadata.qualityScore.toUpperCase()}`);
      console.log(`📊 Final Qualified Comps: ${results.qualified_comps.length}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  });