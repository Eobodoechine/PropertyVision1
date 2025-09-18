import 'dotenv/config';
import { ComprehensiveCompSearch } from './server/comprehensive-comp-search.js';

async function debugComprehensiveSearch() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';

  console.log('🐛 DEBUGGING COMPREHENSIVE SEARCH');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`🏘️  Subdivision: ${process.env.SUBDIVISION || 'None'}`);
  console.log('');

  const compSearch = new ComprehensiveCompSearch();

  try {
    const result = await compSearch.performOptimalSearch(address, {
      sqft: 2331,
      beds: 3,
      baths: 2,
      yearBuilt: 1998
    });

    console.log('');
    console.log('🔍 DEBUG RESULTS:');
    console.log('============================================================');
    console.log(`📊 Total unique comps found: ${result.all_comps.length}`);
    console.log(`✅ Qualified comps (2+ searches): ${result.qualified_comps.length}`);
    console.log('');

    console.log('📋 ALL COMPS FOUND:');
    result.all_comps.forEach((comp, i) => {
      const frequency = result.consistency_scores.get(comp.address) || 0;
      const ppsf = comp.price / comp.sqft;
      console.log(`   ${i+1}. ${comp.address}`);
      console.log(`      💰 Price: $${comp.price.toLocaleString()} | PPSF: $${ppsf.toFixed(2)}`);
      console.log(`      📐 Size: ${comp.sqft}sqft | Distance: ${comp.distance?.toFixed(2) || 'N/A'}mi`);
      console.log(`      🔄 Found in: ${frequency} searches | First found: ${comp.first_found_in}`);
      console.log('');
    });

    console.log('✅ QUALIFIED COMPS (2+ searches):');
    result.qualified_comps.forEach((comp, i) => {
      const frequency = result.consistency_scores.get(comp.address) || 0;
      const ppsf = comp.price / comp.sqft;
      console.log(`   ${i+1}. ${comp.address}`);
      console.log(`      💰 Price: $${comp.price.toLocaleString()} | PPSF: $${ppsf.toFixed(2)}`);
      console.log(`      📐 Size: ${comp.sqft}sqft | Distance: ${comp.distance?.toFixed(2) || 'N/A'}mi`);
      console.log(`      🔄 Consistency: ${frequency} searches`);
      console.log('');
    });

    console.log('🏠 RENOVATION ANALYSIS:');
    console.log(`   🔧 Likely Renovated: ${result.renovation_analysis.likely_renovated.length} comps`);
    result.renovation_analysis.likely_renovated.forEach(comp => {
      const ppsf = comp.price / comp.sqft;
      console.log(`      ${comp.address} - $${ppsf.toFixed(2)} PPSF`);
    });

    console.log(`   🔨 Likely Unrenovated: ${result.renovation_analysis.likely_unrenovated.length} comps`);
    result.renovation_analysis.likely_unrenovated.forEach(comp => {
      const ppsf = comp.price / comp.sqft;
      console.log(`      ${comp.address} - $${ppsf.toFixed(2)} PPSF`);
    });

    console.log(`   📊 Market Average: ${result.renovation_analysis.market_average.length} comps`);
    result.renovation_analysis.market_average.forEach(comp => {
      const ppsf = comp.price / comp.sqft;
      console.log(`      ${comp.address} - $${ppsf.toFixed(2)} PPSF`);
    });

  } catch (error: any) {
    console.error('❌ Debug failed:', error.message);
  }
}

debugComprehensiveSearch().catch(console.error);