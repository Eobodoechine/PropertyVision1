import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  console.log('🏃 Live Comparable Search');
  console.log('========================');
  console.log('Address:', address);
  console.log('Model:', process.env.VERTEX_MODEL || 'gemini-2.5-pro');
  console.log('Location:', process.env.VERTEX_LOCATION || 'us-central1');

  const service = new VertexComparableSearchService();

  // Try to fetch subject details to enable size/date filtering against subject
  let subjectDetails: { sqft: number; beds: number; baths: number; yearBuilt: number } | undefined;
  try {
    const details = await fetchPropertyDetailsViaVertex(address);
    if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
      subjectDetails = {
        sqft: details.sqft,
        beds: details.beds,
        baths: details.baths,
        yearBuilt: details.yearBuilt,
      } as any;
      console.log(`\n🧩 Subject details: ${subjectDetails.sqft} sqft | ${subjectDetails.beds}bd/${subjectDetails.baths}ba | Built ${subjectDetails.yearBuilt}`);
    } else {
      console.log('\n⚠️  Subject details incomplete; proceeding without subject constraints.');
    }
  } catch (e) {
    console.log('\n⚠️  Failed to fetch subject details; proceeding without subject constraints.');
  }

  try {
    const result = await service.findComparables(address, undefined, 10, 3, 18, subjectDetails as any);
    if (result.success && result.comparables.length > 0) {
      console.log(`\n✅ Found ${result.comparables.length} comparables:`);
      for (const [i, comp] of result.comparables.entries()) {
        console.log(`\n${i + 1}. ${comp.address}`);
        console.log(`   Price: $${comp.price.toLocaleString()}`);
        console.log(`   Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
        console.log(`   Built: ${comp.yearBuilt}`);
        console.log(`   Sold: ${comp.soldDate}`);
        console.log(`   Distance: ${comp.distance.toFixed(2)} miles`);
        console.log(`   Source: ${comp.source}`);
        console.log(`   Confidence: ${comp.confidence}`);
      }
    } else {
      console.log('\n❌ No comparables found');
      if (result.error) console.log('Error:', result.error);
    }
  } catch (err: any) {
    console.error('❌ Live run failed:', err?.message || err);
  }
}

main().catch(console.error);
