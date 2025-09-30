// Quick test for ARV fallback fix
import { ComprehensiveComparableSearchV3 } from './src/server/comprehensive-comp-search-v3.js';

async function testFallback() {
  console.log('🧪 Testing ARV fallback fix...');

  const searcher = new ComprehensiveComparableSearchV3();

  // Create mock properties with one high-tier candidate but no cluster support
  const mockProperties = [
    { address: '1 High St', price: 250000, sqft: 1200, ppsf: 208.33 }, // High-tier candidate
    { address: '2 Mid St', price: 180000, sqft: 1100, ppsf: 163.64 },  // Mid-tier
    { address: '3 Mid St', price: 175000, sqft: 1150, ppsf: 152.17 },  // Mid-tier
    { address: '4 Mid St', price: 170000, sqft: 1080, ppsf: 157.41 },  // Mid-tier
    { address: '5 Low St', price: 160000, sqft: 1050, ppsf: 152.38 },  // Low-tier
    { address: '6 Low St', price: 155000, sqft: 1000, ppsf: 155.00 }   // Low-tier
  ];

  try {
    // Call the selectHighTierProperties method directly
    const result = (searcher as any).selectHighTierProperties(mockProperties);

    console.log('✅ Test Results:');
    console.log(`   Selected comps: ${result.selectedComps.length}`);
    console.log(`   Dropped high (no support): ${result.droppedHighNoSupport.length}`);
    console.log('   Analysis log:');
    result.analysisLog.forEach(line => console.log(`   ${line}`));

    // Check if fallback was triggered
    const fallbackTriggered = result.analysisLog.some(line => line.includes('TRIGGERING FALLBACK'));
    console.log(`\n🎯 Fallback triggered: ${fallbackTriggered ? '✅ YES' : '❌ NO'}`);

    if (result.selectedComps.length > 0) {
      console.log('✅ SUCCESS: Fallback returned properties for ARV calculation');
    } else {
      console.log('❌ FAILED: No properties returned for ARV calculation');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testFallback();