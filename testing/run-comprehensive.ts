import 'dotenv/config';
import { ComprehensiveCompSearch } from '../server/comprehensive-comp-search.js';

async function runFullAnalysis() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';

  // Optional subject details; if absent, service will fetch via Vertex
  const subjectDetails = process.env.SUBJECT_SQFT ? {
    sqft: Number(process.env.SUBJECT_SQFT),
    beds: process.env.SUBJECT_BEDS ? Number(process.env.SUBJECT_BEDS) : undefined as any,
    baths: process.env.SUBJECT_BATHS ? Number(process.env.SUBJECT_BATHS) : undefined as any,
    yearBuilt: process.env.SUBJECT_YEAR ? Number(process.env.SUBJECT_YEAR) : undefined as any,
  } : undefined as any;

  console.log('🎯 FULL COMPREHENSIVE ANALYSIS');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  if (subjectDetails && subjectDetails.sqft) {
    console.log(`🏠 Details: ${subjectDetails.beds ?? '?'}BR/${subjectDetails.baths ?? '?'}BA, ${subjectDetails.sqft}sqft, Built: ${subjectDetails.yearBuilt ?? '?'}`);
  }
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

    // Prefer ARV computed by the service (renovated-only when available)
    if ((result as any).arv) {
      console.log('💰 ARV SUMMARY (service result)');
      console.log('------------------------------------------------------------');
      console.log(`   Method: ${result.arv.method}`);
      console.log(`   ARV: $${result.arv.estimate.toLocaleString()} (${result.arv.confidence} confidence)`);
      console.log(`   Data points: ${result.arv.dataPoints}`);
      console.log('');
    }

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
        const renovatedValid = result.renovation_analysis.likely_renovated
          .filter((c: any) => c && Number.isFinite(Number(c.price)) && Number.isFinite(Number(c.sqft)) && Number(c.sqft) > 0);
        const renovatedPpsf = renovatedValid.map((c: any) => Number(c.price) / Number(c.sqft));
        const avgRenovatedPpsf = renovatedPpsf.length ? (renovatedPpsf.reduce((a: number, b: number) => a + b, 0) / renovatedPpsf.length) : NaN;

        // Only show fallback estimate if we have subject sqft and no service ARV
        const canShowFallback = !((result as any).arv) && Number.isFinite(avgRenovatedPpsf) && Number.isFinite(Number(subjectDetails?.sqft));
        if (canShowFallback) {
          const estimatedArv = Math.round(avgRenovatedPpsf * Number(subjectDetails!.sqft));
          console.log('');
          console.log(`🎯 ESTIMATED ARV (fallback): $${estimatedArv.toLocaleString()}`);
          console.log(`   Based on ${renovatedValid.length} renovated comps (valid PPSF)`);
          console.log(`   Average renovated PPSF: $${avgRenovatedPpsf.toFixed(2)}`);
        }
      }
    } else {
      console.log('❌ No qualified comparables found');
    }

  } catch (error: any) {
    console.log(`❌ Analysis failed: ${error.message}`);
  }
}

runFullAnalysis().catch(console.error);
