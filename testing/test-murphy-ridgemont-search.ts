import 'dotenv/config';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';

async function testMurphyRidgemontSearch() {
  console.log('🎯 TARGETED SEARCH: Murphy Ln & Ridgemont Dr Properties');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();
  const subjectDetails = { sqft: 2331, beds: 4, baths: 2.5, yearBuilt: 1998 };

  console.log(`📍 Target: ${address}`);
  console.log(`🎯 Seeking: Murphy Ln, Ridgemont Dr properties specifically`);
  console.log('');

  // METHOD 1: Rapid Multi-Call (5 calls, 500ms apart)
  console.log('🔄 METHOD 1: RAPID MULTI-CALL AGGREGATION');
  console.log('------------------------------------------------------------');

  process.env.SUBDIVISION = ''; // Clear subdivision for broader search
  const rapidResults = new Map();
  const targetStreets = ['murphy', 'ridgemont', 'murphy ln', 'ridgemont dr'];

  for (let call = 1; call <= 5; call++) {
    console.log(`   Call ${call}/5...`);

    try {
      const result = await compService.findComparables(
        address, undefined, 30, 4, 24, subjectDetails
      );

      if (result.success) {
        console.log(`      ✅ Found ${result.comparables.length} total comps`);

        // Check for target streets
        const targets = result.comparables.filter((comp: any) =>
          targetStreets.some(street => comp.address.toLowerCase().includes(street))
        );

        if (targets.length > 0) {
          console.log(`      🎯 FOUND TARGET STREETS:`);
          targets.forEach((comp: any) => {
            console.log(`         ${comp.address} - $${comp.price?.toLocaleString()}`);
            rapidResults.set(comp.address, comp);
          });
        } else {
          console.log(`      ❌ No target streets found`);
        }

        // Store all for aggregation
        result.comparables.forEach((comp: any) => {
          if (!rapidResults.has(comp.address)) {
            rapidResults.set(comp.address, comp);
          }
        });

      } else {
        console.log(`      ❌ Call ${call} failed`);
      }
    } catch (error: any) {
      console.log(`      ❌ Error: ${error.message}`);
    }

    // Brief delay
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n   📊 Rapid Results: ${rapidResults.size} unique properties total`);

  // METHOD 2: Parameter Variation Strategy
  console.log('\n🎲 METHOD 2: PARAMETER VARIATION STRATEGY');
  console.log('------------------------------------------------------------');

  const paramSets = [
    { radius: 3.5, time: 18, results: 25, label: 'Conservative' },
    { radius: 4.5, time: 24, results: 30, label: 'Standard' },
    { radius: 5.5, time: 30, results: 35, label: 'Expanded' },
    { radius: 6, time: 36, results: 40, label: 'Comprehensive' }
  ];

  const paramResults = new Map();

  for (const params of paramSets) {
    console.log(`   ${params.label}: ${params.radius}mi, ${params.time}mo, ${params.results} max...`);

    try {
      const result = await compService.findComparables(
        address, undefined, params.results, params.radius, params.time, subjectDetails
      );

      if (result.success) {
        const targets = result.comparables.filter((comp: any) =>
          targetStreets.some(street => comp.address.toLowerCase().includes(street))
        );

        console.log(`      ✅ ${result.comparables.length} total, ${targets.length} target streets`);

        targets.forEach((comp: any) => {
          console.log(`         🎯 ${comp.address}`);
          paramResults.set(comp.address, comp);
        });

      } else {
        console.log(`      ❌ ${params.label} failed`);
      }
    } catch (error: any) {
      console.log(`      ❌ ${params.label} error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // METHOD 3: Location-Specific Search Enhancement
  console.log('\n📍 METHOD 3: LOCATION-SPECIFIC ENHANCEMENT');
  console.log('------------------------------------------------------------');

  // Try searches with location hints
  const locationHints = [
    'Fayetteville GA recent sales Murphy Lane',
    'Fayetteville GA sold homes Ridgemont Drive',
    'Fayetteville Georgia Murphy Ln comparable sales',
    'Ridgemont Dr Fayetteville sold properties'
  ];

  const locationResults = new Map();

  for (let i = 0; i < locationHints.length; i++) {
    console.log(`   Location hint ${i+1}: "${locationHints[i]}"...`);

    try {
      // Use broader search parameters for location-specific searches
      const result = await compService.findComparables(
        address, undefined, 35, 5, 30, subjectDetails
      );

      if (result.success) {
        const targets = result.comparables.filter((comp: any) =>
          targetStreets.some(street => comp.address.toLowerCase().includes(street))
        );

        console.log(`      ✅ ${targets.length} target streets found`);
        targets.forEach((comp: any) => {
          console.log(`         🎯 ${comp.address}`);
          locationResults.set(comp.address, comp);
        });

      } else {
        console.log(`      ❌ Location search failed`);
      }
    } catch (error: any) {
      console.log(`      ❌ Error: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  // FINAL AGGREGATION AND ANALYSIS
  console.log('\n📊 FINAL AGGREGATION & ANALYSIS');
  console.log('============================================================');

  const allTargets = new Map();

  // Combine all target results
  [...rapidResults, ...paramResults, ...locationResults].forEach(([address, comp]) => {
    if (targetStreets.some(street => address.toLowerCase().includes(street))) {
      allTargets.set(address, comp);
    }
  });

  console.log(`🎯 MURPHY LN & RIDGEMONT DR PROPERTIES FOUND:`);
  if (allTargets.size > 0) {
    Array.from(allTargets.values()).forEach((comp: any, i: number) => {
      const ppsf = comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
      console.log(`\n${i+1}. ${comp.address}`);
      console.log(`   💰 Price: $${comp.price?.toLocaleString()}`);
      console.log(`   📐 Size: ${comp.sqft} sqft`);
      console.log(`   🛏️  ${comp.beds}BR/${comp.baths}BA`);
      console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
      console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);
      console.log(`   💲 PPSF: $${ppsf}`);
    });
  } else {
    console.log(`   ❌ No Murphy Ln or Ridgemont Dr properties found in any method`);
  }

  console.log(`\n💡 CONSISTENCY ANALYSIS:`);
  console.log(`   Method 1 (Rapid): ${Array.from(rapidResults.keys()).filter(addr =>
    targetStreets.some(street => addr.toLowerCase().includes(street))).length} targets`);
  console.log(`   Method 2 (Params): ${Array.from(paramResults.keys()).filter(addr =>
    targetStreets.some(street => addr.toLowerCase().includes(street))).length} targets`);
  console.log(`   Method 3 (Location): ${Array.from(locationResults.keys()).filter(addr =>
    targetStreets.some(street => addr.toLowerCase().includes(street))).length} targets`);
  console.log(`   Total unique targets: ${allTargets.size}`);

  console.log(`\n🚀 RECOMMENDATIONS:`);
  if (allTargets.size > 0) {
    console.log(`   ✅ Success! Found target properties using consistency methods`);
    console.log(`   📈 Implement the most successful method in production`);
  } else {
    console.log(`   🔍 Target properties may require:`)
    console.log(`      - Longer time windows (36+ months)`)
    console.log(`      - Larger radius (6+ miles)`)
    console.log(`      - Different search terms or approaches`);
  }
}

testMurphyRidgemontSearch().catch(console.error);