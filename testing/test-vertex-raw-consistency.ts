import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testVertexRawConsistency() {
  console.log('🔬 VERTEX AI RAW RESPONSE CONSISTENCY TEST');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  console.log(`📍 Target: ${address}`);
  console.log(`🏘️  Subdivision: Bailey Oaks`);
  console.log('');

  // PHASE 1: Test what makes subdivision search work/fail
  console.log('🔍 PHASE 1: SUBDIVISION SEARCH TRIGGER ANALYSIS');
  console.log('============================================================');

  // Test different subdivision filter values
  const subdivisionTests = [
    'Bailey Oaks',
    'bailey oaks',
    'Bailey Oak',
    'Bailey Oaks Subdivision',
    'Bailey Oaks neighborhood',
    'Bailey',
    '',  // No subdivision filter
  ];

  for (const subdivision of subdivisionTests) {
    console.log(`\n📋 Testing subdivision filter: "${subdivision}"`);
    process.env.SUBDIVISION = subdivision;

    try {
      // We need to intercept the raw Vertex AI call before filtering
      // Let's make 3 quick calls to see raw consistency
      for (let call = 1; call <= 3; call++) {
        const result = await compService.findComparables(address, undefined, 20, 5, 24);

        if (result.success) {
          const rawCount = result.comparables?.length || 0;
          console.log(`   Call ${call}: ✅ ${rawCount} raw properties returned`);

          // Show first few addresses to see what Vertex AI actually returns
          if (result.comparables && result.comparables.length > 0) {
            const samples = result.comparables.slice(0, 3).map((c: any) => c.address);
            console.log(`      Sample: ${samples.join(', ')}`);
          }
        } else {
          console.log(`   Call ${call}: ❌ Failed - ${result.error}`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  process.env.SUBDIVISION = '';

  console.log('\n🔍 PHASE 2: RAW VERTEX AI CALL PATTERNS');
  console.log('============================================================');

  // Test 10 identical calls to see variation in raw Vertex AI responses
  console.log('Testing 10 identical Vertex AI calls (no filtering analysis)...');

  const rawResults = [];

  for (let run = 1; run <= 10; run++) {
    console.log(`\n🔄 Raw Call ${run}/10:`);

    try {
      const result = await compService.findComparables(address, undefined, 30, 4, 24);

      if (result.success) {
        const addresses = result.comparables?.map((c: any) => c.address) || [];
        rawResults.push({
          run,
          count: addresses.length,
          addresses: addresses,
          success: true
        });

        console.log(`   ✅ Returned ${addresses.length} properties`);
        console.log(`   🏠 First 3: ${addresses.slice(0, 3).join(', ')}`);

        // Check for Bailey Oaks/Jordan Pl properties specifically
        const baileyOaksProps = addresses.filter(addr =>
          addr.toLowerCase().includes('bailey') || addr.toLowerCase().includes('jordan pl')
        );

        if (baileyOaksProps.length > 0) {
          console.log(`   🎯 Bailey Oaks/Jordan Pl properties: ${baileyOaksProps.length}`);
          baileyOaksProps.forEach(prop => console.log(`      - ${prop}`));
        } else {
          console.log(`   ⚠️  No Bailey Oaks/Jordan Pl properties found`);
        }

      } else {
        rawResults.push({
          run,
          count: 0,
          addresses: [],
          success: false,
          error: result.error
        });
        console.log(`   ❌ Failed: ${result.error}`);
      }

    } catch (error: any) {
      rawResults.push({
        run,
        count: 0,
        addresses: [],
        success: false,
        error: error.message
      });
      console.log(`   ❌ Exception: ${error.message}`);
    }

    // Rate limiting between calls
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Analyze raw response patterns
  console.log('\n📊 RAW RESPONSE PATTERN ANALYSIS');
  console.log('============================================================');

  const successfulCalls = rawResults.filter(r => r.success);
  console.log(`✅ Successful calls: ${successfulCalls.length}/10`);

  if (successfulCalls.length > 0) {
    // Count analysis
    const counts = successfulCalls.map(r => r.count);
    const avgCount = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    console.log(`📈 Property counts: Min=${minCount}, Max=${maxCount}, Avg=${avgCount}`);
    console.log(`📊 Count variation: ±${maxCount - minCount} properties`);

    // Address overlap analysis
    const allAddresses = new Set();
    const addressFrequency = new Map();

    successfulCalls.forEach(result => {
      result.addresses.forEach((addr: string) => {
        allAddresses.add(addr);
        addressFrequency.set(addr, (addressFrequency.get(addr) || 0) + 1);
      });
    });

    console.log(`🏠 Total unique properties across all calls: ${allAddresses.size}`);

    // Consistency analysis
    const consistentProps = Array.from(addressFrequency.entries())
      .filter(([_, freq]) => freq >= Math.ceil(successfulCalls.length * 0.5))
      .sort((a, b) => b[1] - a[1]);

    const inconsistentProps = Array.from(addressFrequency.entries())
      .filter(([_, freq]) => freq < Math.ceil(successfulCalls.length * 0.5));

    console.log(`🔄 Consistent properties (50%+ appearance): ${consistentProps.length}`);
    console.log(`⚠️  Inconsistent properties (<50% appearance): ${inconsistentProps.length}`);

    if (consistentProps.length > 0) {
      console.log('\n🎯 MOST CONSISTENT PROPERTIES:');
      consistentProps.slice(0, 5).forEach(([addr, freq]) => {
        console.log(`   ${addr} (${freq}/${successfulCalls.length} calls)`);
      });
    }

    // Bailey Oaks specific analysis
    const baileyOaksCount = Array.from(addressFrequency.entries())
      .filter(([addr, _]) => addr.toLowerCase().includes('bailey') || addr.toLowerCase().includes('jordan'))
      .length;

    console.log(`\n🏘️  Bailey Oaks/Jordan properties found: ${baileyOaksCount}`);

  } else {
    console.log('❌ No successful calls to analyze');
  }

  console.log('\n🎯 KEY FINDINGS & NEXT STEPS:');
  console.log('============================================================');
  console.log('Based on this analysis, we can determine:');
  console.log('1. Whether Vertex AI responses are inherently inconsistent');
  console.log('2. What parameters affect response consistency');
  console.log('3. How often Bailey Oaks properties actually appear');
  console.log('4. Whether subdivision filtering works at the Vertex AI level');
}

testVertexRawConsistency().catch(console.error);