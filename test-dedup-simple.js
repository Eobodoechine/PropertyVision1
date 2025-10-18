// Test Simplified VertexDeduplicator with Real Duplicate Data from job daed1273
import { VertexDeduplicator } from './src/server/utils/vertexDeduplicator.ts';

// Real duplicate data from job daed1273 that old system failed to catch
const testProperties = [
  // DUPLICATE SET 1: 2194 Ivydale - Same address, same date, DIFFERENT prices
  {
    address: '2194 Ivydale St, Atlanta, GA 30344',
    price: 290000,
    sqft: 1210,
    beds: 4,
    baths: 2,
    yearBuilt: 1952,
    soldDate: '2025-05-09',
    source: 'redfin'
  },
  {
    address: '2194 Ivydale St, Atlanta, GA', // Missing ZIP - should still match
    price: 160000, // Lower price - should be removed
    sqft: 1210,
    beds: 4,
    baths: 2,
    yearBuilt: 1950,
    soldDate: '2025-05-09', // Same date
    source: 'realtor.com'
  },

  // DUPLICATE SET 2: 2478 Graywall - Same address, different cities, different dates
  {
    address: '2478 Graywall St, East Point, GA 30344',
    price: 325000,
    sqft: 1300,
    beds: 3,
    baths: 2,
    yearBuilt: 1955,
    soldDate: '2025-09-15', // Newer date - should be kept
    source: 'redfin'
  },
  {
    address: '2478 Graywall St, Atlanta, GA 30344', // Different city - should still match
    price: 320000,
    sqft: 1300,
    beds: 3,
    baths: 2,
    yearBuilt: 1955,
    soldDate: '2024-08-10', // Older date - should be removed
    source: 'zillow'
  },

  // NON-DUPLICATE: Different address
  {
    address: '2345 Leith Ave, Atlanta, GA 30344',
    price: 340000,
    sqft: 1584,
    beds: 3,
    baths: 2.5,
    yearBuilt: 1955,
    soldDate: '2025-08-22',
    source: 'redfin'
  }
];

async function runTest() {
  console.log('🧪 Testing Simplified VertexDeduplicator\n');
  console.log('Input: 5 properties (2 duplicate pairs + 1 unique)');
  console.log('Expected output: 3 unique properties\n');

  // Verify GCP_SA_JSON env var is set
  if (!process.env.GCP_SA_JSON) {
    console.error('❌ Error: GCP_SA_JSON environment variable not set');
    console.error('Run: export GCP_SA_JSON=/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json');
    process.exit(1);
  }

  const deduplicator = new VertexDeduplicator();

  try {
    console.log('Calling Vertex AI with simplified prompt...\n');

    const result = await deduplicator.deduplicateProperties(testProperties);

    console.log('✅ Vertex deduplication complete\n');
    console.log('📊 RESULTS:');
    console.log(`   Unique properties: ${result.uniqueProperties.length}`);
    console.log(`   Duplicates removed: ${result.duplicatesRemoved}`);
    console.log(`   Merged groups: ${result.mergedGroups.length}\n`);

    console.log('📋 UNIQUE PROPERTIES:');
    result.uniqueProperties.forEach((prop, i) => {
      console.log(`   ${i + 1}. ${prop.address} | $${prop.price.toLocaleString()} | ${prop.soldDate}`);
    });

    console.log('\n🔗 DUPLICATE GROUPS:');
    result.mergedGroups.forEach((group, i) => {
      console.log(`   Group ${i + 1}:`);
      console.log(`      ✓ Kept: ${group.masterProperty.address} | $${group.masterProperty.price.toLocaleString()} | ${group.masterProperty.soldDate}`);
      group.duplicates.forEach(dup => {
        console.log(`      ✗ Removed: ${dup.address} | $${dup.price.toLocaleString()} | ${dup.soldDate}`);
      });
      console.log(`      Reason: ${group.reason} (confidence: ${group.confidence})`);
    });

    console.log('\n✅ VALIDATION:');

    let allPassed = true;

    // Test Case 1: 2194 Ivydale - Should keep $290k (same date, higher price)
    const ivydale = result.uniqueProperties.find(p => p.address.includes('2194 Ivydale'));
    if (ivydale && ivydale.price === 290000) {
      console.log('   ✓ Case 1 PASS: Kept $290k for 2194 Ivydale (same date, higher price)');
    } else {
      console.log(`   ✗ Case 1 FAIL: Expected $290k for 2194 Ivydale, got: $${ivydale?.price.toLocaleString() || 'NOT FOUND'}`);
      allPassed = false;
    }

    // Test Case 2: 2478 Graywall - Should keep 2025-09-15 (most recent)
    const graywall = result.uniqueProperties.find(p => p.address.includes('2478 Graywall'));
    if (graywall && graywall.soldDate === '2025-09-15') {
      console.log('   ✓ Case 2 PASS: Kept 2025-09-15 for 2478 Graywall (most recent date)');
    } else {
      console.log(`   ✗ Case 2 FAIL: Expected 2025-09-15 for 2478 Graywall, got: ${graywall?.soldDate || 'NOT FOUND'}`);
      allPassed = false;
    }

    // Test Case 3: Leith Ave - Should remain (no duplicates)
    const leith = result.uniqueProperties.find(p => p.address.includes('Leith'));
    if (leith) {
      console.log('   ✓ Case 3 PASS: 2345 Leith Ave remained (no duplicates)');
    } else {
      console.log('   ✗ Case 3 FAIL: 2345 Leith Ave was incorrectly removed');
      allPassed = false;
    }

    // Test Case 4: Correct count
    if (result.uniqueProperties.length === 3) {
      console.log('   ✓ Case 4 PASS: Correct count (3 unique properties)');
    } else {
      console.log(`   ✗ Case 4 FAIL: Expected 3 unique, got ${result.uniqueProperties.length}`);
      allPassed = false;
    }

    // Test Case 5: Duplicates count
    if (result.duplicatesRemoved === 2) {
      console.log('   ✓ Case 5 PASS: Correct duplicates removed (2)');
    } else {
      console.log(`   ✗ Case 5 FAIL: Expected 2 duplicates removed, got ${result.duplicatesRemoved}`);
      allPassed = false;
    }

    console.log('');
    if (allPassed) {
      console.log('✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('\nThis is expected if Vertex AI is unreachable or credentials are invalid.');
    console.error('The system correctly throws an error instead of returning duplicates.');
    process.exit(1);
  }
}

runTest();
