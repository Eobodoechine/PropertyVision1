// Extract detailed comparables from Montgomery analysis
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY COMPARABLES EXTRACTION');
console.log('===================================');
console.log(`📍 Subject: ${TEST_ADDRESS}`);
console.log('');

async function extractComparableDetails() {
  try {
    const searchService = new ComprehensiveCompSearchV2();
    searchService.clearAllCaches();

    console.log('🔍 Running search to extract comparable details...');
    const results = await searchService.performOptimalSearchV2(TEST_ADDRESS);

    if (!results || !results.qualified_comps) {
      console.log('❌ No results or qualified comps found');
      return;
    }

    console.log('');
    console.log('📊 QUALIFIED COMPARABLES DETAILS');
    console.log('================================');
    console.log(`Found ${results.qualified_comps.length} qualified comparables:`);
    console.log('');

    results.qualified_comps.forEach((comp, index) => {
      const ppsf = comp.price && comp.sqft ? (comp.price / comp.sqft).toFixed(2) : 'N/A';
      const soldAge = comp.soldDate ? Math.round((Date.now() - new Date(comp.soldDate).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 'Unknown';

      console.log(`${index + 1}. ${comp.address}`);
      console.log(`   💰 Price: $${comp.price?.toLocaleString() || 'N/A'}`);
      console.log(`   📐 Size: ${comp.sqft?.toLocaleString() || 'N/A'} sqft`);
      console.log(`   🏠 Layout: ${comp.beds || 'N/A'}BR/${comp.baths || 'N/A'}BA`);
      console.log(`   📅 Built: ${comp.yearBuilt || 'N/A'}`);
      console.log(`   📍 Distance: ${comp.distance?.toFixed(2) || 'N/A'} miles`);
      console.log(`   💲 PPSF: $${ppsf}`);
      console.log(`   🗓️  Sold: ${soldAge} months ago`);
      if (comp.source) {
        console.log(`   🔗 Source: ${comp.source}`);
      }
      if (comp.foundAtLevel) {
        console.log(`   🎯 Found at: Search Level ${comp.foundAtLevel}`);
      }
      console.log('');
    });

    // Show renovation analysis breakdown
    if (results.renovation_analysis) {
      console.log('🔧 RENOVATION ANALYSIS BREAKDOWN');
      console.log('===============================');
      console.log(`Likely Renovated (${results.renovation_analysis.likely_renovated.length}):`);
      results.renovation_analysis.likely_renovated.forEach(comp => {
        const ppsf = (comp.price / comp.sqft).toFixed(2);
        console.log(`  • ${comp.address} - $${comp.price.toLocaleString()} ($${ppsf}/sqft)`);
      });

      console.log(`\nMarket Average (${results.renovation_analysis.market_average.length}):`);
      results.renovation_analysis.market_average.forEach(comp => {
        const ppsf = (comp.price / comp.sqft).toFixed(2);
        console.log(`  • ${comp.address} - $${comp.price.toLocaleString()} ($${ppsf}/sqft)`);
      });

      console.log(`\nLikely Unrenovated (${results.renovation_analysis.likely_unrenovated.length}):`);
      results.renovation_analysis.likely_unrenovated.forEach(comp => {
        const ppsf = (comp.price / comp.sqft).toFixed(2);
        console.log(`  • ${comp.address} - $${comp.price.toLocaleString()} ($${ppsf}/sqft)`);
      });
      console.log('');
    }

    // Show ARV details
    if (results.arv) {
      console.log('💰 ARV CALCULATION DETAILS');
      console.log('=========================');
      console.log(`Method: ${results.arv.method || 'N/A'}`);
      console.log(`Estimate: $${results.arv.estimate?.toLocaleString() || 'Not calculated'}`);
      console.log(`Confidence: ${results.arv.confidence || 'N/A'}`);
      console.log(`Data Points: ${results.arv.dataPoints || 'N/A'}`);
      if (results.arv.priceRange) {
        console.log(`Range: $${results.arv.priceRange.min?.toLocaleString()} - $${results.arv.priceRange.max?.toLocaleString()}`);
      }
      if (results.arv.medianPpsf) {
        console.log(`Median PPSF: $${results.arv.medianPpsf.toFixed(2)}`);
      }
    }

    console.log('');
    console.log('📈 MARKET SUMMARY');
    console.log('================');
    const prices = results.qualified_comps.map(c => c.price).filter(p => p > 0);
    const sizes = results.qualified_comps.map(c => c.sqft).filter(s => s > 0);
    const distances = results.qualified_comps.map(c => c.distance).filter(d => d !== undefined);

    if (prices.length > 0) {
      const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
      const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;

      console.log(`Average Price: $${Math.round(avgPrice).toLocaleString()}`);
      console.log(`Average Size: ${Math.round(avgSize).toLocaleString()} sqft`);
      console.log(`Average PPSF: $${(avgPrice / avgSize).toFixed(2)}`);
      console.log(`Average Distance: ${avgDistance.toFixed(2)} miles`);
      console.log(`Price Range: $${Math.min(...prices).toLocaleString()} - $${Math.max(...prices).toLocaleString()}`);
      console.log(`Size Range: ${Math.min(...sizes).toLocaleString()} - ${Math.max(...sizes).toLocaleString()} sqft`);
    }

    return results;

  } catch (error) {
    console.error('❌ Extraction failed:', error.message);
    return null;
  }
}

extractComparableDetails()
  .then((results) => {
    console.log('');
    console.log('✅ Comparable details extraction completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Extraction failed:', error);
    process.exit(1);
  });