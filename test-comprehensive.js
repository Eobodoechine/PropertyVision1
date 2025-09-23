#!/usr/bin/env node

// Simple test to run comprehensive analysis with detailed logging
import { ComprehensiveCompSearch } from './server/comprehensive-comp-search.js';

async function runTest() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';

  console.log('🔍 Starting comprehensive analysis for:', address);
  console.log('🎯 COMPREHENSIVE 4-SEARCH STRATEGY');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log('');

  const compSearch = new ComprehensiveCompSearch();

  try {
    console.log('⏱️  Note: This analysis may take 3-4 minutes due to multiple API calls...');
    const result = await compSearch.performOptimalSearch(address);

    console.log('');
    console.log('📋 FINAL COMPREHENSIVE RESULTS');
    console.log('============================================================');
    console.log(`🔢 Total unique comps found: ${result.all_comps.length}`);
    console.log(`✅ Qualified comps (2+ appearances): ${result.qualified_comps.length}`);
    console.log('');

    // Show detailed results
    if (result.qualified_comps.length > 0) {
      console.log('🏆 QUALIFIED COMPARABLES (DETAILED):');
      console.log('------------------------------------------------------------');

      result.qualified_comps.forEach((comp, i) => {
        const ppsf = comp.price / comp.sqft;
        const frequency = result.consistency_scores?.get(comp.address) || 0;

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
    }

  } catch (error) {
    console.log(`❌ Analysis failed: ${error.message}`);
    console.error('Full error:', error);
  }
}

runTest().catch(console.error);