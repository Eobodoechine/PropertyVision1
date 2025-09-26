import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

async function main() {
  const address = process.env.ADDRESS;
  const radius = Number(process.env.RADIUS || '1');
  const months = Number(process.env.MONTHS || '6');
  if (!address) throw new Error('ADDRESS env is required');

  console.log(`\n🔎 Single Search Run`);
  console.log(`Address: ${address}`);
  console.log(`Radius: ${radius} miles`);
  console.log(`Time window: ${months} months`);

  // Subject details (for filtering)
  let subjectDetails: any = undefined;
  try {
    const details = await fetchPropertyDetailsViaVertex(address);
    if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
      subjectDetails = { sqft: details.sqft, beds: details.beds, baths: details.baths, yearBuilt: details.yearBuilt };
      console.log(`🧩 Subject: ${subjectDetails.sqft} sqft | ${subjectDetails.beds}bd/${subjectDetails.baths}ba | Built ${subjectDetails.yearBuilt}`);
    } else {
      console.log(`⚠️  Subject details incomplete; proceeding without subject constraints.`);
    }
  } catch {
    console.log(`⚠️  Failed to fetch subject details; proceeding without subject constraints.`);
  }

  const service = new VertexComparableSearchService();
  const res = await service.findComparables(address, undefined, 50, radius, months, subjectDetails);

  if (!res.success) {
    console.log(`❌ Search failed: ${res.error}`);
    return;
  }

  console.log(`\n✅ Parsed ${res.comparables.length} comparable(s):`);
  res.comparables.forEach((c, i) => {
    const dist = Number.isFinite(c.distance) ? `${c.distance.toFixed(2)} mi` : 'N/A';
    console.log(`${i + 1}. ${c.address} | $${c.price.toLocaleString()} | ${c.soldDate} | ${c.sqft} sqft | ${c.beds}/${c.baths} | Built: ${c.yearBuilt ?? 'N/A'} | ${dist} | ${c.source}`);
  });
}

main().catch(err => { console.error('Run failed:', err?.message || err); process.exit(1); });

