// Debug Progressive Search with State Dumps
import { ProgressiveSearchStrategy } from './src/server/utils/progressiveSearchStrategy.js';

async function debugProgressiveSearch() {
  console.log('🔍 DEBUG: PROGRESSIVE SEARCH PIPELINE');
  console.log('====================================');

  const strategy = new ProgressiveSearchStrategy();

  // Mock subject property
  const subjectProperty = {
    address: "3128 McKenzie Dr, East Pt, GA 30344",
    sqft: 1323,
    bedrooms: 4,
    bathrooms: 3,
    yearBuilt: 1955,
    lat: 33.6946462,
    lng: -84.4630528
  };

  // Mock search service that returns controlled data
  const mockSearchService = {
    async searchComparables(address, radius, propertyType, limit) {
      console.log(`📡 MOCK SEARCH: radius=${radius}mi, limit=${limit}`);

      // Level 1 (1 mile): Return 4 comps, but only 2 within distance when filtered
      if (radius === 1) {
        return [
          {
            id: "L1_C1",
            address: "Comp 1 - Close",
            price: 200000,
            sqft: 1300,
            lat: 33.6950000, // ~0.3 miles
            lng: -84.4635000,
            saleDate: "2025-09-15"
          },
          {
            id: "L1_C2",
            address: "Comp 2 - Close",
            price: 220000,
            sqft: 1400,
            lat: 33.6955000, // ~0.6 miles
            lng: -84.4640000,
            saleDate: "2025-09-15"
          },
          {
            id: "L1_C3",
            address: "Comp 3 - Far",
            price: 250000,
            sqft: 1500,
            lat: 33.7100000, // ~1.2 miles (outside 1mi radius)
            lng: -84.4800000,
            saleDate: "2025-09-15"
          },
          {
            id: "L1_C4",
            address: "Comp 4 - Far",
            price: 280000,
            sqft: 1600,
            lat: 33.7200000, // ~1.8 miles (outside 1mi radius)
            lng: -84.4900000,
            saleDate: "2025-09-15"
          }
        ];
      }

      // Level 2 (2 miles): Return additional comps
      if (radius === 2) {
        return [
          {
            id: "L2_C1",
            address: "Comp 5 - Medium",
            price: 240000,
            sqft: 1350,
            lat: 33.7050000, // ~1.5 miles
            lng: -84.4750000,
            saleDate: "2025-09-15"
          },
          {
            id: "L2_C2",
            address: "Comp 6 - Medium",
            price: 260000,
            sqft: 1450,
            lat: 33.7080000, // ~1.7 miles
            lng: -84.4780000,
            saleDate: "2025-09-15"
          }
        ];
      }

      return [];
    }
  };

  console.log('\n📊 INITIAL STATE:');
  console.log(`Subject: ${subjectProperty.address}`);
  console.log(`Coordinates: ${subjectProperty.lat}, ${subjectProperty.lng}`);
  console.log(`Target: 6 distance-validated comps`);

  console.log('\n🎯 EXPECTED BEHAVIOR:');
  console.log('Level 1 (1mi): Find 4 raw comps, only 2 within distance → Continue to Level 2');
  console.log('Level 2 (2mi): Add 2 more comps, now have 4 total within distance → Continue to Level 3');
  console.log('Level 3 (3mi): Should reach 6+ distance-validated comps → Stop');

  try {
    console.log('\n🚀 STARTING PROGRESSIVE SEARCH:');
    console.log('================================');

    const result = await strategy.executeProgressiveSearch(
      subjectProperty.address,
      subjectProperty,
      mockSearchService,
      'single_family'
    );

    console.log('\n📋 FINAL RESULT:');
    console.log('================');
    console.log(`✅ Success: ${result.success}`);
    console.log(`📊 Total Comps: ${result.comparables?.length || 0}`);
    console.log(`🎯 Method: ${result.searchStrategy}`);
    console.log(`📝 Details: ${result.details}`);

    if (result.comparables) {
      console.log('\n🏠 FINAL COMPS:');
      result.comparables.forEach((comp, i) => {
        const ppsf = comp.price / comp.sqft;
        console.log(`${i+1}. ${comp.id}: $${comp.price.toLocaleString()} | ${comp.sqft}sqft | $${ppsf.toFixed(2)}/sqft`);
      });
    }

    console.log('\n🔍 DEBUGGING QUESTIONS:');
    console.log('======================');
    console.log('1. Did Level 1 correctly identify only 2 distance-valid comps?');
    console.log('2. Did Level 2 get triggered due to insufficient comps?');
    console.log('3. Were Level 1 comps accumulated into Level 2?');
    console.log('4. Was distance filtering applied per-level or globally?');

  } catch (error) {
    console.error('❌ Debug failed:', error);
    console.error('Stack:', error.stack);
  }
}

debugProgressiveSearch().catch(console.error);