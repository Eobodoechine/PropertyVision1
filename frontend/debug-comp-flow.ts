// Focused debugging for comp accumulation between progressive search levels
import { ProgressiveSearchStrategy } from './src/server/utils/progressiveSearchStrategy.js';

async function debugCompFlow() {
  const strategy = new ProgressiveSearchStrategy();

  const subjectProperty = {
    address: "3128 McKenzie Dr, East Point, GA 30344",
    sqft: 1323,
    bedrooms: 4,
    bathrooms: 3,
    yearBuilt: 1955,
    lat: 33.6946462,
    lng: -84.4630528
  };

  // Mock minimal search that returns test data
  const mockSearchService = {
    async searchComparables(address, radius, propertyType, limit) {
      const testComps = [
        {
          id: `test_${radius}mi_1`,
          address: `${radius}00 Test Ave, East Point, GA`,
          price: 300000 + (radius * 50000),
          sqft: 1400,
          bedrooms: 4,
          bathrooms: 3,
          yearBuilt: 1970,
          saleDate: "2025-06-15"
        },
        {
          id: `test_${radius}mi_2`,
          address: `${radius}01 Test St, East Point, GA`,
          price: 320000 + (radius * 45000),
          sqft: 1500,
          bedrooms: 3,
          bathrooms: 2,
          yearBuilt: 1975,
          saleDate: "2025-05-20"
        }
      ];

      console.log(`📡 MOCK SEARCH Level ${radius}: Returning ${testComps.length} raw comps`);
      return testComps;
    }
  };

  // Track just the comp flow
  console.log('🔍 COMP FLOW DEBUGGING');
  console.log('======================');

  const result = await strategy.executeProgressiveSearch(
    subjectProperty.address,
    subjectProperty,
    mockSearchService,
    'single_family'
  );

  console.log('\n📊 FINAL SUMMARY:');
  console.log(`Success: ${result.success}`);
  console.log(`Strategy: ${result.searchStrategy}`);
  console.log(`Final Comps: ${result.comparables?.length || 0}`);

  if (result.comparables) {
    result.comparables.forEach((comp, i) => {
      console.log(`  ${i+1}. ${comp.address}: $${comp.price}`);
    });
  }
}

debugCompFlow().catch(console.error);