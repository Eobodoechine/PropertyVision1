// Test direct Google Maps Geocoding API
import 'dotenv/config';
import { GoogleMapsGeocoder } from './src/server/utils/googleMapsGeocoder.js';

async function testGoogleMapsGeocoder() {
  console.log('🗺️  TESTING DIRECT GOOGLE MAPS GEOCODING');
  console.log('========================================');

  try {
    const geocoder = new GoogleMapsGeocoder();

    // Test the problematic address that had 0.83 mile error
    const testAddress = "2221 Plantation Dr, East Point, GA 30344";
    const referenceLat = 33.6946462;
    const referenceLng = -84.4630528;

    console.log(`📍 Testing: ${testAddress}`);
    console.log(`📍 Expected: ${referenceLat}, ${referenceLng}`);
    console.log('');

    // Test accuracy
    await geocoder.testAccuracy(testAddress, referenceLat, referenceLng);

    // Test batch geocoding
    console.log('\n🔄 TESTING BATCH GEOCODING:');
    console.log('===========================');

    const testAddresses = [
      "2221 Plantation Dr, East Point, GA 30344",
      "2649 Headland Dr, East Point, GA 30344",
      "3128 McKenzie Rd, East Point, GA 30344"
    ];

    const results = await geocoder.geocodeAddresses(testAddresses);

    console.log('\n📊 BATCH RESULTS:');
    testAddresses.forEach((address, i) => {
      const result = results.get(address);
      if (result) {
        console.log(`   ${i + 1}. ${address}`);
        console.log(`      📍 ${result.lat}, ${result.lng}`);
        console.log(`      🎯 ${result.locationType}`);
        console.log(`      📮 ${result.formattedAddress}`);
      } else {
        console.log(`   ${i + 1}. ${address} - FAILED`);
      }
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testGoogleMapsGeocoder();