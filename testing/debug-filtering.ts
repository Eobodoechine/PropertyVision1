import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

async function debugFiltering() {
  console.log('🐛 DEBUGGING FILTERING AND PROMPTS');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  // Subject details from our property research
  const subjectDetails = {
    sqft: 2331,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998
  };

  console.log('📍 SUBJECT PROPERTY:');
  console.log(`   Address: ${address}`);
  console.log(`   Size: ${subjectDetails.sqft} sqft`);
  console.log(`   Beds/Baths: ${subjectDetails.beds}BR/${subjectDetails.baths}BA`);
  console.log(`   Built: ${subjectDetails.yearBuilt}`);
  console.log('');

  console.log('📏 SIZE VARIANCE CALCULATIONS:');
  console.log(`   ±20% range: ${Math.round(subjectDetails.sqft * 0.8)} - ${Math.round(subjectDetails.sqft * 1.2)} sqft`);
  console.log('');

  // Test the problematic comps manually
  const testComps = [
    { address: '100 Bailey Ct', sqft: 1762, price: 310000 },
    { address: '110 Bailey Ct', sqft: 1975, price: 401000 },
    { address: '115 Brookwood Ln', sqft: 1897, price: 360000 },
    { address: '203 Shelby Ln', sqft: 4730, price: 1020000 }
  ];

  console.log('🧮 MANUAL SIZE VARIANCE CHECKS:');
  testComps.forEach(comp => {
    const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft;
    const passes = sizeVariance <= 0.20;
    const status = passes ? '✅ SHOULD PASS' : '❌ SHOULD FAIL';

    console.log(`   ${comp.address}:`);
    console.log(`      Size: ${comp.sqft} sqft`);
    console.log(`      Variance: ${(sizeVariance * 100).toFixed(1)}%`);
    console.log(`      ${status} (limit: 20%)`);
    console.log('');
  });

  // Now let me show the actual prompts used
  console.log('📋 VERTEX AI SEARCH PROMPTS USED:');
  console.log('============================================================');

  // Set subdivision for prompt testing
  process.env.SUBDIVISION = 'Bailey Oaks';

  console.log('🏘️  SUBDIVISION SEARCH PROMPT:');
  console.log('------------------------------------------------------------');

  // This will show the actual prompt without running the search
  console.log(`REAL ESTATE COMPARABLE SEARCH - VERTEX AI GROUNDED ANALYSIS

Use Google Search grounding with authoritative MLS data sources to find recently SOLD comparable properties.

TARGET PROPERTY: ${address}

SEARCH CRITERIA (STRICT REQUIREMENTS):
- Location: Within 3 miles of ${address}
- Time frame: Sold within last 18 months (SOLD properties only, not listings)
- Property type: Single-family homes, townhomes, condos
- Subdivision: Only include properties in subdivision "Bailey Oaks".

SEARCH METHODOLOGY FOR CONSISTENT RESULTS:
1. Query multiple authoritative sources in this order:
   - MLS data via Zillow, Redfin, Realtor.com
   - County records for verification
   - Real estate databases
2. Use consistent search terms: "recently sold" + "Fayetteville, GA 30215"
3. Filter for properties with complete sale data only

REQUIRED DATA FOR EACH PROPERTY:
- Complete street address with city, state, ZIP
- Actual sale price (not listing price)
- Sale date in YYYY-MM-DD format
- Bedrooms and bathrooms (exact numbers)
- Square footage (living area)
- Year built
- Source website (Zillow, Redfin, Realtor.com, etc.)

SEARCH SOURCES:
Use authoritative real estate sources like:
- site:zillow.com "Fayetteville, GA 30215" recently sold
- site:redfin.com "Fayetteville, GA 30215" sold
- site:realtor.com "Fayetteville, GA 30215" sold properties

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url

Example:
123 Main St, Fayetteville, GA 30215 | 425000 | 2024-03-15 | 4 | 3 | 2100 | 1998 | zillow.com

Find 50 best comparable properties with complete, verified data.`);

  console.log('');
  console.log('🔍 CHECKING FOR MURPHY CREEK PROPERTIES:');
  console.log('------------------------------------------------------------');

  // Let me search our previous results for Murphy Creek
  const murphyProperties = [
    '125 Murphy Creek Ln - $472,250 (07/2025, 2 months ago)',
    '215 Murphy Creek Ln - $445,000 (06/2025, 3 months ago)',
    '150 Murphy Creek Ln - $540,000 (06/2025, 3 months ago)'
  ];

  console.log('📊 MURPHY CREEK PROPERTIES FROM LOOKUP:');
  murphyProperties.forEach(prop => {
    console.log(`   ${prop}`);
  });

  console.log('');
  console.log('❓ WHY MURPHY CREEK NOT IN CURRENT RESULTS:');
  console.log('   1. Vertex AI search inconsistency - different properties each run');
  console.log('   2. May appear in other search runs of 4-search strategy');
  console.log('   3. Need to check if they pass distance filtering (may be >2 miles)');
}

debugFiltering().catch(console.error);