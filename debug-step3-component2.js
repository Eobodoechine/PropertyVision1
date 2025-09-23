// DEBUG Component 2: Vertex AI Search Queries
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';
const TEST_SUBJECT_DETAILS = {
  sqft: 2331,
  beds: 4,
  baths: 2.5,
  yearBuilt: 1998
};

console.log('🔍 TESTING COMPONENT 2: Vertex AI Search Queries');
console.log('=================================================');

async function testVertexSearches() {
  try {
    const compService = new VertexComparableSearchService();

    console.log(`📍 Testing address: ${TEST_ADDRESS}`);
    console.log(`🏠 Subject details: ${JSON.stringify(TEST_SUBJECT_DETAILS)}`);

    // Test identical searches to see if results are consistent
    console.log('\n🧪 Test 1: First search (with subdivision)');
    process.env.SUBDIVISION = 'Bailey Oaks';
    const search1 = await compService.findComparables(
      TEST_ADDRESS,
      undefined,
      50,
      3,
      18,
      TEST_SUBJECT_DETAILS
    );
    console.log(`Found ${search1.comparables.length} comps`);
    console.log('First 3 results:');
    search1.comparables.slice(0, 3).forEach((comp, i) => {
      console.log(`  ${i+1}. ${comp.address} - $${comp.price} - ${comp.sqft}sqft`);
    });

    console.log('\n🧪 Test 2: Second identical search');
    const search2 = await compService.findComparables(
      TEST_ADDRESS,
      undefined,
      50,
      3,
      18,
      TEST_SUBJECT_DETAILS
    );
    console.log(`Found ${search2.comparables.length} comps`);
    console.log('First 3 results:');
    search2.comparables.slice(0, 3).forEach((comp, i) => {
      console.log(`  ${i+1}. ${comp.address} - $${comp.price} - ${comp.sqft}sqft`);
    });

    console.log('\n🧪 Test 3: Search without subdivision');
    process.env.SUBDIVISION = '';
    const search3 = await compService.findComparables(
      TEST_ADDRESS,
      undefined,
      50,
      3,
      18,
      TEST_SUBJECT_DETAILS
    );
    console.log(`Found ${search3.comparables.length} comps`);
    console.log('First 3 results:');
    search3.comparables.slice(0, 3).forEach((comp, i) => {
      console.log(`  ${i+1}. ${comp.address} - $${comp.price} - ${comp.sqft}sqft`);
    });

    // Compare results for consistency
    console.log('\n📊 CONSISTENCY CHECK:');

    // Check if same properties appear with same data
    const addr1 = new Set(search1.comparables.map(c => c.address));
    const addr2 = new Set(search2.comparables.map(c => c.address));
    const addr3 = new Set(search3.comparables.map(c => c.address));

    console.log(`Search 1 addresses: ${addr1.size} unique`);
    console.log(`Search 2 addresses: ${addr2.size} unique`);
    console.log(`Search 3 addresses: ${addr3.size} unique`);

    // Find common addresses and check if data is identical
    const commonAddr = [...addr1].filter(a => addr2.has(a));
    console.log(`Common addresses between search 1&2: ${commonAddr.length}`);

    for (const addr of commonAddr.slice(0, 3)) {
      const comp1 = search1.comparables.find(c => c.address === addr);
      const comp2 = search2.comparables.find(c => c.address === addr);

      const identical = JSON.stringify(comp1) === JSON.stringify(comp2);
      console.log(`  ${addr}: ${identical ? '✅ IDENTICAL' : '❌ DIFFERENT'}`);

      if (!identical) {
        console.log(`    Search 1: $${comp1?.price} - ${comp1?.sqft}sqft`);
        console.log(`    Search 2: $${comp2?.price} - ${comp2?.sqft}sqft`);
      }
    }

  } catch (error) {
    console.error('❌ Error in Vertex search test:', error);
  }
}

testVertexSearches();