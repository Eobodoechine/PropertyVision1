import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

async function testCoordinateSearches() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const compService = new VertexComparableSearchService();

  // Subject coordinates (from previous geocoding)
  const subjectLat = 33.4098685;
  const subjectLon = -84.40087670000001;

  console.log('🎯 COORDINATE-BASED SEARCH TESTING');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`📐 Coordinates: ${subjectLat}, ${subjectLon}`);
  console.log(`📏 Radius: 3 miles`);
  console.log('');

  // Test 1: Circle coordinates search
  console.log('🔵 TEST 1: CIRCLE COORDINATE SEARCH');
  console.log('------------------------------------------------------------');

  try {
    // Override the findComparables method to use circle coordinates
    const circleResult = await testCircleSearch(subjectLat, subjectLon, 3);
    console.log(`   ✅ Circle search: ${circleResult.found} found, ${circleResult.qualified} qualified`);
  } catch (error: any) {
    console.log(`   ❌ Circle search failed: ${error.message}`);
  }

  console.log('');

  // Test 2: Square box coordinates search
  console.log('⬜ TEST 2: SQUARE BOX COORDINATE SEARCH');
  console.log('------------------------------------------------------------');

  try {
    const boxResult = await testBoxSearch(subjectLat, subjectLon, 3);
    console.log(`   ✅ Box search: ${boxResult.found} found, ${boxResult.qualified} qualified`);
  } catch (error: any) {
    console.log(`   ❌ Box search failed: ${error.message}`);
  }

  console.log('');

  // Test 3: Original address-based search for comparison
  console.log('📮 TEST 3: ORIGINAL ADDRESS SEARCH (3mi radius)');
  console.log('------------------------------------------------------------');

  try {
    const addressResult = await compService.findComparables(
      address,
      undefined, // property type
      20,       // max results
      3,        // radius miles (reduced from 5 to 3)
      18        // time window months
    );

    if (addressResult.success) {
      console.log(`   ✅ Address search: ${addressResult.comparables.length} qualified comps`);

      addressResult.comparables.forEach((comp: any, i: number) => {
        const ppsf = comp.price / comp.sqft;
        console.log(`      ${i+1}. ${comp.address}`);
        console.log(`         💰 $${comp.price.toLocaleString()} | 📐 ${comp.sqft}sqft | 💲 $${ppsf.toFixed(2)} PPSF`);
        console.log(`         📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate} | 📍 ${comp.distance?.toFixed(2)}mi`);
      });
    } else {
      console.log(`   ❌ Address search: No qualified comps`);
      if (addressResult.error) {
        console.log(`      Error: ${addressResult.error}`);
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Address search failed: ${error.message}`);
  }
}

async function testCircleSearch(lat: number, lon: number, radiusMiles: number) {
  // Create a circle-based search using center point + radius
  // This simulates searching within a perfect circle

  console.log(`   🎯 Searching within ${radiusMiles}-mile circle from ${lat}, ${lon}`);

  // For now, return mock data to test the concept
  // In real implementation, this would use coordinate-based Vertex AI search
  return {
    found: 15,
    qualified: 4,
    method: 'circle'
  };
}

async function testBoxSearch(lat: number, lon: number, radiusMiles: number) {
  // Create a square bounding box search
  // Convert miles to approximate lat/lon degrees (rough approximation)
  const milesToDegrees = radiusMiles / 69; // Very rough approximation

  const northLat = lat + milesToDegrees;
  const southLat = lat - milesToDegrees;
  const eastLon = lon + milesToDegrees;
  const westLon = lon - milesToDegrees;

  console.log(`   📦 Searching within box:`);
  console.log(`      North: ${northLat.toFixed(6)}`);
  console.log(`      South: ${southLat.toFixed(6)}`);
  console.log(`      East: ${eastLon.toFixed(6)}`);
  console.log(`      West: ${westLon.toFixed(6)}`);

  // For now, return mock data to test the concept
  // In real implementation, this would use bounding box Vertex AI search
  return {
    found: 12,
    qualified: 3,
    method: 'box'
  };
}

testCoordinateSearches().catch(console.error);