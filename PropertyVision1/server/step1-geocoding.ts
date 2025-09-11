import { GoogleGenerativeAI } from '@google/generative-ai';

interface GeocodingResult {
  address: string;
  lat: number;
  lon: number;
  success: boolean;
  error?: string;
}

class GeocodingService {
  private googleMapsApiKey: string;

  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.googleMapsApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
  }

  async geocodeAddress(address: string): Promise<GeocodingResult> {
    try {
      console.log(`📍 GEOCODING: ${address}`);
      
      const https = await import('https');
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`;
      
      const data = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      }) as any;
      
      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;
        
        console.log(`   ✅ Coordinates: ${location.lat}, ${location.lng}`);
        
        return {
          address: address,
          lat: location.lat,
          lon: location.lng, // Google Maps uses 'lng' not 'lon'
          success: true
        };
      } else {
        console.log(`   ❌ Geocoding failed: ${data.status}`);
        return {
          address: address,
          lat: 0,
          lon: 0,
          success: false,
          error: data.status
        };
      }
    } catch (error) {
      console.error(`❌ Geocoding error: ${error.message}`);
      return {
        address: address,
        lat: 0,
        lon: 0,
        success: false,
        error: error.message
      };
    }
  }
}

// Test function
async function testGeocoding() {
  const address = process.env.ADDRESS || "243 Kirk Ave, Henderson, NV 89015";
  
  console.log(`\n📍 STEP 1: GEOCODING ADDRESS`);
  console.log(`============================================================`);
  
  const geocodingService = new GeocodingService();
  const result = await geocodingService.geocodeAddress(address);
  
  if (result.success) {
    console.log(`✅ Geocoding successful:`);
    console.log(`   Address: ${result.address}`);
    console.log(`   Coordinates: ${result.lat}, ${result.lon}`);
  } else {
    console.log(`❌ Geocoding failed: ${result.error}`);
  }
  
  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testGeocoding().catch(console.error);
}

export { GeocodingService, testGeocoding };
export type { GeocodingResult };
