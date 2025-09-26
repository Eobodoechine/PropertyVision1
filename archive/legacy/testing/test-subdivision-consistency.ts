import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testSubdivisionConsistency() {
  console.log('🏘️  TESTING SUBDIVISION SEARCH CONSISTENCY');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const subdivision = 'Bailey Oaks';
  const compService = new VertexComparableSearchService();

  // Subject property details
  const subjectDetails = {
    sqft: 2331,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998
  };

  console.log(`📍 Address: ${address}`);
  console.log(`🏘️  Subdivision: ${subdivision}`);
  console.log(`🏠 Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft`);
  console.log('');

  // EXPERIMENT 1: Baseline Repeatability Test
  console.log('🔬 EXPERIMENT 1: BASELINE REPEATABILITY (10 runs)');
  console.log('============================================================');

  const baselineResults = await runSubdivisionSearches('Baseline', 10, () => {
    // Set subdivision and run standard search
    process.env.SUBDIVISION = subdivision;
    return compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);
  });

  analyzeResults('BASELINE', baselineResults);

  // EXPERIMENT 2: Multiple API Calls with Aggregation
  console.log('\n🔬 EXPERIMENT 2: TRIPLE CALL AGGREGATION (5 sets of 3 calls each)');
  console.log('============================================================');

  const tripleResults = await runSubdivisionSearches('Triple Call', 5, async () => {
    process.env.SUBDIVISION = subdivision;

    // Make 3 calls and aggregate results
    const calls = await Promise.all([
      compService.findComparables(address, undefined, 50, 3, 18, subjectDetails),
      compService.findComparables(address, undefined, 50, 3, 18, subjectDetails),
      compService.findComparables(address, undefined, 50, 3, 18, subjectDetails)
    ]);

    // Aggregate unique comparables from all 3 calls
    const aggregatedComps = new Map();
    let totalSuccess = false;

    calls.forEach(result => {
      if (result.success && result.comparables) {
        totalSuccess = true;
        result.comparables.forEach((comp: any) => {
          aggregatedComps.set(comp.address, comp);
        });
      }
    });

    return {
      success: totalSuccess,
      comparables: Array.from(aggregatedComps.values()),
      error: totalSuccess ? undefined : 'All calls failed'
    };
  }, 6000); // Longer delay for triple calls

  analyzeResults('TRIPLE CALL', tripleResults);

  // EXPERIMENT 3: Different Search Parameters
  console.log('\n🔬 EXPERIMENT 3: PARAMETER VARIATIONS (5 runs each)');
  console.log('============================================================');

  const parameterTests = [
    { name: 'Standard (50 results, 3mi, 18mo)', maxResults: 50, radius: 3, timeWindow: 18 },
    { name: 'More Results (100 results, 3mi, 18mo)', maxResults: 100, radius: 3, timeWindow: 18 },
    { name: 'Wider Radius (50 results, 5mi, 18mo)', maxResults: 50, radius: 5, timeWindow: 18 },
    { name: 'Longer Time (50 results, 3mi, 24mo)', maxResults: 50, radius: 3, timeWindow: 24 }
  ];

  for (const params of parameterTests) {
    console.log(`\n📊 Testing: ${params.name}`);
    const results = await runSubdivisionSearches(params.name, 5, () => {
      process.env.SUBDIVISION = subdivision;
      return compService.findComparables(address, undefined, params.maxResults, params.radius, params.timeWindow, subjectDetails);
    });
    analyzeResults(params.name.toUpperCase(), results);
  }

  // EXPERIMENT 4: Deterministic Approach - Calculate Optimal Run Count
  console.log('\n🔬 EXPERIMENT 4: OPTIMAL RUN COUNT CALCULATION');
  console.log('============================================================');

  await calculateOptimalRunCount(compService, address, subdivision, subjectDetails);

  // EXPERIMENT 5: Consistency Through Majority Voting
  console.log('\n🔬 EXPERIMENT 5: MAJORITY VOTING CONSENSUS (5 rounds of 7 calls each)');
  console.log('============================================================');

  const majorityResults = await runSubdivisionSearches('Majority Vote', 5, async () => {
    process.env.SUBDIVISION = subdivision;

    // Make 7 calls for majority voting
    const calls = [];
    for (let i = 0; i < 7; i++) {
      calls.push(compService.findComparables(address, undefined, 50, 3, 18, subjectDetails));
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 sec between calls
    }

    const results = await Promise.all(calls);

    // Count frequency of each comparable across all calls
    const compFrequency = new Map<string, { count: number, comp: any }>();
    let anySuccess = false;

    results.forEach(result => {
      if (result.success && result.comparables) {
        anySuccess = true;
        result.comparables.forEach((comp: any) => {
          const key = comp.address;
          if (compFrequency.has(key)) {
            compFrequency.get(key)!.count++;
          } else {
            compFrequency.set(key, { count: 1, comp });
          }
        });
      }
    });

    // Use majority threshold (appeared in 4+ out of 7 calls)
    const majorityComps = Array.from(compFrequency.entries())
      .filter(([_, data]) => data.count >= 4)
      .map(([_, data]) => data.comp);

    return {
      success: anySuccess,
      comparables: majorityComps,
      error: anySuccess ? undefined : 'All calls failed'
    };
  }, 10000); // Much longer delay for 7 calls

  analyzeResults('MAJORITY VOTING', majorityResults);

  // Final recommendations
  console.log('\n🎯 FINAL ANALYSIS & RECOMMENDATIONS');
  console.log('============================================================');
  console.log('Based on all experiments, the best approach for consistent subdivision search:');
  // We'll analyze and recommend based on results
}

