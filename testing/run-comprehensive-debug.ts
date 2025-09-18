import 'dotenv/config';
import { ComprehensiveCompSearch } from './server/comprehensive-comp-search.js';

async function runFullDebugAnalysis() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';

  // Subject details from our property research
  const subjectDetails = {
    sqft: 2331,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998
  };

  console.log('🎯 FULL COMPREHENSIVE DEBUG ANALYSIS');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`🏠 Details: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, Built: ${subjectDetails.yearBuilt}`);
  console.log('');
  console.log('📋 FILTERING CRITERIA:');
  console.log('   🛏️  Bedrooms: ±1 from subject (3-5 BR allowed)');
  console.log('   🛁 Bathrooms: ±1.5 from subject (1.0-4.0 BA allowed)');
  console.log('   📐 Size: ±20% from subject (1,865-2,797 sqft allowed)');
  console.log('   📍 Distance: ≤2.0 miles from subject');
  console.log('   📅 Time: ≤18 months old sales');
  console.log('   🏠 Age Group: Similar era (1980-1999 for subject built 1998)');
  console.log('');

  const compSearch = new ComprehensiveCompSearch();

  try {
    console.log('⏱️  Note: This analysis may take 3-4 minutes due to multiple API calls...');
    const result = await compSearch.performOptimalSearch(address, subjectDetails);

    console.log('');
    console.log('📋 FINAL COMPREHENSIVE DEBUG RESULTS');
    console.log('============================================================');
    console.log(`🔢 Total unique comps found: ${result.all_comps.length}`);
    console.log(`✅ Qualified comps (1+ appearances): ${result.qualified_comps.length}`);
    console.log('');

    console.log('🗂️  ALL PROPERTIES FOUND (DETAILED BREAKDOWN):');
    console.log('============================================================');

    // Group by search where first found
    const searchGroups = {
      subdivision: result.all_comps.filter((comp: any) => comp.first_found_in === 'subdivision'),
      broader: result.all_comps.filter((comp: any) => comp.first_found_in === 'broader'),
      consistency: result.all_comps.filter((comp: any) => comp.first_found_in === 'consistency'),
      fallback: result.all_comps.filter((comp: any) => comp.first_found_in === 'fallback')
    };

    Object.entries(searchGroups).forEach(([searchType, comps]) => {
      if (comps.length > 0) {
        console.log('');
        console.log(`🔍 ${searchType.toUpperCase()} SEARCH RESULTS (${comps.length} properties):`);
        console.log('------------------------------------------------------------');

        comps.forEach((comp: any, i: number) => {
          const ppsf = comp.price / comp.sqft;
          const frequency = result.consistency_scores.get(comp.address) || 0;
          const isQualified = result.qualified_comps.includes(comp);

          console.log(`${i+1}. ${comp.address}`);
          console.log(`   💰 Price: $${comp.price.toLocaleString()}`);
          console.log(`   📐 Size: ${comp.sqft} sqft`);
          console.log(`   🛏️  Beds/Baths: ${comp.beds}BR/${comp.baths}BA`);
          console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
          if (comp.distance) {
            console.log(`   📍 Distance: ${comp.distance.toFixed(2)}mi`);
          }
          console.log(`   💲 PPSF: $${ppsf.toFixed(2)}`);
          console.log(`   🔄 Frequency: ${frequency} searches`);
          console.log(`   ${isQualified ? '✅ QUALIFIED' : '❌ NOT QUALIFIED'}`);

          // Calculate detailed filtering results
          const bedDiff = Math.abs(comp.beds - subjectDetails.beds);
          const bathDiff = Math.abs(comp.baths - subjectDetails.baths);
          const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft;

          console.log(`   📊 FILTERING DETAILS:`);
          console.log(`      🛏️  Bedroom check: ${comp.beds}BR vs ${subjectDetails.beds}BR (diff: ${bedDiff}) - ${bedDiff <= 1 ? 'PASS' : 'FAIL'}`);
          console.log(`      🛁 Bathroom check: ${comp.baths}BA vs ${subjectDetails.baths}BA (diff: ${bathDiff.toFixed(1)}) - ${bathDiff <= 1.5 ? 'PASS' : 'FAIL'}`);
          console.log(`      📐 Size variance: ${(sizeVariance * 100).toFixed(1)}% - ${sizeVariance <= 0.20 ? 'PASS' : 'FAIL'}`);
          if (comp.distance) {
            console.log(`      📍 Distance: ${comp.distance.toFixed(2)}mi - ${comp.distance <= 2.0 ? 'PASS' : 'FAIL'}`);
          }

          // Time analysis
          const soldDate = new Date(comp.soldDate);
          const ageInMonths = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
          console.log(`      📅 Time: ${ageInMonths} months old - ${ageInMonths <= 18 ? 'PASS' : 'FAIL'}`);

          // Age group analysis
          const ageGroup = comp.yearBuilt >= 2020 ? '2020+' :
                          comp.yearBuilt >= 2016 ? '2016-2019' :
                          comp.yearBuilt >= 2000 ? '2000-2015' :
                          comp.yearBuilt >= 1980 ? '1980-1999' : 'Pre-1980';
          const subjectAgeGroup = '1980-1999';
          console.log(`      🏠 Age group: ${ageGroup} vs ${subjectAgeGroup} - ${ageGroup === subjectAgeGroup ? 'PASS' : 'FAIL'}`);

          console.log('');
        });
      }
    });

    if (result.qualified_comps.length > 0) {
      console.log('');
      console.log('💰 ARV CALCULATION DETAILS:');
      console.log('------------------------------------------------------------');
      console.log(`🔧 Renovated Comps: ${result.renovation_analysis.likely_renovated.length} properties (use for ARV)`);
      console.log(`🔨 Unrenovated Comps: ${result.renovation_analysis.likely_unrenovated.length} properties (exclude from ARV)`);
      console.log(`📊 Market Average: ${result.renovation_analysis.market_average.length} properties (baseline)`);

      if (result.renovation_analysis.likely_renovated.length > 0) {
        const renovatedPpsf = result.renovation_analysis.likely_renovated.map((c: any) => c.price / c.sqft);
        const avgRenovatedPpsf = renovatedPpsf.reduce((a: number, b: number) => a + b, 0) / renovatedPpsf.length;
        const estimatedArv = Math.round(avgRenovatedPpsf * subjectDetails.sqft);

        console.log('');
        console.log(`🎯 ESTIMATED ARV: $${estimatedArv.toLocaleString()}`);
        console.log(`   Based on ${result.renovation_analysis.likely_renovated.length} renovated comps`);
        console.log(`   Average renovated PPSF: $${avgRenovatedPpsf.toFixed(2)}`);

        console.log('');
        console.log('🔧 RENOVATED COMPS USED FOR ARV:');
        result.renovation_analysis.likely_renovated.forEach((comp: any, i: number) => {
          const ppsf = comp.price / comp.sqft;
          console.log(`   ${i+1}. ${comp.address} - $${ppsf.toFixed(2)} PPSF`);
        });

        if (result.renovation_analysis.likely_unrenovated.length > 0) {
          console.log('');
          console.log('🔨 UNRENOVATED COMPS (EXCLUDED FROM ARV):');
          result.renovation_analysis.likely_unrenovated.forEach((comp: any, i: number) => {
            const ppsf = comp.price / comp.sqft;
            console.log(`   ${i+1}. ${comp.address} - $${ppsf.toFixed(2)} PPSF`);
          });
        }
      }
    } else {
      console.log('❌ No qualified comparables found for ARV calculation');
    }

  } catch (error: any) {
    console.log(`❌ Analysis failed: ${error.message}`);
  }
}

runFullDebugAnalysis().catch(console.error);