import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function main() {
  console.log('🧪 TEST: parseVertexResponse end-to-end (with enrichment)');
  console.log('============================================================');

  const compService = new VertexComparableSearchService();

  // Override distance calc to avoid external geocoding in this unit-style test
  (compService as any).calculateDistance = async () => 0;

  const subjectAddress = '280 Ridgemont Dr, Fayetteville, GA 30215';
  const subjectDetails = { sqft: 2350, beds: 3, baths: 2, yearBuilt: 1988 };

  // Use dummy subject coordinates (distance overridden to 0 above)
  const subjectLat = 33.4483;
  const subjectLon = -84.4549;

  // Lines designed to exercise flexible date, unicode baths, numeric cleaning
  const lines = [
    '280 Ridgemont Dr, Fayetteville, GA 30215 | 420000 | 2025-06-15 | 3 | 2 | 2350 | 1988 | zillow.com',
    '123 Main St, Fayetteville, GA 30215 | $389,500 | 04/15/2024 | 4 | 2.5 | 2100 | 1998 | redfin.com',
    '456 Oak Ln, Fayetteville, GA 30215 | 445000 | 2024-11-05 | 3 | 2½ | 1950 | 2005 | realtor.com',
    '789 Pine Ave, Fayetteville, GA 30215 | 515000 | 2024-12-22 | 4 | 3 | 2350 | 2010 | zillow.com',
  ].join('\n');

  try {
    const comps = await (compService as any).parseVertexResponse(
      lines,
      subjectLat,
      subjectLon,
      subjectDetails
    );

    if (!comps || comps.length === 0) {
      console.log('❌ No comparables parsed.');
      return;
    }

    console.log(`✅ Parsed ${comps.length} comparable(s):`);
    for (const c of comps) {
      console.log('---');
      console.log(`Address: ${c.address}`);
      console.log(`Price: $${c.price.toLocaleString()}`);
      console.log(`Sold: ${c.soldDate}`);
      console.log(`Beds/Baths: ${c.beds}/${c.baths}`);
      console.log(`Size: ${c.sqft} sqft`);
      console.log(`Year: ${c.yearBuilt}`);
      console.log(`Distance: ${c.distance.toFixed(2)} mi`);
      console.log(`Source: ${c.source}`);
      console.log(`Confidence: ${c.confidence}`);
    }
  } catch (err: any) {
    console.error('❌ ERROR running parseVertexResponse test:', err?.message || err);
  }
}

main().catch(console.error);

