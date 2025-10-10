// Direct Google Maps Geocoding API Integration
// Bypasses Vertex AI for 100% accurate coordinates

interface GoogleMapsGeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  locationType: 'ROOFTOP' | 'RANGE_INTERPOLATED' | 'GEOMETRIC_CENTER' | 'APPROXIMATE';
  addressComponents: any[];
}

interface GoogleMapsResponse {
  status: 'OK' | 'ZERO_RESULTS' | 'OVER_QUERY_LIMIT' | 'REQUEST_DENIED' | 'INVALID_REQUEST';
  results: Array<{
    formatted_address: string;
    geometry: {
      location: { lat: number; lng: number };
      location_type: string;
    };
    address_components: any[];
  }>;
  error_message?: string;
}

export class GoogleMapsGeocoder {
  private apiKey: string;
  private baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('Google Maps API key is required');
    }
  }

  /**
   * Geocode a single address using Google Maps API
   */
  async geocodeAddress(address: string): Promise<GoogleMapsGeocodeResult | null> {
    jobLog(`🗺️  Direct Google Maps geocoding: ${address}`);

    try {
      const encodedAddress = encodeURIComponent(address);
      const url = `${this.baseUrl}?address=${encodedAddress}&key=${this.apiKey}`;

      const response = await fetch(url);
      const data: GoogleMapsResponse = await response.json();

      jobLog(`🗺️  Google Maps API status: ${data.status}`);

      if (data.status === 'OK' && data.results.length > 0) {
        const result = data.results[0];
        const location = result.geometry.location;

        jobLog(`🎯 Direct Google Maps result: ${location.lat}, ${location.lng}`);
        jobLog(`📍 Location type: ${result.geometry.location_type}`);
        jobLog(`📮 Formatted address: ${result.formatted_address}`);

        return {
          lat: location.lat,
          lng: location.lng,
          formattedAddress: result.formatted_address,
          locationType: result.geometry.location_type as any,
          addressComponents: result.address_components
        };
      } else {
        jobLog(`❌ Google Maps geocoding failed: ${data.status}`);
        if (data.error_message) {
          jobLog(`❌ Error: ${data.error_message}`);
        }
        return null;
      }
    } catch (error) {
      console.error(`❌ Google Maps API error:`, error);
      return null;
    }
  }

  /**
   * Geocode multiple addresses in parallel
   */
  async geocodeAddresses(addresses: string[]): Promise<Map<string, GoogleMapsGeocodeResult>> {
    jobLog(`🗺️  Geocoding ${addresses.length} addresses with Google Maps API`);

    const results = new Map<string, GoogleMapsGeocodeResult>();

    // Geocode all addresses in parallel
    const promises = addresses.map(async (address) => {
      const result = await this.geocodeAddress(address);
      if (result) {
        results.set(address, result);
      }
      return { address, result };
    });

    await Promise.all(promises);

    jobLog(`🗺️  Successfully geocoded ${results.size}/${addresses.length} addresses`);
    return results;
  }

  /**
   * Test coordinate accuracy against known reference
   */
  async testAccuracy(address: string, referenceLat: number, referenceLng: number): Promise<void> {
    const result = await this.geocodeAddress(address);

    if (result) {
      // Calculate distance error using Haversine formula
      const R = 3959; // Earth's radius in miles
      const dLat = (result.lat - referenceLat) * Math.PI / 180;
      const dLon = (result.lng - referenceLng) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(referenceLat * Math.PI / 180) * Math.cos(result.lat * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const distance = R * c;

      jobLog(`\n🎯 ACCURACY TEST: ${address}`);
      jobLog(`📍 Reference: ${referenceLat}, ${referenceLng}`);
      jobLog(`📍 Google Maps: ${result.lat}, ${result.lng}`);
      jobLog(`📏 Distance error: ${distance.toFixed(6)} miles (${(distance * 5280).toFixed(1)} feet)`);
      jobLog(`✅ Location type: ${result.locationType}`);
    } else {
      jobLog(`❌ Failed to geocode: ${address}`);
    }
  }
}