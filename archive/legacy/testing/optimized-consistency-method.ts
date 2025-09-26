import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

// OPTIMIZED CONSISTENCY METHOD - Based on 2025 Research & Testing Results
class OptimizedConsistencySearch {

  // STRATEGY 1: Self-MoA (Self Mixture of Agents) with Parameter Variation
  async selfMoASearch(
    compService: any,
    address: string,
    subjectDetails: any,
    targetStreets: string[] = ['murphy', 'ridgemont']
  ) {
    console.log('🤖 SELF-MoA: Multiple parameter variations with consensus');

    // Multiple parameter sets for diversity - based on findings that Ridgemont Dr appears reliably
    const paramSets = [
      { radius: 4, time: 24, results: 30, temp: 'standard' },
      { radius: 4.5, time: 30, results: 35, temp: 'slightly_higher' },
      { radius: 5, time: 36, results: 40, temp: 'diverse' },
      { radius: 3.5, time: 18, results: 25, temp: 'conservative' },
      { radius: 5.5, time: 42, results: 45, temp: 'comprehensive' }
    ];

    const allTargets = new Map();
    const voteCounts = new Map();
    let successfulRuns = 0;

    process.env.SUBDIVISION = ''; // Ensure non-subdivision search

    for (let i = 0; i < paramSets.length; i++) {
      const params = paramSets[i];
      console.log(`   Agent ${i+1}: ${params.radius}mi, ${params.time}mo, ${params.results} max (${params.temp})...`);

      try {
        const result = await compService.findComparables(
          address, undefined, params.results, params.radius, params.time, subjectDetails
        );

        if (result.success) {
          successfulRuns++;

          // Track all target street properties
          const targets = result.comparables.filter((comp: any) =>
            targetStreets.some(street => comp.address.toLowerCase().includes(street))
          );

          console.log(`      ✅ Found ${result.comparables.length} total, ${targets.length} target streets`);

          targets.forEach((comp: any) => {
            const key = comp.address;
            allTargets.set(key, comp);
            voteCounts.set(key, (voteCounts.get(key) || 0) + 1);
            console.log(`         🎯 ${comp.address} - $${comp.price?.toLocaleString()}`);
          });

        } else {
          console.log(`      ❌ Agent ${i+1} failed`);
        }
      } catch (error: any) {
        console.log(`      ❌ Agent ${i+1} error: ${error.message}`);
      }

      // Brief delay for API rate limiting
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    return {
      targets: allTargets,
      votes: voteCounts,
      successfulRuns,
      totalRuns: paramSets.length
    };
  }

  // STRATEGY 2: Rapid Burst Consensus (based on finding Ridgemont Dr on call 2)
  async rapidBurstConsensus(
    compService: any,
    address: string,
    subjectDetails: any,
    targetStreets: string[] = ['murphy', 'ridgemont']
  ) {
    console.log('⚡ RAPID BURST: 7 quick calls for consensus');

    const rapidTargets = new Map();
    const rapidVotes = new Map();
    let rapidSuccess = 0;

    process.env.SUBDIVISION = '';

    // Based on results: use parameters that found Ridgemont Dr
    for (let call = 1; call <= 7; call++) {
      console.log(`   Burst ${call}/7...`);

      try {
        const result = await compService.findComparables(
          address, undefined, 30, 4, 24, subjectDetails
        );

        if (result.success) {
          rapidSuccess++;

          const targets = result.comparables.filter((comp: any) =>
            targetStreets.some(street => comp.address.toLowerCase().includes(street))
          );

          if (targets.length > 0) {
            console.log(`      🎯 Found ${targets.length} target streets`);
            targets.forEach((comp: any) => {
              const key = comp.address;
              rapidTargets.set(key, comp);
              rapidVotes.set(key, (rapidVotes.get(key) || 0) + 1);
            });
          } else {
            console.log(`      ❌ No targets found`);
          }

        } else {
          console.log(`      ❌ Burst ${call} failed`);
        }
      } catch (error: any) {
        console.log(`      ❌ Burst ${call} error: ${error.message}`);
      }

      // Very fast intervals
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    return {
      targets: rapidTargets,
      votes: rapidVotes,
      successfulRuns: rapidSuccess,
      totalRuns: 7
    };
  }

  // STRATEGY 3: ICE (Iterative Consensus Ensemble) with Adaptive Parameters
  async iterativeConsensusEnsemble(
    compService: any,
    address: string,
    subjectDetails: any,
    targetStreets: string[] = ['murphy', 'ridgemont']
  ) {
    console.log('🧠 ICE: Iterative refinement based on previous results');

    const iceTargets = new Map();
    const iceVotes = new Map();
    let iceSuccess = 0;

    process.env.SUBDIVISION = '';

    // Round 1: Standard search (baseline)
    console.log(`   ICE Round 1: Baseline search...`);
    let baselineResult = await compService.findComparables(
      address, undefined, 30, 4, 24, subjectDetails
    );

    if (baselineResult.success) {
      iceSuccess++;
      this.trackTargets(baselineResult.comparables, targetStreets, iceTargets, iceVotes);
    }

    // Round 2: Expand based on round 1 (if needed)
    console.log(`   ICE Round 2: Adaptive expansion...`);
    const expandedRadius = iceTargets.size > 0 ? 4 : 5; // Expand if no targets
    const expandedTime = iceTargets.size > 0 ? 24 : 36;

    await new Promise(resolve => setTimeout(resolve, 1000));

    let adaptiveResult = await compService.findComparables(
      address, undefined, 35, expandedRadius, expandedTime, subjectDetails
    );

    if (adaptiveResult.success) {
      iceSuccess++;
      this.trackTargets(adaptiveResult.comparables, targetStreets, iceTargets, iceVotes);
    }

    // Round 3: Conservative refinement
    console.log(`   ICE Round 3: Conservative refinement...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    let refinedResult = await compService.findComparables(
      address, undefined, 25, 3.5, 18, subjectDetails
    );

    if (refinedResult.success) {
      iceSuccess++;
      this.trackTargets(refinedResult.comparables, targetStreets, iceTargets, iceVotes);
    }

    return {
      targets: iceTargets,
      votes: iceVotes,
      successfulRuns: iceSuccess,
      totalRuns: 3
    };
  }

  private trackTargets(comparables: any[], targetStreets: string[], targetsMap: Map<any, any>, votesMap: Map<any, any>) {
    const targets = comparables.filter((comp: any) =>
      targetStreets.some(street => comp.address.toLowerCase().includes(street))
    );

    console.log(`      🎯 Found ${targets.length} target streets`);
    targets.forEach((comp: any) => {
      const key = comp.address;
      targetsMap.set(key, comp);
      votesMap.set(key, (votesMap.get(key) || 0) + 1);
      console.log(`         ${comp.address}`);
    });
  }

  // MASTER AGGREGATION METHOD
  async comprehensiveTargetSearch(
    address: string,
    subjectDetails: any,
    targetStreets: string[] = ['murphy', 'ridgemont']
  ) {
    console.log('🎯 COMPREHENSIVE TARGET SEARCH: Murphy Ln & Ridgemont Dr');
    console.log('============================================================');
    console.log(`📍 Address: ${address}`);
    console.log(`🎯 Target streets: ${targetStreets.join(', ')}`);
    console.log('');

    const compService = new VertexComparableSearchService();

    // Run all three strategies
    const [moaResults, burstResults, iceResults] = await Promise.allSettled([
      this.selfMoASearch(compService, address, subjectDetails, targetStreets),
      this.rapidBurstConsensus(compService, address, subjectDetails, targetStreets),
      this.iterativeConsensusEnsemble(compService, address, subjectDetails, targetStreets)
    ]);

    // Aggregate all results
    const finalTargets = new Map();
    const finalVotes = new Map();
    const methodResults = [];

    [
      { name: 'Self-MoA', result: moaResults },
      { name: 'Rapid Burst', result: burstResults },
      { name: 'ICE', result: iceResults }
    ].forEach(({ name, result }) => {
      if (result.status === 'fulfilled') {
        const data = result.value;
        methodResults.push({
          method: name,
          targets: data.targets.size,
          success: data.successfulRuns,
          total: data.totalRuns
        });

        // Aggregate targets
        data.targets.forEach((comp: any, address: string) => {
          finalTargets.set(address, comp);
          finalVotes.set(address, (finalVotes.get(address) || 0) + data.votes.get(address));
        });
      } else {
        console.log(`❌ ${name} failed:`, result.reason);
      }
    });

    // Analysis
    console.log('\n📊 COMPREHENSIVE RESULTS');
    console.log('============================================================');

    methodResults.forEach(method => {
      const successRate = (method.success / method.total * 100).toFixed(1);
      console.log(`${method.method}: ${method.targets} targets, ${method.success}/${method.total} success (${successRate}%)`);
    });

    console.log(`\n🎯 FINAL TARGET PROPERTIES: ${finalTargets.size}`);
    if (finalTargets.size > 0) {
      Array.from(finalTargets.values()).forEach((comp: any, i: number) => {
        const votes = finalVotes.get(comp.address);
        const confidence = votes >= 5 ? '🔥' : votes >= 3 ? '✅' : '⚠️';
        console.log(`${i+1}. ${confidence} ${comp.address}`);
        console.log(`   💰 $${comp.price?.toLocaleString()} | 📐 ${comp.sqft}sq | 🗳️ ${votes} votes`);
      });
    }

    return {
      targets: Array.from(finalTargets.values()),
      votes: finalVotes,
      methodResults
    };
  }
}

// DEMONSTRATION
async function demonstrateOptimizedConsistency() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const subjectDetails = { sqft: 2331, beds: 4, baths: 2.5, yearBuilt: 1998 };
  const targetStreets = ['murphy', 'ridgemont'];

  const optimizer = new OptimizedConsistencySearch();

  const results = await optimizer.comprehensiveTargetSearch(
    address, subjectDetails, targetStreets
  );

  console.log('\n💡 OPTIMIZATION INSIGHTS');
  console.log('============================================================');
  console.log('Based on testing and 2025 research:');
  console.log('1. Ridgemont Dr appears reliably with 4mi radius, 24mo time window');
  console.log('2. Multiple rapid calls (2-7) find targets more consistently than single calls');
  console.log('3. Parameter variation (Self-MoA) increases discovery probability');
  console.log('4. ICE adaptive expansion helps when initial searches fail');
  console.log('5. Vote-based consensus identifies most reliable properties');
}

demonstrateOptimizedConsistency().catch(console.error);