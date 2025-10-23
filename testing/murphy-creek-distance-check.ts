import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function checkMurphyCreekDistance() {
  console.log('📏 DISTANCE CHECK: 185 Jordan Pl to 215 Murphy Creek Ln');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // First, let me calculate the distance and get the actual sale info
  // by running a focused search from Jordan Pl with reasonable radius

  const radiusTests = [2, 3, 4, 5]; // Test different radii to find Murphy Creek

  for (const radius of radiusTests) {
    console.log(`\n🔍 TESTING ${radius} MILE RADIUS FROM JORDAN PL`);
    console.log('------------------------------------------------------------');

    try {
      const result = await compService.findComparables(
        '185 Jordan Pl, Fayetteville, GA 30215',
        undefined,
        100,    // Large result set
        radius, // Test radius
        120     // 10 years to ensure we find it
      );

      if (result.success) {
        console.log(`✅ Found ${result.comparables.length} total properties within ${radius} miles`);

        // Look for Murphy Creek properties
        const murphyCreekProps = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy creek')
        );

        if (murphyCreekProps.length > 0) {
          console.log(`🎯 MURPHY CREEK PROPERTIES FOUND within ${radius} miles:`);
          murphyCreekProps.forEach((comp: any) => {
            console.log(`   📍 ${comp.address}`);
            console.log(`   📏 Distance: ${comp.distance?.toFixed(2)} miles from Jordan Pl`);
            console.log(`   📅 Sale Date: ${comp.soldDate}`);
            console.log(`   💰 Sale Price: $${comp.price?.toLocaleString()}`);
            console.log(`   🏠 Details: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft} sqft, Built ${comp.yearBuilt}`);
            console.log('');
          });

          // If we found Murphy Creek, no need to test larger radii
          break;
        } else {
          console.log(`❌ No Murphy Creek properties found within ${radius} miles`);
        }
      } else {
        console.log(`❌ Search failed for ${radius} mile radius`);
      }
    } catch (error: any) {
      console.log(`❌ Error testing ${radius} mile radius: ${error.message}`);
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Additional strategy: Search by 30215 zip code with Murphy Creek filter
  console.log('\n🏘️  ZIP CODE SEARCH: 30215 + Murphy Creek Filter');
  console.log('------------------------------------------------------------');

  try {
    const zipResult = await compService.findComparables(
      'Fayetteville, GA 30215',
      undefined,
      100,
      8,    // Reasonable radius for zip code
      120   // Long time window
    );

    if (zipResult.success) {
      const murphyCreekInZip = zipResult.comparables.filter((comp: any) =>
        comp.address.toLowerCase().includes('murphy creek')
      );

      console.log(`🔍 Found ${murphyCreekInZip.length} Murphy Creek properties in 30215 zip code`);

      murphyCreekInZip.forEach((comp: any) => {
        console.log(`   ${comp.address} - ${comp.soldDate} - $${comp.price?.toLocaleString()}`);
      });
    }
  } catch (error: any) {
    console.log(`❌ Zip code search error: ${error.message}`);
  }
}

checkMurphyCreekDistance().catch(console.error);