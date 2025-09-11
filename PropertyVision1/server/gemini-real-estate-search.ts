import { GoogleGenAI } from "@google/genai";

export interface GeminiComparable {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  soldDate: string;
  distance: number;
  source: string;
  confidence: string;
}

export class GeminiRealEstateSearch {
  private client: GoogleGenAI;
  private googleMapsApiKey: string;

  constructor(apiKey: string, googleMapsApiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.googleMapsApiKey = googleMapsApiKey;
  }

  /**
   * Search for comparables using Gemini API with Google Search
   */
  async searchComparables(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number = 1.0,
    maxResults: number = 5
  ): Promise<GeminiComparable[]> {
    console.log(`🔍 GEMINI SEARCH: Looking for comparables near ${subjectAddress}`);
    console.log(`   • Radius: ${searchRadius} miles`);
    console.log(`   • Max results: ${maxResults}`);

    try {
      // Create targeted search prompt
      const searchPrompt = this.createSearchPrompt(
        subjectAddress,
        subjectLat,
        subjectLon,
        searchRadius,
        maxResults
      );

      // Configure Gemini with Google Search
      const groundingTool = {
        googleSearch: {},
      };

      const config = {
        tools: [groundingTool],
      };

      // Make the request
      const response = await this.client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: searchPrompt,
        config,
      });

      console.log(`   📊 Gemini response received`);
      
      // Extract comparables from response
      const comparables = await this.extractComparablesFromResponse(
        response,
        subjectLat,
        subjectLon,
        searchRadius
      );

      console.log(`   ✅ Found ${comparables.length} comparables`);
      return comparables;

    } catch (error) {
      console.error(`❌ Gemini search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Create a targeted search prompt for real estate data
   */
  private createSearchPrompt(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number,
    maxResults: number
  ): string {
    return `Find ${maxResults} recently sold homes within ${searchRadius} miles of ${subjectAddress} (coordinates: ${subjectLat}, ${subjectLon}).

Please search for properties that:
- Sold within the last 12 months
- Are single-family homes
- Are within ${searchRadius} miles of the subject property
- Have similar square footage (750-1500 sqft)

For each property found, extract:
- Full address
- Sale price
- Square footage
- Number of bedrooms
- Number of bathrooms
- Year built
- Sale date
- Distance from subject property

Format the response as a JSON array with this structure:
[
  {
    "address": "123 Main St, City, State ZIP",
    "price": 350000,
    "sqft": 1200,
    "beds": 3,
    "baths": 2,
    "yearBuilt": 2010,
    "soldDate": "2024-10-15",
    "distance": 0.5,
    "source": "Zillow",
    "confidence": "high"
  }
]

Focus on finding properties that are truly comparable to the subject property.`;
  }

  /**
   * Extract comparables from Gemini response
   */
  private async extractComparablesFromResponse(
    response: any,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number
  ): Promise<GeminiComparable[]> {
    try {
      // Parse the JSON response
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.log(`   ⚠️ No JSON array found in response`);
        return [];
      }

      const rawComparables = JSON.parse(jsonMatch[0]);
      const comparables: GeminiComparable[] = [];

      for (const raw of rawComparables) {
        try {
          // Validate required fields
          if (!raw.address || !raw.price || !raw.sqft) {
            console.log(`   ⚠️ Skipping invalid property: missing required fields`);
            continue;
          }

          // Calculate distance if not provided
          let distance = raw.distance;
          if (!distance && raw.address) {
            distance = await this.calculateDistance(raw.address, subjectLat, subjectLon);
          }

          // Filter by distance
          if (distance > searchRadius) {
            console.log(`   ❌ Filtering out ${raw.address} (distance: ${distance} > ${searchRadius})`);
            continue;
          }

          const comparable: GeminiComparable = {
            address: raw.address,
            price: parseInt(raw.price),
            sqft: parseInt(raw.sqft),
            beds: parseInt(raw.beds) || 0,
            baths: parseInt(raw.baths) || 0,
            yearBuilt: parseInt(raw.yearBuilt) || 0,
            soldDate: raw.soldDate || '',
            distance: distance,
            source: raw.source || 'Gemini Search',
            confidence: raw.confidence || 'medium'
          };

          comparables.push(comparable);
          console.log(`   ✅ Added: ${comparable.address} - $${comparable.price.toLocaleString()} - ${comparable.sqft}sqft`);

        } catch (error) {
          console.log(`   ⚠️ Error processing property: ${error.message}`);
        }
      }

      return comparables;

    } catch (error) {
      console.error(`❌ Error extracting comparables: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate distance using Google Maps API
   */
  private async calculateDistance(address: string, subjectLat: number, subjectLon: number): Promise<number> {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`
      );
      const data = await response.json();
      
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        const lat = result.geometry.location.lat;
        const lon = result.geometry.location.lon;
        
        return this.haversineDistance(subjectLat, subjectLon, lat, lon);
      }
      
      return 999; // Return large distance if geocoding fails
    } catch (error) {
      console.warn(`⚠️ Error calculating distance for ${address}: ${error.message}`);
      return 999;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceInKm = R * c;
    return distanceInKm * 0.621371; // Convert to miles
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
