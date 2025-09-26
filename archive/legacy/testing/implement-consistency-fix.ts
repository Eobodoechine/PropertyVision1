// CONSISTENCY SOLUTION: Multiple Call Aggregation for Subdivision Search
// This approach solves the Vertex AI variability issue

class ConsistentSubdivisionSearch {

  // Main function: Get consistent subdivision results
  async getConsistentSubdivisionComps(
    compService: any,
    address: string,
    subdivision: string,
    maxResults: number = 20,
    radius: number = 3,
    timeWindow: number = 24
  ) {
    console.log(`🔄 CONSISTENT SUBDIVISION SEARCH: ${subdivision}`);

    // STRATEGY: Make multiple calls and aggregate results
    const numCalls = 3; // Based on our testing, 3 calls capture most properties
    const allComps = new Map<string, any>();
    const compFrequency = new Map<string, number>();
    let successfulCalls = 0;

    // Set subdivision filter
    process.env.SUBDIVISION = subdivision;

    for (let call = 1; call <= numCalls; call++) {
      console.log(`   📞 Call ${call}/${numCalls}...`);

      try {
        const result = await compService.findComparables(
          address, undefined, maxResults, radius, timeWindow
        );

        if (result.success && result.comparables.length > 0) {
          successfulCalls++;
          console.log(`      ✅ Found ${result.comparables.length} comps`);

          // Track each comparable and its frequency
          result.comparables.forEach((comp: any) => {
            const key = comp.address;
            if (!allComps.has(key)) {
              allComps.set(key, comp);
            }
            compFrequency.set(key, (compFrequency.get(key) || 0) + 1);
          });

        } else {
          console.log(`      ❌ No results`);
        }

        // Rate limiting between calls
        if (call < numCalls) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error: any) {
        console.log(`      ❌ Call failed: ${error.message}`);
      }
    }

    // Reset subdivision filter
    process.env.SUBDIVISION = '';

    // AGGREGATION STRATEGIES
    console.log(`\n   📊 Aggregation Results (${successfulCalls}/${numCalls} successful calls):`);

    // Strategy 1: Union (all unique properties found)
    const unionComps = Array.from(allComps.values());
    console.log(`      🔗 Union: ${unionComps.length} unique properties`);

    // Strategy 2: Majority consensus (appeared in 2+ calls)
    const majorityComps = unionComps.filter(comp =>
      compFrequency.get(comp.address)! >= 2
    );
    console.log(`      🗳️  Majority (2+ calls): ${majorityComps.length} properties`);

    // Strategy 3: High confidence (appeared in 60%+ of successful calls)
    const confidenceThreshold = Math.ceil(successfulCalls * 0.6);
    const highConfidenceComps = unionComps.filter(comp =>
      compFrequency.get(comp.address)! >= confidenceThreshold
    );
    console.log(`      🎯 High confidence (${confidenceThreshold}+ calls): ${highConfidenceComps.length} properties`);

    // Show the most consistent properties
    if (unionComps.length > 0) {
      console.log(`\n   🏠 Properties found:`);
      Array.from(compFrequency.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([address, frequency]) => {
          const comp = allComps.get(address)!;
          const confidence = frequency >= confidenceThreshold ? '🎯' :
                           frequency >= 2 ? '🗳️' : '⚠️';
          console.log(`      ${confidence} ${address} (${frequency}/${successfulCalls} calls) - $${comp.price?.toLocaleString()}`);
        });
    }

    // RETURN STRATEGY: Use high confidence if available, otherwise majority, otherwise union
    const finalComps = highConfidenceComps.length >= 2 ? highConfidenceComps :
                      majorityComps.length >= 1 ? majorityComps :
                      unionComps;

    console.log(`   ✅ Selected strategy: ${finalComps.length} properties using ${
      finalComps === highConfidenceComps ? 'high confidence' :
      finalComps === majorityComps ? 'majority consensus' : 'union'
    }`);

    return {
      success: finalComps.length > 0,
      comparables: finalComps,
      consistency: {
        totalCalls: numCalls,
        successfulCalls,
        uniqueProperties: unionComps.length,
        majorityProperties: majorityComps.length,
        highConfidenceProperties: highConfidenceComps.length
      }
    };
  }
}

// DEMONSTRATION
async function demonstrateConsistencyFix() {
  console.log('🚀 DEMONSTRATING CONSISTENCY FIX');
  console.log('============================================================');

  const { VertexComparableSearchService } = await import('../server/step3-find-comparables.js');
  const compService = new VertexComparableSearchService();
  const consistentSearch = new ConsistentSubdivisionSearch();

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const subdivision = 'Bailey Oaks';

  console.log(`📍 Target: ${address}`);
  console.log(`🏘️  Subdivision: ${subdivision}`);

  // Test the consistent search
  const result = await consistentSearch.getConsistentSubdivisionComps(
    compService, address, subdivision, 20, 3, 24
  );

  console.log('\n🎯 FINAL RESULT:');
  console.log('============================================================');
  console.log(`Success: ${result.success}`);
  console.log(`Properties: ${result.comparables.length}`);
  console.log(`Consistency stats:`, result.consistency);

  if (result.success) {
    console.log('\n🏠 Final comparable properties:');
    result.comparables.forEach((comp: any, i: number) => {
      console.log(`   ${i+1}. ${comp.address} - $${comp.price?.toLocaleString()}`);
    });
  }

  console.log('\n💡 IMPLEMENTATION NOTES:');
  console.log('============================================================');
  console.log('1. This approach can be integrated into step3-find-comparables.ts');
  console.log('2. Use for subdivision search first, then fallback to broader search');
  console.log('3. Significantly improves consistency by aggregating multiple calls');
  console.log('4. Adaptive strategy selection based on confidence levels');
}

demonstrateConsistencyFix().catch(console.error);