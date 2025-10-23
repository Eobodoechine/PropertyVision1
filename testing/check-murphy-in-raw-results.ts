import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function checkMurphyInRawResults() {
  console.log('🔍 CHECK: Is Murphy Creek in RAW Vertex AI Results?');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // Test with exactly 3 miles (Murphy Creek is 2.3 miles away)
  console.log('📐 Searching 3-mile radius from Jordan Pl...');
  console.log('');

  try {
    const result = await compService.findComparables(
      '185 Jordan Pl, Fayetteville, GA 30215',
      undefined,
      50,  // 50 results
      3,   // 3 mile radius
      72   // 6 years back
    );

    if (result.success && result.comparables) {
      console.log(`✅ Search successful: ${result.comparables.length} total properties found`);
      console.log('');

      // List ALL properties to see what we're getting
      console.log('📋 ALL PROPERTIES FOUND:');
      result.comparables.forEach((comp: any, i: number) => {
        const isMurphy = comp.address.toLowerCase().includes('murphy');
        const marker = isMurphy ? '🎯 MURPHY!' : `${i+1}.`;
        console.log(`   ${marker} ${comp.address}`);
      });

      // Check specifically for Murphy Creek
      const murphyProps = result.comparables.filter((comp: any) =>
        comp.address.toLowerCase().includes('murphy creek') ||
        comp.address.toLowerCase().includes('murphy lane') ||
        comp.address.toLowerCase().includes('murphy ln')
      );

      console.log('');
      if (murphyProps.length > 0) {
        console.log('🎯 MURPHY CREEK PROPERTIES FOUND:');
        murphyProps.forEach((comp: any) => {
          console.log(`   📍 Address: ${comp.address}`);
          console.log(`   💰 Price: $${comp.price?.toLocaleString()}`);
          console.log(`   📅 Sale Date: ${comp.soldDate}`);
          console.log(`   🏠 Details: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft} sqft`);
          console.log(`   📏 Distance: ${comp.distance?.toFixed(2)} miles`);
          console.log(`   🎯 Source: ${comp.source}`);
          console.log('');
        });
      } else {
        console.log('❌ NO MURPHY CREEK PROPERTIES in qualified results');

        // Check for any Murphy at all
        const anyMurphy = result.comparables.filter((comp: any) =>
          comp.address.toLowerCase().includes('murphy')
        );

        if (anyMurphy.length > 0) {
          console.log('🔍 But found other Murphy properties:');
          anyMurphy.forEach((comp: any) => {
            console.log(`   • ${comp.address}`);
          });
        } else {
          console.log('❌ No Murphy properties of any kind found');
        }
      }

    } else {
      console.log('❌ Search failed or returned no results');
      console.log(`Error: ${result.error || 'Unknown error'}`);
    }

  } catch (error: any) {
    console.log(`❌ Search error: ${error.message}`);
  }

  console.log('');
  console.log('📊 ANALYSIS:');
  console.log('============================================================');
  console.log('🎯 If Murphy Creek appears above: Property exists in Vertex AI data');
  console.log('❌ If Murphy Creek missing: Property not in Vertex AI search results');
  console.log('🔍 Next step: Check if property exists at that address manually');
}

checkMurphyInRawResults().catch(console.error);