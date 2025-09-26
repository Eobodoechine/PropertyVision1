import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testConsistencySolutions() {
  console.log('🔧 TESTING CONSISTENCY SOLUTIONS');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  // SOLUTION 1: Multiple Calls with Union
  console.log('\n💡 SOLUTION 1: Multiple Calls + Union (3 calls)');
  console.log('------------------------------------------------------------');

  process.env.SUBDIVISION = 'Bailey Oaks';
  const unionResults = new Map();

  for (let call = 1; call <= 3; call++) {
    console.log(`Call ${call}...`);
    const result = await compService.findComparables(address, undefined, 20, 3, 24);

    if (result.success) {
      console.log(`   Found: ${result.comparables.length} properties`);
      result.comparables.forEach((comp: any) => {
        unionResults.set(comp.address, comp);
      });
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`📊 Union Result: ${unionResults.size} unique properties total`);
  Array.from(unionResults.keys()).forEach(addr => console.log(`   - ${addr}`));

  // SOLUTION 2: Majority Consensus (5 calls)
  console.log('\n💡 SOLUTION 2: Majority Consensus (5 calls)');
  console.log('------------------------------------------------------------');

  const consensusResults = new Map();

  for (let call = 1; call <= 5; call++) {
    console.log(`Call ${call}...`);
    const result = await compService.findComparables(address, undefined, 20, 3, 24);

    if (result.success) {
      result.comparables.forEach((comp: any) => {
        const key = comp.address;
        if (consensusResults.has(key)) {
          consensusResults.get(key).count++;
        } else {
          consensusResults.set(key, { comp, count: 1 });
        }
      });
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Properties appearing in 3+ out of 5 calls (60% consensus)
  const majorityComps = Array.from(consensusResults.entries())
    .filter(([_, data]) => data.count >= 3)
    .map(([_, data]) => data.comp);

  console.log(`📊 Majority Consensus: ${majorityComps.length} properties (3+ appearances)`);
  Array.from(consensusResults.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([addr, data]) => {
      console.log(`   ${addr} (${data.count}/5 calls)`);
    });

  // SOLUTION 3: Rapid Aggregation (7 fast calls)
  console.log('\n💡 SOLUTION 3: Rapid Aggregation (7 calls, 500ms apart)');
  console.log('------------------------------------------------------------');

  const rapidResults = new Map();

  for (let call = 1; call <= 7; call++) {
    console.log(`Rapid call ${call}...`);
    const result = await compService.findComparables(address, undefined, 15, 3, 24);

    if (result.success) {
      result.comparables.forEach((comp: any) => {
        rapidResults.set(comp.address, comp);
      });
    }
    await new Promise(resolve => setTimeout(resolve, 500)); // Faster
  }

  console.log(`📊 Rapid Aggregation: ${rapidResults.size} unique properties`);

  process.env.SUBDIVISION = '';

  console.log('\n🎯 RECOMMENDED APPROACH:');
  console.log('============================================================');
  console.log('Based on testing:');
  console.log('1. Use "Bailey Oaks" subdivision-specific search');
  console.log('2. Make 3-5 calls and use union of results');
  console.log('3. Apply majority consensus for most reliable properties');
  console.log('4. This should consistently find 100 Bailey Ct, 110 Bailey Ct, etc.');
}

testConsistencySolutions().catch(console.error);