import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

async function testBaileyOaksThreeTimes() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  console.log('🏘️ BAILEY OAKS SUBDIVISION SEARCH TEST (3 RUNS)');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`🏘️ Subdivision: Bailey Oaks`);
  console.log('');

  const allFoundComps = new Map<string, any>();
  const compFrequency = new Map<string, number>();

  for (let run = 1; run <= 3; run++) {
    console.log(`🔄 RUN ${run}: BAILEY OAKS SUBDIVISION SEARCH`);
    console.log('------------------------------------------------------------');

    // Set subdivision environment variable
    process.env.SUBDIVISION = 'Bailey Oaks';

    try {
      const result = await compService.findComparables(
        address,
        undefined, // property type
        20,       // max results
        5,        // radius miles
        18        // time window months
      );

      if (result.success && result.comparables.length > 0) {
        console.log(`   ✅ Found ${result.comparables.length} comps in run ${run}`);

        result.comparables.forEach((comp: any) => {
          const key = comp.address;
          if (!allFoundComps.has(key)) {
            allFoundComps.set(key, { ...comp, first_found_in_run: run });
          }
          compFrequency.set(key, (compFrequency.get(key) || 0) + 1);

          const ppsf = comp.price / comp.sqft;
          console.log(`      ${comp.address}`);
          console.log(`         💰 $${comp.price.toLocaleString()} | 📐 ${comp.sqft}sqft | 💲 $${ppsf.toFixed(2)} PPSF`);
          console.log(`         📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate} | 📍 ${comp.distance?.toFixed(2)}mi`);
        });
      } else {
        console.log(`   ❌ No comps found in run ${run}`);
        if (result.error) {
          console.log(`      Error: ${result.error}`);
        }
      }

      console.log('');

      // Wait 2 seconds between runs for rate limiting
      if (run < 3) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error: any) {
      console.log(`   ❌ Run ${run} failed: ${error.message}`);
    }
  }

  console.log('📊 BAILEY OAKS 3-RUN ANALYSIS');
  console.log('============================================================');
  console.log(`🔢 Total unique comps found: ${allFoundComps.size}`);

  if (allFoundComps.size > 0) {
    console.log('');
    console.log('📋 ALL COMPS FOUND ACROSS 3 RUNS:');

    Array.from(allFoundComps.values()).forEach((comp, i) => {
      const frequency = compFrequency.get(comp.address) || 0;
      const ppsf = comp.price / comp.sqft;
      console.log(`   ${i+1}. ${comp.address}`);
      console.log(`      💰 Price: $${comp.price.toLocaleString()} | PPSF: $${ppsf.toFixed(2)}`);
      console.log(`      📐 Size: ${comp.sqft}sqft (${comp.beds}BR/${comp.baths}BA)`);
      console.log(`      📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
      console.log(`      📍 Distance: ${comp.distance?.toFixed(2) || 'N/A'}mi`);
      console.log(`      🔄 Found in: ${frequency}/3 runs | First found: Run ${comp.first_found_in_run}`);
      console.log('');
    });

    console.log('🏆 CONSISTENCY ANALYSIS:');
    const consistent = Array.from(allFoundComps.values()).filter(comp =>
      compFrequency.get(comp.address)! >= 2
    );
    const inconsistent = Array.from(allFoundComps.values()).filter(comp =>
      compFrequency.get(comp.address)! === 1
    );

    console.log(`   ✅ Consistent comps (2+ runs): ${consistent.length}`);
    consistent.forEach(comp => {
      const frequency = compFrequency.get(comp.address);
      console.log(`      ${comp.address} (${frequency}/3 runs)`);
    });

    console.log(`   ⚠️  Inconsistent comps (1 run only): ${inconsistent.length}`);
    inconsistent.forEach(comp => {
      console.log(`      ${comp.address} (Run ${comp.first_found_in_run} only)`);
    });
  } else {
    console.log('❌ No Bailey Oaks comps found in any of the 3 runs');
    console.log('💡 This suggests:');
    console.log('   - No recent sales in Bailey Oaks subdivision');
    console.log('   - Properties don\'t meet our search criteria');
    console.log('   - Vertex AI isn\'t finding Bailey Oaks properties');
  }
}

testBaileyOaksThreeTimes().catch(console.error);