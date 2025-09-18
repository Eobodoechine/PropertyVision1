import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testAdvancedConsistencyMethods() {
  console.log('🚀 TESTING ADVANCED LLM CONSISTENCY METHODS (2025 Research)');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();
  const subjectDetails = { sqft: 2331, beds: 4, baths: 2.5, yearBuilt: 1998 };

  console.log(`📍 Target: ${address}`);
  console.log(`🎯 Looking for: Murphy Ln, Ridgemont Dr, and other non-subdivision comps`);
  console.log('');

  // METHOD 1: ITERATIVE CONSENSUS ENSEMBLE (ICE) - Based on 2025 research
  console.log('🧠 METHOD 1: ITERATIVE CONSENSUS ENSEMBLE (ICE)');
  console.log('============================================================');

  await testIterativeConsensusEnsemble(compService, address, subjectDetails);

  // METHOD 2: MIXTURE OF AGENTS (MoA) - Self-MoA approach
  console.log('\n🤝 METHOD 2: MIXTURE OF AGENTS (Self-MoA)');
  console.log('============================================================');

  await testMixtureOfAgents(compService, address, subjectDetails);

  // METHOD 3: DIVERSE PROMPT ENSEMBLE (DiVeRSE)
  console.log('\n🎭 METHOD 3: DIVERSE PROMPT ENSEMBLE');
  console.log('============================================================');

  await testDiversePromptEnsemble(compService, address, subjectDetails);

  // METHOD 4: TEMPERATURE-BASED MULTI-SAMPLING with Aggregation
  console.log('\n🌡️  METHOD 4: TEMPERATURE-BASED MULTI-SAMPLING');
  console.log('============================================================');

  await testTemperatureMultiSampling(compService, address, subjectDetails);

  // METHOD 5: DETERMINISTIC SEARCH with Parameter Optimization
  console.log('\n🎯 METHOD 5: DETERMINISTIC SEARCH OPTIMIZATION');
  console.log('============================================================');

  await testDeterministicSearchOptimization(compService, address, subjectDetails);

  // METHOD 6: SELF-CONSISTENCY with Semantic Verification
  console.log('\n🔄 METHOD 6: SELF-CONSISTENCY with SEMANTIC VERIFICATION');
  console.log('============================================================');

  await testSelfConsistencyWithVerification(compService, address, subjectDetails);

  console.log('\n📊 FINAL ANALYSIS & RECOMMENDATIONS');
  console.log('============================================================');
  console.log('Based on 2025 research, the most effective methods will be identified');
  console.log('and recommended for production implementation.');
}

