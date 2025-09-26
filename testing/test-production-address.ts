// Test the same address from the website using our production sequential gap outlier detection
import { ARVCalculationService } from '../server/step4-arv-calculation.js';

// Create the ARV service instance
const arvService = new ARVCalculationService();

// Subject property from the website
const subjectAddress = "6265 Gemstone Ct S, Atlanta, GA 30349";

// Mock comparables based on what's shown on the website (converted to our format)
const webComparables = [
  {
    address: "6286 Gemstone Ct, Atlanta, GA 30349",
    price: 340000,
    sqft: 2528,
    beds: 4,
    baths: 2.5,
    soldDate: "2025-05-09",
    distance: 0.03
  },
  {
    address: "6234 Gemstone Ct, Atlanta, GA 30349",
    price: 335000,
    sqft: 2400,
    beds: 4,
    baths: 2.5,
    soldDate: "2025-04-25",
    distance: 0.05
  },
  {
    address: "6514 Emerald Pointe Cir, Atlanta, GA 30349",
    price: 320000,
    sqft: 2800,
    beds: 5,
    baths: 3,
    soldDate: "2025-03-15",
    distance: 0.09
  },
  {
    address: "290 Gemstone Pl, Atlanta, GA 30349",
    price: 265000,
    sqft: 2608,
    beds: 3,
    baths: 2,
    soldDate: "2024-08-02",
    distance: 0.15
  },
  {
    address: "245 Gemstone Dr, Atlanta, GA 30349",
    price: 355000,
    sqft: 2900,
    beds: 4,
    baths: 3,
    soldDate: "2025-06-02",
    distance: 0.15
  },
  {
    address: "6485 Emerald Pointe Cir, Atlanta, GA 30349",
    price: 233000,
    sqft: 2370,
    beds: 3,
    baths: 2,
    soldDate: "2024-09-24",
    distance: 0.22
  },
  {
    address: "6265 Polar Fox Ct, Riverdale, GA 30296",
    price: 292700,
    sqft: 2646,
    beds: 4,
    baths: 2.5,
    soldDate: "2025-05-15",
    distance: 0.82
  },
  {
    address: "3184 Spruce Way, College Park, GA 30349",
    price: 320000,
    sqft: 2652,
    beds: 4,
    baths: 2.5,
    soldDate: "2025-09-20",
    distance: 0.83
  },
  {
    address: "3225 Redona Dr, Atlanta, GA 30349",
    price: 270000,
    sqft: 2473,
    beds: 5,
    baths: 2,
    soldDate: "2025-09-09",
    distance: 1.03
  }
];

async function testProductionAddress() {
  console.log(`🧪 TESTING PRODUCTION ADDRESS: ${subjectAddress}`);
  console.log(`=================================================`);
  console.log(`Website shows: $296,904 ARV with 9 comparables`);
  console.log(`Testing our sequential gap outlier detection...\n`);

  try {
    // Test with the comparables shown on the website
    const result = await arvService.calculateARV(
      subjectAddress,
      webComparables,
      2684, // sqft from website
      4,    // beds from website
      2.5   // baths from website
    );

    console.log(`\n📊 MCP SEQUENTIAL GAP OUTLIER DETECTION RESULTS:`);
    console.log(`===============================================`);
    console.log(`Subject: ${subjectAddress}`);
    console.log(`Subject Specs: 2684 sqft, 4 bed/2.5 bath`);
    console.log(`\n💰 ARV COMPARISON:`);
    console.log(`   Website ARV: $296,904`);
    console.log(`   MCP ARV: $${result.arv.toLocaleString()}`);
    console.log(`   Difference: $${Math.abs(result.arv - 296904).toLocaleString()}`);

    console.log(`\n📊 COMPARABLE COUNT COMPARISON:`);
    console.log(`   Website Comps Used: 9`);
    console.log(`   MCP Comps Used: ${result.comparablesUsed.length}`);
    console.log(`   Original Comps: ${webComparables.length}`);
    console.log(`   Outliers Removed: ${webComparables.length - result.comparablesUsed.length}`);

    console.log(`\n🎯 CONFIDENCE: ${result.confidence}`);
    console.log(`📊 Price Range: $${result.lowEstimate.toLocaleString()} - $${result.highEstimate.toLocaleString()}`);

    console.log(`\n📋 COMPARABLES USED BY MCP:`);
    result.comparablesUsed.forEach((comp, i) => {
      const ppsf = comp.price / comp.sqft;
      console.log(`   ${i + 1}. ${comp.address}`);
      console.log(`      $${comp.price.toLocaleString()} ($${ppsf.toFixed(0)}/sqft)`);
    });

    if (webComparables.length > result.comparablesUsed.length) {
      console.log(`\n❌ OUTLIERS REMOVED BY SEQUENTIAL GAP DETECTION:`);
      const removedComps = webComparables.filter(comp =>
        !result.comparablesUsed.some(used => used.address === comp.address)
      );
      removedComps.forEach(comp => {
        const ppsf = comp.price / comp.sqft;
        console.log(`   - ${comp.address}: $${comp.price.toLocaleString()} ($${ppsf.toFixed(0)}/sqft)`);
      });
    }

    console.log(`\n✅ PRODUCTION TEST COMPLETED!`);

  } catch (error) {
    console.error(`❌ PRODUCTION TEST FAILED:`, error);
  }
}

// Run the test
testProductionAddress();