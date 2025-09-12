import { GoogleGenAI } from '@google/genai';
import { LLaMAParser } from './llama-parser.js';

interface ComparableProperty {
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

interface FindComparablesResult {
  comparables: ComparableProperty[];
  success: boolean;
  error?: string;
}

class ComparableSearchService {
  private client: GoogleGenAI;
  private googleMapsApiKey: string;
  private llamaParser: LLaMAParser;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.client = new GoogleGenAI({ apiKey });
    
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.googleMapsApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
    
    this.llamaParser = new LLaMAParser();
  }

  async findComparables(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number,
    maxResults: number = 10
  ): Promise<FindComparablesResult> {
    try {
      console.log(`🔍 SEARCHING COMPARABLES: ${subjectAddress}`);
      console.log(`   • Radius: ${searchRadius} miles`);
      console.log(`   • Max results: ${maxResults}`);

      const searchPrompt = this.createSearchPrompt(
        subjectAddress,
        subjectLat,
        subjectLon,
        searchRadius,
        maxResults
      );

      // Configure Gemini with Google Search grounding
      const groundingTool = {
        googleSearch: {},
      };

      const config = {
        tools: [groundingTool],
        generationConfig: {
          temperature: 0
        }
      };

      // Retry logic for 503 errors
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`   🔄 Attempt ${attempt}/3...`);
          
          const result = await this.client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{
              parts: [{
                text: searchPrompt
              }]
            }],
            config,
          });

          console.log(`   📊 Gemini response received`);
          console.log(`   📄 Response text preview: ${result.text?.substring(0, 200) || 'No text'}...`);
          
          // Extract comparables from response using LLaMA parser
          const comparables = await this.extractComparablesFromResponse(
            result,
            subjectAddress,
            subjectLat,
            subjectLon,
            searchRadius
          );

          console.log(`   ✅ Found ${comparables.length} comparables`);
          return {
            comparables,
            success: true
          };

        } catch (error) {
          lastError = error;
          console.log(`   ⚠️ Attempt ${attempt} failed: ${error.message}`);
          
          if (attempt < 3) {
            const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s
            console.log(`   ⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      // All attempts failed
      throw lastError;

    } catch (error) {
      console.error(`❌ Comparable search failed: ${error.message}`);
      return {
        comparables: [],
        success: false,
        error: error.message
      };
    }
  }

  private createSearchPrompt(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number,
    maxResults: number
  ): string {
    return `Find RECENTLY SOLD (closed) comps for the subject property. Use Google Search.
Prefer Redfin, Realtor.com, Zillow, and county/assessor records.

Subject:
- address: ${subjectAddress}
- type: Single-family home
- beds/baths: 3/2
- heated sqft: 1132

HARD FILTERS:
- Only CLOSED sales ('Sold'/'Closed'), within 12 months and ${searchRadius} miles
- Same property type; size roughly 0.8×–1.25× subject sqft (750-1400 sqft)
- Include exact SOLD PRICE and SOLD DATE
- Return 3–6 best comps

SEARCH HINTS:
- recently sold ${subjectAddress.split(',')[1]?.trim() || 'properties'} site:redfin.com OR site:realtor.com OR site:zillow.com
- "${subjectAddress.split(',')[0]}" Sold

OUTPUT RULES:
- For each comp include: address, sold_price, sold_date (ISO), beds, baths, sqft,
  year_built, distance_miles, ppsf, source_url, and source_site (e.g., redfin/realtor/zillow/county)
- Search property listing sites for year built information when available
- If year built is not available, include "Year Built: Unknown"
- Format clearly with each property listed separately
- Include only properties that have actually sold (closed) recently
- Do not include pending or list-only entries`;
  }

  private async extractComparablesFromResponse(
    response: any,
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number
  ): Promise<ComparableProperty[]> {
    try {
      // Get the response text
      const responseText = response.text || '';
      console.log(`   📄 Response text length: ${responseText.length} characters`);
      
      // Check for grounding metadata
      if (response.candidates && response.candidates[0] && response.candidates[0].groundingMetadata) {
        console.log(`   🔍 Grounding metadata found - using real-time search results`);
        const metadata = response.candidates[0].groundingMetadata;
        if (metadata.webSearchQueries) {
          console.log(`   🔍 Search queries used: ${metadata.webSearchQueries.join(', ')}`);
        }
        if (metadata.groundingChunks) {
          console.log(`   📊 Found ${metadata.groundingChunks.length} web sources`);
        }
      }

      // Use LLaMA parser to extract comparables
      console.log(`   🦙 Using LLaMA parser to extract comparables`);
      const parsedComparables = await this.llamaParser.parseComparables(responseText, subjectAddress);
      
      // Convert to our format and add distance calculations
      const comparables: ComparableProperty[] = [];
      
      for (const parsed of parsedComparables) {
        // Calculate actual distance using Google Maps API
        console.log(`   🔍 Calculating distance from (${subjectLat}, ${subjectLon}) to ${parsed.address}`);
        const distance = await this.calculateDistance(parsed.address, subjectLat, subjectLon);
        console.log(`   🔍 Calculated distance: ${distance} miles`);
        
        // Filter by distance
        if (distance > searchRadius) {
          console.log(`   ❌ Filtering out ${parsed.address} (distance: ${distance} > ${searchRadius})`);
          continue;
        }
        
        const comparable: ComparableProperty = {
          address: parsed.address,
          price: parseInt(parsed.price),
          sqft: parsed.sqft,
          beds: parsed.beds,
          baths: parsed.baths,
          yearBuilt: parsed.yearBuilt || 0,
          soldDate: parsed.soldDate,
          distance: distance,
          source: 'Gemini Search + LLaMA',
          confidence: 'high'
        };
        
        comparables.push(comparable);
        console.log(`   ✅ Added: ${comparable.address} - $${comparable.price.toLocaleString()} - ${comparable.sqft}sqft - Built: ${comparable.yearBuilt || 'Unknown'}`);
      }

      // LLaMA parser completed successfully
      console.log(`   🦙 LLaMA parser completed successfully`);

      return comparables;

    } catch (error) {
      console.error(`❌ Error extracting comparables: ${error.message}`);
      return [];
    }
  }

  private async calculateDistance(address: string, subjectLat: number, subjectLon: number): Promise<number> {
    try {
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
        const lat = location.lat;
        const lon = location.lng; // Google Maps uses 'lng' not 'lon'
        
        return this.haversineDistance(subjectLat, subjectLon, lat, lon);
      }
      
      console.warn(`⚠️ Geocoding failed for ${address}: ${data.status}`);
      return 0.5; // Default fallback distance
    } catch (error) {
      console.warn(`⚠️ Error calculating distance for ${address}: ${error.message}`);
      return 0.5; // Default fallback distance
    }
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance * 0.621371; // Convert to miles
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }
}

// Test function
async function testFindComparables() {
  const address = process.env.ADDRESS;
  if (!address) {
    throw new Error('ADDRESS environment variable is required');
  }
  
  // Import and use geocoding service to get real coordinates
  const { GeocodingService } = await import('./step1-geocoding.js');
  const geocodingService = new GeocodingService();
  const geocodingResult = await geocodingService.geocodeAddress(address);
  
  if (!geocodingResult.success) {
    throw new Error(`Geocoding failed: ${geocodingResult.error}`);
  }
  
  const lat = geocodingResult.lat;
  const lon = geocodingResult.lon;
  const radius = 1.0;
  
  console.log(`\n🔍 STEP 3: FINDING COMPARABLES`);
  console.log(`============================================================`);
  
  const searchService = new ComparableSearchService();
  const result = await searchService.findComparables(address, lat, lon, radius, 10);
  
  if (result.success) {
    console.log(`✅ Found ${result.comparables.length} comparables:`);
    result.comparables.forEach((comp, index) => {
      const soldDate = new Date(comp.soldDate).toLocaleDateString();
      console.log(`   ${index + 1}. ${comp.address}`);
      console.log(`      Price: $${comp.price.toLocaleString()}`);
      console.log(`      Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
      console.log(`      Built: ${comp.yearBuilt || 'Unknown'}`);
      console.log(`      Sold: ${soldDate}`);
      console.log(`      Distance: ${comp.distance.toFixed(2)} miles`);
      console.log(`      Source: ${comp.source}`);
    });
  } else {
    console.log(`❌ Comparable search failed: ${result.error}`);
  }
  
  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testFindComparables().catch(console.error);
}

export { ComparableSearchService, testFindComparables };
export type { ComparableProperty, FindComparablesResult };