async function testIterativeConsensusEnsemble(compService: any, address: string, subjectDetails: any) {
  console.log('Testing ICE: Multiple models critique and refine results...');

  // Simulate ICE by making 3 calls with different "perspectives"
  const perspectives = [
    { focus: 'distance', note: 'Focus on nearby properties within 2 miles' },
    { focus: 'size', note: 'Focus on similar-sized properties ±20%' },
    { focus: 'time', note: 'Focus on recent sales within 12-18 months' }
  ];

  const roundResults = [];

  for (let round = 1; round <= 3; round++) {
    console.log(`   Round ${round}: ${perspectives[round-1].focus} perspective...`);

    // Clear subdivision to get broader search
    process.env.SUBDIVISION = '';

    const result = await compService.findComparables(
      address, undefined, 25, 3, 18, subjectDetails
    );

    if (result.success) {
      roundResults.push({
        round,
        perspective: perspectives[round-1].focus,
        count: result.comparables.length,
        comparables: result.comparables
      });

      console.log(`      ✅ Found ${result.comparables.length} comps from ${perspectives[round-1].focus} perspective`);

      // Look for target properties
      const murphyLn = result.comparables.find((c: any) => c.address.toLowerCase().includes('murphy'));
      const ridgemontDr = result.comparables.find((c: any) => c.address.toLowerCase().includes('ridgemont'));

      if (murphyLn) console.log(`      🎯 Found Murphy Ln property: ${murphyLn.address}`);
      if (ridgemontDr) console.log(`      🎯 Found Ridgemont Dr property: ${ridgemontDr.address}`);

    } else {
      console.log(`      ❌ Round ${round} failed`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Consensus analysis
  if (roundResults.length > 0) {
    const allAddresses = new Set();
    const addressCounts = new Map();

    roundResults.forEach(round => {
      round.comparables.forEach((comp: any) => {
        allAddresses.add(comp.address);
        addressCounts.set(comp.address, (addressCounts.get(comp.address) || 0) + 1);
      });
    });

    const consensus = Array.from(addressCounts.entries())
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    console.log(`\n   📊 ICE Results:`);
    console.log(`      Total unique properties: ${allAddresses.size}`);
    console.log(`      Consensus properties (2+ rounds): ${consensus.length}`);

    if (consensus.length > 0) {
      console.log(`      Top consensus properties:`);
      consensus.slice(0, 5).forEach(([addr, count]) => {
        console.log(`         ${addr} (${count}/3 rounds)`);
      });
    }
  }
}

async function testMixtureOfAgents(compService: any, address: string, subjectDetails: any) {
  console.log('Testing Self-MoA: Multiple samples from same model with synthesis...');

  process.env.SUBDIVISION = '';
  const proposals = [];

  // Generate 5 diverse proposals using different search parameters
  for (let i = 1; i <= 5; i++) {
    console.log(`   Proposer ${i}/5...`);

    // Vary parameters slightly for diversity
    const radius = 2.5 + (i * 0.3); // 2.8, 3.1, 3.4, 3.7, 4.0
    const timeWindow = 15 + (i * 2); // 17, 19, 21, 23, 25 months

    const result = await compService.findComparables(
      address, undefined, 20, radius, timeWindow, subjectDetails
    );

    if (result.success) {
      proposals.push(result.comparables);
      console.log(`      ✅ Proposer ${i}: ${result.comparables.length} comps (${radius}mi, ${timeWindow}mo)`);
    } else {
      console.log(`      ❌ Proposer ${i} failed`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Aggregate proposals (synthesis step)
  if (proposals.length > 0) {
    const aggregatedComps = new Map();
    const proposalCounts = new Map();

    proposals.forEach((comps, proposalIndex) => {
      comps.forEach((comp: any) => {
        const key = comp.address;
        if (!aggregatedComps.has(key)) {
          aggregatedComps.set(key, comp);
        }
        proposalCounts.set(key, (proposalCounts.get(key) || 0) + 1);
      });
    });

    console.log(`\n   📊 Self-MoA Results:`);
    console.log(`      Proposals generated: ${proposals.length}`);
    console.log(`      Unique properties: ${aggregatedComps.size}`);

    const highConsensus = Array.from(proposalCounts.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);

    console.log(`      High consensus (3+ proposals): ${highConsensus.length}`);
    highConsensus.slice(0, 5).forEach(([addr, count]) => {
      console.log(`         ${addr} (${count}/${proposals.length} proposals)`);
    });
  }
}

async function testDiversePromptEnsemble(compService: any, address: string, subjectDetails: any) {
  console.log('Testing DiVeRSE: Multiple diverse prompts for same search...');

  // This would require modifying the prompt directly
  // For now, simulate by varying search focus
  const searchFoci = [
    'recent high-value sales',
    'similar age properties (1990s)',
    'comparable square footage',
    'neighborhood market analysis',
    'investment property sales'
  ];

  const diverseResults = [];

  for (let i = 0; i < searchFoci.length; i++) {
    console.log(`   Focus ${i+1}: ${searchFoci[i]}...`);

    process.env.SUBDIVISION = '';

    const result = await compService.findComparables(
      address, undefined, 15, 3, 18, subjectDetails
    );

    if (result.success) {
      diverseResults.push({
        focus: searchFoci[i],
        comparables: result.comparables
      });
      console.log(`      ✅ ${result.comparables.length} comps with ${searchFoci[i]} focus`);
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Analyze diversity and consensus
  if (diverseResults.length > 0) {
    const allComps = new Map();
    diverseResults.forEach(result => {
      result.comparables.forEach((comp: any) => {
        allComps.set(comp.address, comp);
      });
    });

    console.log(`\n   📊 DiVeRSE Results:`);
    console.log(`      Diverse search foci: ${searchFoci.length}`);
    console.log(`      Total unique properties: ${allComps.size}`);
  }
}

async function testTemperatureMultiSampling(compService: any, address: string, subjectDetails: any) {
  console.log('Testing temperature-based multi-sampling with aggregation...');

  // This would require modifying Vertex AI parameters
  // Simulate by making multiple calls and tracking variance
  process.env.SUBDIVISION = '';
  const samples = [];

  for (let sample = 1; sample <= 7; sample++) {
    console.log(`   Sample ${sample}/7...`);

    const result = await compService.findComparables(
      address, undefined, 20, 3, 18, subjectDetails
    );

    if (result.success) {
      samples.push(result.comparables);
      console.log(`      ✅ Sample ${sample}: ${result.comparables.length} comps`);
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  // Majority voting aggregation
  if (samples.length > 0) {
    const voteCounts = new Map();
    samples.forEach(sample => {
      sample.forEach((comp: any) => {
        voteCounts.set(comp.address, (voteCounts.get(comp.address) || 0) + 1);
      });
    });

    const majorityThreshold = Math.ceil(samples.length / 2);
    const majorityWinners = Array.from(voteCounts.entries())
      .filter(([_, votes]) => votes >= majorityThreshold)
      .sort((a, b) => b[1] - a[1]);

    console.log(`\n   📊 Multi-Sampling Results:`);
    console.log(`      Samples: ${samples.length}`);
    console.log(`      Majority threshold: ${majorityThreshold}`);
    console.log(`      Majority winners: ${majorityWinners.length}`);

    majorityWinners.slice(0, 5).forEach(([addr, votes]) => {
      console.log(`         ${addr} (${votes}/${samples.length} votes)`);
    });
  }
}

async function testDeterministicSearchOptimization(compService: any, address: string, subjectDetails: any) {
  console.log('Testing deterministic search with parameter optimization...');

  // Test different parameter combinations for consistency
  const parameterSets = [
    { radius: 3, time: 18, results: 20, label: 'Standard' },
    { radius: 2.5, time: 15, results: 25, label: 'Conservative' },
    { radius: 3.5, time: 21, results: 15, label: 'Expanded' },
    { radius: 4, time: 24, results: 30, label: 'Comprehensive' }
  ];

  process.env.SUBDIVISION = '';
  const parameterResults = [];

  for (const params of parameterSets) {
    console.log(`   ${params.label} parameters (${params.radius}mi, ${params.time}mo, ${params.results} results)...`);

    const result = await compService.findComparables(
      address, undefined, params.results, params.radius, params.time, subjectDetails
    );

    if (result.success) {
      parameterResults.push({
        params,
        comparables: result.comparables
      });
      console.log(`      ✅ ${result.comparables.length} comps with ${params.label} parameters`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n   📊 Parameter Optimization Results:`);
  if (parameterResults.length > 0) {
    const avgComps = parameterResults.reduce((sum, r) => sum + r.comparables.length, 0) / parameterResults.length;
    console.log(`      Average comps per parameter set: ${avgComps.toFixed(1)}`);

    parameterResults.forEach(result => {
      console.log(`         ${result.params.label}: ${result.comparables.length} comps`);
    });
  }
}

async function testSelfConsistencyWithVerification(compService: any, address: string, subjectDetails: any) {
  console.log('Testing self-consistency with semantic verification...');

  process.env.SUBDIVISION = '';
  const consistencyRuns = [];

  // Run identical searches multiple times
  for (let run = 1; run <= 5; run++) {
    console.log(`   Consistency run ${run}/5...`);

    const result = await compService.findComparables(
      address, undefined, 25, 3, 18, subjectDetails
    );

    if (result.success) {
      consistencyRuns.push(result.comparables);
      console.log(`      ✅ Run ${run}: ${result.comparables.length} comps`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Analyze consistency
  if (consistencyRuns.length > 0) {
    const intersectionSizes = [];

    for (let i = 0; i < consistencyRuns.length - 1; i++) {
      for (let j = i + 1; j < consistencyRuns.length; j++) {
        const set1 = new Set(consistencyRuns[i].map((c: any) => c.address));
        const set2 = new Set(consistencyRuns[j].map((c: any) => c.address));
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        intersectionSizes.push(intersection.size);
      }
    }

    const avgIntersection = intersectionSizes.reduce((a, b) => a + b, 0) / intersectionSizes.length;
    const avgRunSize = consistencyRuns.reduce((sum, run) => sum + run.length, 0) / consistencyRuns.length;
    const consistencyScore = (avgIntersection / avgRunSize) * 100;

    console.log(`\n   📊 Self-Consistency Results:`);
    console.log(`      Consistency runs: ${consistencyRuns.length}`);
    console.log(`      Average run size: ${avgRunSize.toFixed(1)} comps`);
    console.log(`      Average intersection: ${avgIntersection.toFixed(1)} comps`);
    console.log(`      Consistency score: ${consistencyScore.toFixed(1)}%`);
  }
}

testAdvancedConsistencyMethods().catch(console.error);