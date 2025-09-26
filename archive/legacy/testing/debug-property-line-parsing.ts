import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function debugPropertyLineParsing() {
  console.log('🐛 DEBUG: Property Line LLM Parsing');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // A set of property lines to exercise parsing, including tricky cases
  const lines = [
    // ISO date, clean numbers
    "280 Ridgemont Dr, Fayetteville, GA 30215 | 420000 | 2025-06-15 | 3 | 2 | 2350 | 1988 | zillow.com",
    // Slash date format to test fallback
    "123 Main St, Fayetteville, GA 30215 | $389,500 | 04/15/2024 | 4 | 2.5 | 2100 | 1998 | redfin.com",
    // Unicode half bath to test normalization
    "456 Oak Ln, Fayetteville, GA 30215 | 445000 | 2024-11-05 | 3 | 2½ | 1800 | 2005 | realtor.com",
    // Commas in sqft to test numeric cleaning
    "789 Pine Ave, Fayetteville, GA 30215 | 515000 | 2023-12-22 | 4 | 3 | 2,350 | 2010 | zillow.com",
  ];

  for (const testLine of lines) {
    console.log('📝 Testing with property line:');
    console.log(`   "${testLine}"`);
    console.log('');

    try {
      // Access the private method for testing (TypeScript hack)
      const result = await (compService as any).parsePropertyDataWithLLM(testLine);

      if (result) {
        console.log('✅ LLM PARSING SUCCESS:');
        console.log(`   Address: "${result.address}"`);
        console.log(`   Price: ${result.price}`);
        console.log(`   Sold Date: ${result.soldDate}`);
        console.log(`   Beds: ${result.beds}`);
        console.log(`   Baths: ${result.baths}`);
        console.log(`   Sqft: ${result.sqft}`);
        console.log(`   Year Built: ${result.yearBuilt}`);
        console.log(`   Source: "${result.source}"`);
      } else {
        console.log('❌ LLM PARSING FAILED: Returned null');
      }

    } catch (error: any) {
      console.log(`❌ LLM PARSING ERROR: ${error.message}`);
      console.log(`Stack: ${error.stack}`);
    }

    // small delay between calls
    await new Promise(r => setTimeout(r, 1000));
    console.log('');
  }
}

debugPropertyLineParsing().catch(console.error);
