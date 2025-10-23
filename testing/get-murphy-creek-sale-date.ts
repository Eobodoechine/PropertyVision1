import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function getMurphyCreekSaleDate() {
  console.log('🔍 FINDING ACTUAL SALE DATE FOR 215 MURPHY CREEK LN');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // Strategy 1: Search very broadly to capture Murphy Creek properties regardless of time
  console.log('\n📅 STRATEGY 1: ULTRA-WIDE TIME SEARCH (10 years)');
  console.log('------------------------------------------------------------');

  try {
    const result = await compService.findComparables(
      '215 Murphy Creek Ln, Fayetteville, GA 30215', // Use exact address as subject
      undefined,
      100,  // Large result set
      10,   // Wide radius
      120   // 10 years back
    );

    if (result.success && result.comparables.length > 0) {
      console.log(`✅ Found ${result.comparables.length} properties in wide search`);

      // Look for Murphy Creek properties specifically
      const murphyCreekProps = result.comparables.filter((comp: any) =>
        comp.address.toLowerCase().includes('murphy creek') ||
        comp.address.toLowerCase().includes('215 murphy creek')
      );

      if (murphyCreekProps.length > 0) {
        console.log(`🎯 MURPHY CREEK PROPERTIES FOUND:`);
        murphyCreekProps.forEach((comp: any) => {
          console.log(`   ${comp.address}`);
          console.log(`   Sale Date: ${comp.soldDate}`);
          console.log(`   Sale Price: $${comp.price?.toLocaleString()}`);
          console.log(`   Size: ${comp.sqft} sqft`);
          console.log('');
        });
      } else {
        console.log('❌ No Murphy Creek properties found in wide search');

        // Show all properties for analysis
        console.log('\n📋 ALL PROPERTIES FOUND (for debugging):');
        result.comparables.slice(0, 10).forEach((comp: any) => {
          console.log(`   ${comp.address} - ${comp.soldDate} - $${comp.price?.toLocaleString()}`);
        });
      }
    } else {
      console.log('❌ Wide search failed or returned no results');
    }
  } catch (error: any) {
    console.log(`❌ Error in wide search: ${error.message}`);
  }

  // Strategy 2: Search from nearby address to find Murphy Creek in area
  console.log('\n📍 STRATEGY 2: NEARBY AREA SEARCH');
  console.log('------------------------------------------------------------');

  try {
    const nearbyResult = await compService.findComparables(
      '185 Jordan Pl, Fayetteville, GA 30215',
      undefined,
      100,
      8,    // 8 mile radius
      72    // 6 years back
    );

    if (nearbyResult.success) {
      const murphyCreekNearby = nearbyResult.comparables.filter((comp: any) =>
        comp.address.toLowerCase().includes('murphy creek')
      );

      console.log(`🔍 Found ${murphyCreekNearby.length} Murphy Creek properties near Jordan Pl`);

      murphyCreekNearby.forEach((comp: any) => {
        console.log(`   ${comp.address} - ${comp.soldDate} - $${comp.price?.toLocaleString()}`);
      });
    }
  } catch (error: any) {
    console.log(`❌ Nearby search error: ${error.message}`);
  }

  // Strategy 3: Direct property lookup with minimal filters
  console.log('\n🎯 STRATEGY 3: DIRECT MURPHY CREEK SEARCH');
  console.log('------------------------------------------------------------');

  try {
    // Search specifically for Murphy Creek Lane properties
    const directResult = await compService.findComparables(
      'Murphy Creek Ln, Fayetteville, GA 30215',
      undefined,
      50,
      15,   // Very wide radius
      180   // 15 years back
    );

    if (directResult.success) {
      console.log(`🔍 Direct Murphy Creek search found ${directResult.comparables.length} properties`);

      directResult.comparables.forEach((comp: any) => {
        if (comp.address.toLowerCase().includes('murphy creek')) {
          console.log(`   🏠 ${comp.address}`);
          console.log(`       Date: ${comp.soldDate}`);
          console.log(`       Price: $${comp.price?.toLocaleString()}`);
          console.log(`       Details: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft}sqft`);
          console.log('');
        }
      });
    }
  } catch (error: any) {
    console.log(`❌ Direct search error: ${error.message}`);
  }

  console.log('\n💡 NEXT STEPS:');
  console.log('============================================================');
  console.log('If Murphy Creek properties are found above, use the actual sale dates');
  console.log('to adjust search parameters and test consistency methods properly.');
}

getMurphyCreekSaleDate().catch(console.error);