// DEBUG Component 5: Comprehensive Flow Test
// This tests the entire comprehensive search flow with logging

import { ComprehensiveCompSearch } from './server/comprehensive-comp-search.js';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';

console.log('🔍 TESTING COMPREHENSIVE SEARCH FLOW');
console.log('====================================');

async function testComprehensiveFlow() {
  try {
    console.log(`📍 Testing comprehensive search for: ${TEST_ADDRESS}`);

    // Create search service
    const searchService = new ComprehensiveCompSearch();

    // Track timing and results
    const startTime = Date.now();

    // Execute comprehensive search with detailed logging
    console.log('\n🚀 Starting comprehensive search...');

    const results = await searchService.performOptimalSearch(TEST_ADDRESS);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log('\n📊 COMPREHENSIVE SEARCH RESULTS:');
    console.log('===============================');
    console.log(`⏱️  Total duration: ${duration}ms`);
    console.log(`🔢 All comps found: ${results.all_comps.length}`);
    console.log(`✅ Qualified comps: ${results.qualified_comps.length}`);

    // Analyze the qualified comps
    console.log('\n🏠 QUALIFIED COMPARABLES ANALYSIS:');
    results.qualified_comps.forEach((comp, index) => {
      console.log(`${index + 1}. ${comp.address}`);
      console.log(`   💰 Price: $${comp.price?.toLocaleString()}`);
      console.log(`   📐 Sqft: ${comp.sqft}`);
      console.log(`   🏠 Beds/Baths: ${comp.beds}BR/${comp.baths}BA`);
      console.log(`   📅 Year: ${comp.yearBuilt}`);
      console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);
      console.log(`   💲 PPSF: $${(comp.price / comp.sqft).toFixed(2)}`);
      console.log(`   🔄 Appearances: ${comp.frequency || 'unknown'}`);
      console.log('');
    });

    // Check for duplicates in qualified comps
    console.log('🔗 DUPLICATE ANALYSIS:');
    const addresses = results.qualified_comps.map(c => c.address);
    const uniqueAddresses = [...new Set(addresses)];

    if (addresses.length !== uniqueAddresses.length) {
      console.log('🚨 DUPLICATES FOUND in qualified comps:');
      const addressCounts = {};
      addresses.forEach(addr => {
        addressCounts[addr] = (addressCounts[addr] || 0) + 1;
      });

      Object.entries(addressCounts).forEach(([addr, count]) => {
        if (count > 1) {
          console.log(`   ${addr}: ${count} instances`);
          const duplicates = results.qualified_comps.filter(c => c.address === addr);
          duplicates.forEach((dup, i) => {
            console.log(`     ${i+1}. $${dup.price} - ${dup.sqft}sqft (${dup.source || 'unknown source'})`);
          });
        }
      });
    } else {
      console.log('✅ No duplicates in qualified comps');
    }

    // Check ARV calculation
    if (results.arv) {
      console.log('\n💰 ARV CALCULATION:');
      console.log(`   Method: ${results.arv.method}`);
      console.log(`   Estimate: $${results.arv.estimate?.toLocaleString()}`);
      console.log(`   Confidence: ${results.arv.confidence}`);
      console.log(`   Data points: ${results.arv.dataPoints}`);
    } else {
      console.log('\n❌ NO ARV CALCULATED');
    }

    // Check renovation analysis
    console.log('\n🔧 RENOVATION ANALYSIS:');
    console.log(`   Likely renovated: ${results.renovation_analysis?.likely_renovated?.length || 0}`);
    console.log(`   Likely unrenovated: ${results.renovation_analysis?.likely_unrenovated?.length || 0}`);
    console.log(`   Market average: ${results.renovation_analysis?.market_average?.length || 0}`);

    // Consistency scores analysis
    console.log('\n📊 CONSISTENCY SCORES:');
    if (results.consistency_scores && results.consistency_scores.size > 0) {
      for (const [address, score] of results.consistency_scores) {
        console.log(`   ${address}: ${score} appearances`);
      }
    } else {
      console.log('   No consistency scores available');
    }

    return results;

  } catch (error) {
    console.error('❌ Error in comprehensive search test:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Execute test and capture results
testComprehensiveFlow()
  .then((results) => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });