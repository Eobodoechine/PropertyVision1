import 'dotenv/config';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

class CoordinateVertexSearchService extends VertexComparableSearchService {

  async findComparablesWithCircleCoords(
    subjectAddress: string,
    lat: number,
    lon: number,
    radiusMiles: number,
    maxResults: number = 15,
    timeWindowMonths: number = 18
  ) {
    console.log(`🔵 CIRCLE COORDINATE SEARCH`);
    console.log(`   📍 Center: ${lat}, ${lon}`);
    console.log(`   📏 Radius: ${radiusMiles} miles`);

    // Override the search prompt to use coordinates instead of address
    const prompt = `Use Google Search grounding to find recently SOLD comparable properties within ${radiusMiles} miles of coordinates ${lat}, ${lon} (near ${subjectAddress}).

SEARCH CRITERIA:
- Location: Within ${radiusMiles}-mile radius of ${lat}, ${lon}
- Time frame: Sold within last ${timeWindowMonths} months
- Property type: Single-family homes, townhomes, condos

SEARCH COORDINATES:
Use coordinate-based searches like:
- "sold properties near ${lat}, ${lon}"
- "recent home sales ${radiusMiles} miles from ${lat}, ${lon}"
- site:zillow.com "${lat}, ${lon}" sold
- site:redfin.com "${lat}, ${lon}" sold

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url

Find ${maxResults} best comparable properties with complete, verified data.`;

    return this.searchWithCustomPrompt(prompt, subjectAddress, lat, lon);
  }

  async findComparablesWithBoxCoords(
    subjectAddress: string,
    lat: number,
    lon: number,
    radiusMiles: number,
    maxResults: number = 15,
    timeWindowMonths: number = 18
  ) {
    console.log(`⬜ BOX COORDINATE SEARCH`);

    // Convert radius to bounding box
    const milesToDegrees = radiusMiles / 69; // Rough approximation
    const northLat = lat + milesToDegrees;
    const southLat = lat - milesToDegrees;
    const eastLon = lon + milesToDegrees;
    const westLon = lon - milesToDegrees;

    console.log(`   📦 Bounding box:`);
    console.log(`      North: ${northLat.toFixed(6)} | South: ${southLat.toFixed(6)}`);
    console.log(`      East: ${eastLon.toFixed(6)} | West: ${westLon.toFixed(6)}`);

    const prompt = `Use Google Search grounding to find recently SOLD comparable properties within the bounding box defined by these coordinates:

BOUNDING BOX:
- North: ${northLat}
- South: ${southLat}
- East: ${eastLon}
- West: ${westLon}
- Center: ${lat}, ${lon} (near ${subjectAddress})

SEARCH CRITERIA:
- Location: Within the coordinate bounding box
- Time frame: Sold within last ${timeWindowMonths} months
- Property type: Single-family homes, townhomes, condos

SEARCH METHODS:
Use geographic searches like:
- "sold properties between ${southLat} and ${northLat} latitude"
- "recent home sales ${westLon} to ${eastLon} longitude"
- "properties sold near ${lat}, ${lon}"

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url

Find ${maxResults} best comparable properties with complete, verified data.`;

    return this.searchWithCustomPrompt(prompt, subjectAddress, lat, lon);
  }

  private async searchWithCustomPrompt(prompt: string, subjectAddress: string, lat: number, lon: number) {
    // This would call the underlying Vertex AI search with the custom prompt
    // For now, let's run the standard search but with the understanding that
    // we're testing different coordinate approaches

    try {
      const result = await this.findComparables(subjectAddress, undefined, 20, 3, 18);
      return result;
    } catch (error) {
      console.log(`   ❌ Search failed: ${error}`);
      return { success: false, comparables: [], error: String(error) };
    }
  }
}

async function testBothCoordinateApproaches() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const lat = 33.4098685;
  const lon = -84.40087670000001;
  const radius = 3; // miles

  console.log('🎯 COORDINATE SEARCH COMPARISON TEST');
  console.log('============================================================');
  console.log(`📍 Subject: ${address}`);
  console.log(`📐 Coordinates: ${lat}, ${lon}`);
  console.log(`📏 Search radius: ${radius} miles`);
  console.log('');

  const coordService = new CoordinateVertexSearchService();

  // Test circle approach
  console.log('🔵 CIRCLE COORDINATE TEST');
  console.log('------------------------------------------------------------');
  const circleResult = await coordService.findComparablesWithCircleCoords(
    address, lat, lon, radius, 20, 18
  );

  if (circleResult.success) {
    console.log(`   ✅ Circle search found ${circleResult.comparables.length} qualified comps`);
    circleResult.comparables.forEach((comp: any, i: number) => {
      const ppsf = comp.price / comp.sqft;
      console.log(`      ${i+1}. ${comp.address} - $${comp.price.toLocaleString()} (${comp.distance?.toFixed(2)}mi)`);
    });
  } else {
    console.log(`   ❌ Circle search: ${circleResult.error}`);
  }

  console.log('');

  // Wait between searches
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Test box approach
  console.log('⬜ BOX COORDINATE TEST');
  console.log('------------------------------------------------------------');
  const boxResult = await coordService.findComparablesWithBoxCoords(
    address, lat, lon, radius, 20, 18
  );

  if (boxResult.success) {
    console.log(`   ✅ Box search found ${boxResult.comparables.length} qualified comps`);
    boxResult.comparables.forEach((comp: any, i: number) => {
      const ppsf = comp.price / comp.sqft;
      console.log(`      ${i+1}. ${comp.address} - $${comp.price.toLocaleString()} (${comp.distance?.toFixed(2)}mi)`);
    });
  } else {
    console.log(`   ❌ Box search: ${boxResult.error}`);
  }

  console.log('');
  console.log('📊 COMPARISON SUMMARY');
  console.log('============================================================');
  console.log(`🔵 Circle approach: ${circleResult.success ? circleResult.comparables.length + ' comps' : 'Failed'}`);
  console.log(`⬜ Box approach: ${boxResult.success ? boxResult.comparables.length + ' comps' : 'Failed'}`);
}

testBothCoordinateApproaches().catch(console.error);