// Test the updated coordinate extraction prompt
import 'dotenv/config';
import { readFileSync } from 'fs';
import { vertexGenerate } from './src/server/vertex-freeform.js';

// Load service account credentials
const saPath = process.env.GCP_SA_JSON || '/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json';
console.log('📂 Loading service account from:', saPath);
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const projectId = sa.project_id;

// Test addresses including 2221 Plantation Dr
const testAddresses = [
  "2221 Plantation Dr, East Point, GA 30344",
  "2649 Headland Dr, East Point, GA 30344",
  "3128 McKenzie Rd, East Point, GA 30344"
];

const addressList = testAddresses.map((addr, index) => `${index + 1}. "${addr}"`).join('\n');

// Updated geocoding verifier prompt
const prompt = `You are a geocoding verifier. Your task is to return the most accurate coordinates for a given postal address in EPSG:4326 (WGS84) with rooftop precision when possible.
Never guess. Never fabricate sources. If uncertain, return "status":"UNSURE" with details.

Follow this procedure:

Normalize the address (US/USPS style when applicable).

Find coordinates from at least two independent, reputable sources, prioritizing in this order:

County/City GIS parcel viewer (parcel centroid or rooftop)

Google Maps/Google Places details page (rooftop point)

OpenStreetMap / Nominatim (node/way centroid)

Major listing sites' map metadata (e.g., Redfin, Zillow, Realtor.com)

USPS (for address validity only; USPS does not provide lat/long)

If sources disagree by > 30 meters, resolve with the parcel's rooftop/centroid from the official GIS where available. Note in resolution_notes.

Prefer rooftop point over street interpolation. If only street interpolation is available, mark precision:"street_interp".

Reverse-geocode verification: ensure the coordinates reverse-resolve to the same street number and street name (or same parcel) as the input.

Output strictly in the JSON schema below—no extra text.

Distances: Use the Haversine formula for any distance checks requested.
Precision: return 6–7 decimals (≈ sub-meter to ~10 cm).
If the address is a PO Box or cannot be located precisely, set status:"UNSURE" and explain.

Addresses to geocode:
${addressList}

JSON schema (strict):

{
  "status": "OK | UNSURE | NOT_FOUND",
  "normalized_address": "string",
  "location": {
    "lat": 0.0,
    "lng": 0.0,
    "precision": "rooftop | parcel_centroid | entrance | street_interp | city_centroid"
  },
  "confidence": 0.0,
  "reverse_geocode_check": {
    "matched": true,
    "resolved_address": "string",
    "notes": "string"
  },
  "sources": [
    {"name":"string","url":"string"},
    {"name":"string","url":"string"}
  ],
  "resolution_notes": "string",
  "haversine_checks": [
    {
      "label": "string",
      "target_address": "string",
      "target_coords": {"lat": 0.0, "lng": 0.0},
      "distance_meters": 0.0
    }
  ]
}

Validation rules:

status must be one of: OK, UNSURE, or NOT_FOUND.

If status is OK, you MUST include ≥2 sources.

Coordinates must be in decimal degrees, not DMS.

Do not round to fewer than 6 decimals.

If you cannot verify with ≥2 sources, use UNSURE and explain.

Output format:
ADDRESS 1:
[JSON object]

ADDRESS 2:
[JSON object]

ADDRESS 3:
[JSON object]`;

async function testCoordinateExtraction() {
  console.log('🧪 Testing Updated Coordinate Extraction');
  console.log('======================================');
  console.log('Addresses to test:');
  testAddresses.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
  console.log('');

  try {
    console.log('📤 Sending request to Vertex AI...');

    const response = await vertexGenerate({
      sa: sa,
      projectId: projectId,
      location: 'us-central1',
      model: 'gemini-2.5-pro',
      prompt: prompt,
      grounded: true,
      timeoutMs: 120000
    });

    console.log('📥 Raw Response from Vertex AI:');
    console.log('===============================');
    console.log(response);
    console.log('');

    // Parse the response like V5 does
    console.log('🔍 Parsing Response:');
    console.log('===================');

    const sections = response.split(/ADDRESS \d+:/);

    for (let i = 0; i < testAddresses.length; i++) {
      const section = sections[i + 1]; // Skip first empty element
      console.log(`\n📍 ADDRESS ${i + 1}: ${testAddresses[i]}`);

      if (section) {
        try {
          // Extract JSON from the section
          const jsonMatch = section.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const geocodeResult = JSON.parse(jsonMatch[0]);

            if (geocodeResult.status === 'OK' && geocodeResult.location?.lat && geocodeResult.location?.lng) {
              const lat = parseFloat(geocodeResult.location.lat);
              const lon = parseFloat(geocodeResult.location.lng);

              if (!isNaN(lat) && !isNaN(lon)) {
                console.log(`   ✅ SUCCESS: ${lat}, ${lon}`);
                console.log(`   📍 Precision: ${geocodeResult.location.precision}`);
                console.log(`   📊 Sources: ${geocodeResult.sources?.length || 0}`);
                console.log(`   🔗 Resolution: ${geocodeResult.resolution_notes || 'N/A'}`);

                // Compare with Google Maps for 2221 Plantation Dr
                if (testAddresses[i].includes('2221 Plantation')) {
                  console.log(`   🆚 Google Maps: 33.6946462, -84.4630528`);
                  console.log(`   🆚 Old Vertex: 33.681132, -84.496334`);
                  console.log(`   📏 Lat diff from Google: ${Math.abs(lat - 33.6946462).toFixed(6)}`);
                  console.log(`   📏 Lng diff from Google: ${Math.abs(lon - (-84.4630528)).toFixed(6)}`);
                }
              } else {
                console.log(`   ❌ Invalid coordinates in response`);
              }
            } else {
              console.log(`   ❌ ${geocodeResult.status} - ${geocodeResult.resolution_notes || 'No coordinates found'}`);
            }
          } else {
            console.log(`   ❌ No JSON found in response section`);
          }
        } catch (error) {
          console.log(`   ❌ JSON parse error: ${error.message}`);
        }
      } else {
        console.log(`   ❌ No response section found`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testCoordinateExtraction();