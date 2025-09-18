import 'dotenv/config';
import { ComprehensiveCompSearch } from '../server/comprehensive-comp-search.js';

async function runFullAnalysis() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';

  // Subject details from our property research
  const subjectDetails = {
    sqft: 2331,
    beds: 4,
    baths: 2.5,
    yearBuilt: 1998
  };

  console.log('🎯 FULL COMPREHENSIVE ANALYSIS');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`🏠 Details: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, Built: ${subjectDetails.yearBuilt}`);
  console.log('');

  const compSearch = new ComprehensiveCompSearch();

  try {
    console.log('⏱️  Note: This analysis may take 3-4 minutes due to multiple API calls...');
    const result = await compSearch.performOptimalSearch(address, subjectDetails);

    console.log('');
    console.log('📋 FINAL COMPREHENSIVE RESULTS');
    console.log('============================================================');
    console.log(`🔢 Total unique comps found: ${result.all_comps.length}`);
    console.log(`✅ Qualified comps (2+ appearances): ${result.qualified_comps.length}`);
    console.log('');

    if (result.qualified_comps.length > 0) {
      console.log('🏆 QUALIFIED COMPARABLES (DETAILED):');
      console.log('------------------------------------------------------------');

      result.qualified_comps.forEach((comp: any, i: number) => {
        const ppsf = comp.price / comp.sqft;
        const frequency = result.consistency_scores.get(comp.address) || 0;

        console.log(`${i+1}. ${comp.address}`);
        console.log(`   💰 Price: $${comp.price.toLocaleString()}`);
        console.log(`   📐 Size: ${comp.sqft} sqft`);
        console.log(`   🛏️  Beds/Baths: ${comp.beds}BR/${comp.baths}BA`);
        console.log(`   📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
        console.log(`   📍 Distance: ${comp.distance?.toFixed(2)}mi`);
        console.log(`   💲 PPSF: $${ppsf.toFixed(2)}`);
        console.log(`   🔄 Frequency: ${frequency} searches`);
        console.log(`   🎯 First found in: ${comp.first_found_in} search`);
        console.log('');
      });

      console.log('💰 ARV CALCULATION RECOMMENDATIONS:');
      console.log('------------------------------------------------------------');
      console.log(`🔧 Renovated Comps: ${result.renovation_analysis.likely_renovated.length} properties (use for ARV)`);
      console.log(`🔨 Unrenovated Comps: ${result.renovation_analysis.likely_unrenovated.length} properties (exclude from ARV)`);
      console.log(`📊 Market Average: ${result.renovation_analysis.market_average.length} properties (baseline)`);

      if (result.renovation_analysis.likely_renovated.length > 0) {
        const renovatedPpsf = result.renovation_analysis.likely_renovated.map(c => c.price / c.sqft);
        const avgRenovatedPpsf = renovatedPpsf.reduce((a, b) => a + b, 0) / renovatedPpsf.length;
        const estimatedArv = Math.round(avgRenovatedPpsf * subjectDetails.sqft);

        console.log('');
        console.log(`🎯 ESTIMATED ARV: $${estimatedArv.toLocaleString()}`);
        console.log(`   Based on ${result.renovation_analysis.likely_renovated.length} renovated comps`);
        console.log(`   Average renovated PPSF: $${avgRenovatedPpsf.toFixed(2)}`);
      }
    } else {
      console.log('❌ No qualified comparables found');
    }

  } catch (error: any) {
    console.log(`❌ Analysis failed: ${error.message}`);
  }
}

runFullAnalysis().catch(console.error);
