import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

async function debug105Bailey() {
  console.log('🔍 DEBUGGING 105 BAILEY CT SALE DATE');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // Set subdivision to Bailey Oaks to ensure we get Bailey Ct properties
  process.env.SUBDIVISION = 'Bailey Oaks';

  console.log('🏘️  Searching Bailey Oaks subdivision for Bailey Ct properties...');
  console.log('📅 Current date:', new Date().toISOString().split('T')[0]);
  console.log('');

  try {
    const result = await compService.findComparables(
      '185 Jordan Pl, Fayetteville, GA 30215',
      undefined, // property type
      20,       // max results
      3,        // radius miles
      24        // time window months (expanded to catch older dates)
    );

    if (result.success && result.comparables.length > 0) {
      console.log('✅ FOUND PROPERTIES:');
      console.log('');

      result.comparables.forEach((comp: any, i: number) => {
        console.log(`${i+1}. ${comp.address}`);
        console.log(`   💰 Price: $${comp.price.toLocaleString()}`);
        console.log(`   📐 Size: ${comp.sqft} sqft`);
        console.log(`   🛏️  Beds/Baths: ${comp.beds}BR/${comp.baths}BA`);
        console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
        console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);

        // Calculate age manually to verify
        const soldDate = new Date(comp.soldDate);
        const today = new Date();
        const ageInMonths = Math.floor((today.getTime() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
        console.log(`   ⏰ Age calculation: ${ageInMonths} months old`);

        // Check if this is 105 Bailey Ct
        if (comp.address.includes('105 Bailey')) {
          console.log(`   🎯 THIS IS 105 BAILEY CT!`);
          console.log(`   📋 Raw sale date string: "${comp.soldDate}"`);
          console.log(`   📅 Parsed date: ${soldDate.toISOString()}`);
          console.log(`   🧮 Manual verification:`);
          console.log(`      Today: ${today.toISOString().split('T')[0]}`);
          console.log(`      Sold: ${soldDate.toISOString().split('T')[0]}`);
          console.log(`      Difference: ${ageInMonths} months`);
        }
        console.log('');
      });
    } else {
      console.log('❌ No Bailey Ct properties found in current search');
      console.log(`   Success: ${result.success}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

  } catch (error: any) {
    console.log(`❌ Search failed: ${error.message}`);
  }

  // Reset subdivision
  process.env.SUBDIVISION = '';
}

debug105Bailey().catch(console.error);