async function runSubdivisionSearches(experimentName: string, numRuns: number, searchFunction: () => Promise<any>, delayMs: number = 3000) {
  console.log(`Running ${numRuns} searches for ${experimentName}...`);

  const results = [];
  const compFrequency = new Map<string, number>();

  for (let i = 1; i <= numRuns; i++) {
    console.log(`   🔄 Run ${i}/${numRuns}...`);

    try {
      const result = await searchFunction();

      if (result.success && result.comparables) {
        console.log(`      ✅ Found ${result.comparables.length} comparables`);

        // Track frequency
        result.comparables.forEach((comp: any) => {
          compFrequency.set(comp.address, (compFrequency.get(comp.address) || 0) + 1);
        });

        results.push({
          runNumber: i,
          count: result.comparables.length,
          comparables: result.comparables,
          success: true
        });
      } else {
        console.log(`      ❌ No results`);
        results.push({
          runNumber: i,
          count: 0,
          comparables: [],
          success: false,
          error: result.error
        });
      }
    } catch (error: any) {
      console.log(`      ❌ Error: ${error.message}`);
      results.push({
        runNumber: i,
        count: 0,
        comparables: [],
        success: false,
        error: error.message
      });
    }

    if (i < numRuns) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Reset subdivision
  process.env.SUBDIVISION = '';

  return { results, compFrequency };
}

function analyzeResults(experimentName: string, data: { results: any[], compFrequency: Map<string, number> }) {
  const { results, compFrequency } = data;
  const successfulRuns = results.filter(r => r.success);

  console.log(`\n📊 ${experimentName} ANALYSIS:`);
  console.log(`   Success Rate: ${successfulRuns.length}/${results.length} (${(successfulRuns.length/results.length*100).toFixed(1)}%)`);

  if (successfulRuns.length > 0) {
    const counts = successfulRuns.map(r => r.count);
    const avgCount = (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);

    console.log(`   Avg Comparables: ${avgCount} (range: ${minCount}-${maxCount})`);

    const consistentComps = Array.from(compFrequency.entries()).filter(([_, freq]) => freq >= 2).length;
    const totalComps = compFrequency.size;
    const consistency = totalComps > 0 ? (consistentComps / totalComps * 100).toFixed(1) : 0;

    console.log(`   Consistency: ${consistency}% (${consistentComps}/${totalComps} properties appeared 2+ times)`);
  }
}

async function calculateOptimalRunCount(compService: any, address: string, subdivision: string, subjectDetails: any) {
  console.log('Calculating how many runs needed to capture most unique comparables...');

  process.env.SUBDIVISION = subdivision;
  const allComps = new Set<string>();
  const runsData = [];

  // Run up to 15 searches to see saturation point
  for (let run = 1; run <= 15; run++) {
    try {
      const result = await compService.findComparables(address, undefined, 50, 3, 18, subjectDetails);

      if (result.success && result.comparables) {
        const beforeSize = allComps.size;
        result.comparables.forEach((comp: any) => allComps.add(comp.address));
        const newComps = allComps.size - beforeSize;

        runsData.push({
          run,
          found: result.comparables.length,
          totalUnique: allComps.size,
          newComps
        });

        console.log(`   Run ${run}: Found ${result.comparables.length}, Total unique: ${allComps.size}, New: ${newComps}`);

        // Check for saturation (3 runs with no new comparables)
        const recentRuns = runsData.slice(-3);
        if (recentRuns.length === 3 && recentRuns.every(r => r.newComps === 0)) {
          console.log(`   📊 Saturation reached at run ${run-2} - no new properties in last 3 runs`);
          break;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`   ❌ Run ${run} failed`);
    }
  }

  process.env.SUBDIVISION = '';

  // Analyze optimal run count
  console.log(`\n📈 OPTIMAL RUN COUNT ANALYSIS:`);
  console.log(`   Total unique comparables found: ${allComps.size}`);

  // Find point where we capture 80% and 90% of total
  const target80 = Math.ceil(allComps.size * 0.8);
  const target90 = Math.ceil(allComps.size * 0.9);

  const runs80 = runsData.find(r => r.totalUnique >= target80)?.run || 'Not reached';
  const runs90 = runsData.find(r => r.totalUnique >= target90)?.run || 'Not reached';

  console.log(`   Runs needed for 80% coverage (${target80} properties): ${runs80}`);
  console.log(`   Runs needed for 90% coverage (${target90} properties): ${runs90}`);
}

testSubdivisionConsistency().catch(console.error);