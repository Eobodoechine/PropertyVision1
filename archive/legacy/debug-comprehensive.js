#!/usr/bin/env node

// Debug script to run comprehensive analysis with enhanced logging
import { ComprehensiveCompSearch } from './server/comprehensive-comp-search.js';

async function runDebugAnalysis() {
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

    if (result.arv) {
      console.log('');
      console.log('💰 ARV SUMMARY');
      console.log('------------------------------------------------------------');
      console.log(`   Method: ${result.arv.method}`);
      console.log(`   ARV: $${result.arv.estimate.toLocaleString()} (${result.arv.confidence} confidence)`);
      console.log(`   Data points: ${result.arv.dataPoints}`);
    }

  } catch (error) {
    console.log(`❌ Analysis failed: ${error.message}`);
    console.error('Full error:', error);
  }
}

runDebugAnalysis().catch(console.error);