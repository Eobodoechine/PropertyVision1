// Test Vertex AI Deduplication with real data from last analysis
import { VertexDeduplicator } from './src/server/utils/vertexDeduplicator.js';

const testData = [
  {
    address: "2649 Headland Dr, East Point, GA, 30344",
    price: 182500,
    sqft: 1915,
    beds: 3,
    baths: 3,
    soldDate: "2025-08-07",
    source: "redfin"
  },
  {
    address: "2221 Plantation Dr, East Point, GA, 30344",
    price: 300000,
    sqft: 1938,
    beds: 3,
    baths: 2,
    soldDate: "2025-09-05",
    source: "zillow"
  },
  {
    address: "2610 Cheney St, East Point, GA, 30344",
    price: 450000,
    sqft: 2219,
    beds: 4,
    baths: 3,
    soldDate: "2025-09-11",
    source: "realtor"
  },
  {
    address: "2442 Connally Dr, East Point, GA, 30344",
    price: 412500,
    sqft: 2200,
    beds: 4,
    baths: 3,
    soldDate: "2025-07-29",
    source: "realtor"
  },
  {
    address: "2925 Delowe Dr, Atlanta, GA 30344",
    price: 155000,
    sqft: 2184,
    beds: 4,
    baths: 2,
    soldDate: "2025-04-14",
    source: "realtor"
  },
  {
    address: "2221 Plantation Dr, East Pt, GA 30344", // DUPLICATE with address variation
    price: 300000,
    sqft: 1938,
    beds: 3,
    baths: 2,
    soldDate: "2025-09-04",
    source: "zillow"
  },
  {
    address: "2221 Plantation Dr, East Point, GA 30344", // DUPLICATE exact match
    price: 300000,
    sqft: 1938,
    beds: 3,
    baths: 2,
    soldDate: "2025-09-04",
    source: "realtor"
  }
];

async function testVertexDeduplication() {
  console.log('🧪 Testing Vertex AI Deduplication');
  console.log('=====================================');
  console.log(`Input: ${testData.length} properties`);

  const deduplicator = new VertexDeduplicator();

  try {
    const result = await deduplicator.deduplicateProperties(testData);

    console.log('\n📊 Results:');
    console.log(`- Unique properties: ${result.uniqueProperties.length}`);
    console.log(`- Duplicates removed: ${result.duplicatesRemoved}`);
    console.log(`- Merge groups: ${result.mergedGroups.length}`);

    console.log('\n🔗 Merged Groups:');
    result.mergedGroups.forEach((group, index) => {
      console.log(`\nGroup ${index + 1}:`);
      console.log(`  Master: ${group.masterProperty.address} - $${group.masterProperty.price}`);
      console.log(`  Reason: ${group.reason}`);
      console.log(`  Confidence: ${group.confidence}`);
      console.log(`  Duplicates removed:`);
      group.duplicates.forEach(dup => {
        console.log(`    - ${dup.address} - $${dup.price}`);
      });
    });

    console.log('\n✅ Final Unique Properties:');
    result.uniqueProperties.forEach((prop, index) => {
      console.log(`${index + 1}. ${prop.address} - $${prop.price} (${prop.sqft} sqft)`);
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testVertexDeduplication();