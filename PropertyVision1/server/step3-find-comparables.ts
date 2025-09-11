import { GoogleGenAI } from '@google/genai';

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

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.client = new GoogleGenAI(apiKey);
    
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.googleMapsApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
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
        tools: [groundingTool]
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
          console.log(`   📄 Response text preview: ${result.text.substring(0, 200)}...`);
          
          // Extract comparables from response
          const comparables = await this.extractComparablesFromResponse(
            result,
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
- recently sold Henderson NV site:redfin.com OR site:realtor.com OR site:zillow.com
- "${subjectAddress.split(',')[0]}" Sold

OUTPUT RULES:
- For each comp include: address, sold_price, sold_date (ISO), beds, baths, sqft,
  distance_miles, ppsf, source_url, and source_site (e.g., redfin/realtor/zillow/county)
- Format clearly with each property listed separately
- Include only properties that have actually sold (closed) recently
- Do not include pending or list-only entries`;
  }

  private async extractComparablesFromResponse(
    response: any,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number
  ): Promise<ComparableProperty[]> {
    try {
      // Get the response text
      const responseText = response.text;
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

      // Parse natural language response for comparable properties
      console.log(`   🔍 Parsing natural language response for comparables`);
      console.log(`   📄 Full response text: ${responseText}`);
      
      // Clean the response text first to remove reference markers
      const cleanText = responseText.replace(/\[\d+(?:,\s*\d+)*\s+in\s+previous\s+step\]/gi, '');
      
      // Look for structured property data in the response
      const comparables: ComparableProperty[] = [];
      
      // Split by various property section formats
      const compSections = cleanText.split(/\*\*(?:Comparable Property|Comp|Property) \d+\*\*/gi);
      
      for (const section of compSections) {
        if (section.trim().length === 0) continue;
        
        // Extract address (support both formats)
        let addressMatch = section.match(/\*\s+\*\*Address:\*\*\s*([^\n]+)/i);
        if (!addressMatch) {
          addressMatch = section.match(/\*\s+\*\*address:\*\*\s*([^\n]+)/i);
        }
        if (!addressMatch) continue;
        
        const address = addressMatch[1].trim();
        
        // Extract sold price (support both formats)
        let priceMatch = section.match(/\*\s+\*\*Sold Price:\*\*\s*\$([\d,]+)/i);
        if (!priceMatch) {
          priceMatch = section.match(/\*\s+\*\*sold_price:\*\*\s*\$([\d,]+)/i);
        }
        if (!priceMatch) continue;
        
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        
        // Extract beds (support both formats)
        let bedsMatch = section.match(/\*\s+\*\*Beds:\*\*\s*(\d+)/i);
        if (!bedsMatch) {
          bedsMatch = section.match(/\*\s+\*\*beds:\*\*\s*(\d+)/i);
        }
        const beds = bedsMatch ? parseInt(bedsMatch[1]) : 3;
        
        // Extract baths (support both formats)
        let bathsMatch = section.match(/\*\s+\*\*Baths:\*\*\s*(\d+(?:\.\d+)?)/i);
        if (!bathsMatch) {
          bathsMatch = section.match(/\*\s+\*\*baths:\*\*\s*(\d+(?:\.\d+)?)/i);
        }
        const baths = bathsMatch ? parseFloat(bathsMatch[1]) : 2;
        
        // Extract sqft (support both formats)
        let sqftMatch = section.match(/\*\s+\*\*Sqft:\*\*\s*([\d,]+)/i);
        if (!sqftMatch) {
          sqftMatch = section.match(/\*\s+\*\*sqft:\*\*\s*([\d,]+)/i);
        }
        const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 1200;
        
        // Calculate actual distance using Google Maps API
        const distance = await this.calculateDistance(address, subjectLat, subjectLon);
        
        // Debug: Log what we extracted
        console.log(`   🔍 DEBUG: Extracted ${address} - distance: ${distance}`);
        
        // Filter by distance
        if (distance > searchRadius) {
          console.log(`   ❌ Filtering out ${address} (distance: ${distance} > ${searchRadius})`);
          continue;
        }
        
        const comparable: ComparableProperty = {
          address: address,
          price: price,
          sqft: sqft,
          beds: beds,
          baths: baths,
          yearBuilt: 0,
          soldDate: new Date().toISOString().split('T')[0],
          distance: distance,
          source: 'Gemini Search',
          confidence: 'medium'
        };
        
        comparables.push(comparable);
        console.log(`   ✅ Added: ${comparable.address} - $${comparable.price.toLocaleString()} - ${comparable.sqft}sqft`);
      }

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
  const address = process.env.ADDRESS || "243 Kirk Ave, Henderson, NV 89015";
  const lat = 36.053908;
  const lon = -114.9601516;
  const radius = 1.0;
  
  console.log(`\n🔍 STEP 3: FINDING COMPARABLES`);
  console.log(`============================================================`);
  
  const searchService = new ComparableSearchService();
  const result = await searchService.findComparables(address, lat, lon, radius, 10);
  
  if (result.success) {
    console.log(`✅ Found ${result.comparables.length} comparables:`);
    result.comparables.forEach((comp, index) => {
      console.log(`   ${index + 1}. ${comp.address}`);
      console.log(`      Price: $${comp.price.toLocaleString()}`);
      console.log(`      Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
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
