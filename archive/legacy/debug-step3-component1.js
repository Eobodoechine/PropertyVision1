// DEBUG Component 1: Property Details Fetching
import { fetchPropertyDetailsViaVertex } from './server/vertex-details.js';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';

console.log('🔍 TESTING COMPONENT 1: Property Details Fetching');
console.log('==================================================');

async function testPropertyDetails() {
  try {
    console.log(`📍 Testing address: ${TEST_ADDRESS}`);

    // Test multiple calls to see if results are consistent
    console.log('\n🧪 Test 1: First call');
    const details1 = await fetchPropertyDetailsViaVertex(TEST_ADDRESS);
    console.log('Result 1:', JSON.stringify(details1, null, 2));

    console.log('\n🧪 Test 2: Second call (should be identical)');
    const details2 = await fetchPropertyDetailsViaVertex(TEST_ADDRESS);
    console.log('Result 2:', JSON.stringify(details2, null, 2));

    console.log('\n🧪 Test 3: Third call (checking consistency)');
    const details3 = await fetchPropertyDetailsViaVertex(TEST_ADDRESS);
    console.log('Result 3:', JSON.stringify(details3, null, 2));

    // Compare results
    console.log('\n📊 CONSISTENCY CHECK:');
    const same12 = JSON.stringify(details1) === JSON.stringify(details2);
    const same23 = JSON.stringify(details2) === JSON.stringify(details3);
    const same13 = JSON.stringify(details1) === JSON.stringify(details3);

    console.log(`Call 1 vs 2: ${same12 ? '✅ IDENTICAL' : '❌ DIFFERENT'}`);
    console.log(`Call 2 vs 3: ${same23 ? '✅ IDENTICAL' : '❌ DIFFERENT'}`);
    console.log(`Call 1 vs 3: ${same13 ? '✅ IDENTICAL' : '❌ DIFFERENT'}`);

    if (!same12 || !same23 || !same13) {
      console.log('\n🚨 ISSUE DETECTED: Property details are inconsistent between calls');
      console.log('This explains why the same property shows different sqft values');
    }

  } catch (error) {
    console.error('❌ Error in property details test:', error);
  }
}

testPropertyDetails();