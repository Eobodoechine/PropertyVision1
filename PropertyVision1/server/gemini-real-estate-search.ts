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

export interface PropertyDetails {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  price: number | null;
  lotSize: number | null;
  source: string;
  confidence: string;
}

export class GeminiRealEstateSearch {
  private client: GoogleGenAI;
  private googleMapsApiKey: string;

  constructor(apiKey: string, googleMapsApiKey: string) {
    this.client = new GoogleGenAI(apiKey);
    this.googleMapsApiKey = googleMapsApiKey;
  }

  /**
   * Research specific property details using Gemini API with Google Search
   */
  async researchProperty(
    address: string,
    lat: number,
    lon: number
  ): Promise<PropertyDetails> {
    console.log(`🔍 GEMINI RESEARCH: Researching property details for ${address}`);

    try {
      // Create property research prompt
      const researchPrompt = `Find detailed property information for ${address}. Search Zillow, Realtor.com, Redfin, and other real estate sites. Look for:
- Square footage (sqft)
- Number of bedrooms
- Number of bathrooms  
- Year built
- Lot size
- Recent sale price (if available)
- Property type
- Any other relevant details

Return the information in a structured format. If you can't find specific details, indicate "Unknown" for those fields.`;

      // Configure Gemini with Google Search grounding
      const groundingTool = {
        googleSearch: {},
      };

      const config = {
        tools: [groundingTool],
      };

      // Use the models API with Google Search grounding
      const result = await this.client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [{
            text: researchPrompt
          }]
        }],
        config,
      });
      
      // DEBUG: Inspect the response structure
      console.log(`   🔍 DEBUG: result type: ${typeof result}`);
      console.log(`   🔍 DEBUG: result keys: ${Object.keys(result || {})}`);
      console.log(`   🔍 DEBUG: result.text type: ${typeof result.text}`);
      console.log(`   🔍 DEBUG: result.response type: ${typeof result.response}`);
      if (result.response) {
        console.log(`   🔍 DEBUG: result.response keys: ${Object.keys(result.response || {})}`);
        console.log(`   🔍 DEBUG: result.response.text type: ${typeof result.response.text}`);
      }
      
      // Handle the response properly
      const text = result.text;

      console.log(`   📄 Raw response length: ${text.length} characters`);
      console.log(`   📄 Raw response text: ${text.substring(0, 200)}...`);

      // Parse the response to extract property details
      const propertyDetails = this.parsePropertyDetails(text, address);
      
      console.log(`   ✅ Found property details:`, {
        sqft: propertyDetails.sqft,
        beds: propertyDetails.beds,
        baths: propertyDetails.baths,
        yearBuilt: propertyDetails.yearBuilt
      });

      return propertyDetails;

    } catch (error) {
      console.error(`   ❌ Error researching property: ${error.message}`);
      return {
        address,
        sqft: null,
        beds: null,
        baths: null,
        yearBuilt: null,
        price: null,
        lotSize: null,
        source: 'gemini',
        confidence: 'low'
      };
    }
  }

  /**
   * Parse property details from Gemini response text
   */
  private parsePropertyDetails(text: string, address: string): PropertyDetails {
    console.log(`   🔍 DEBUG: Parsing text: ${text.substring(0, 300)}...`);
    
    const details: PropertyDetails = {
      address,
      sqft: null,
      beds: null,
      baths: null,
      yearBuilt: null,
      price: null,
      lotSize: null,
      source: 'gemini',
      confidence: 'medium'
    };

    // Square footage patterns - based on actual format: "*   **Square Footage (sqft):** 1,132 sqft"
    const sqftPatterns = [
      /\*\s+\*\*Square\s*Footage\s*\(sqft\):\*\*\s*(\d{1,3}(?:,\d{3})*)\s*sqft/gi,
      /\*\s+\*\*Square\s*Footage\s*\(sqft\):\*\*\s*(\d{1,4})\s*sqft/gi,
      /Square\s*Footage\s*\(sqft\):\s*(\d{1,3}(?:,\d{3})*)\s*sqft/gi
    ];
    
    for (const pattern of sqftPatterns) {
      const match = pattern.exec(text);
      if (match) {
        const sqft = parseInt(match[1].replace(/,/g, ''));
        if (sqft > 200 && sqft < 10000) {
          details.sqft = sqft;
          console.log(`   🔍 DEBUG: Found sqft: ${sqft} from pattern: ${pattern}`);
          break;
        }
      }
    }

    // Bedrooms patterns - based on actual format: "*   **Number of Bedrooms:** 3"
    const bedPatterns = [
      /\*\s+\*\*Number\s*of\s*Bedrooms:\*\*\s*(\d+)/gi,
      /Number\s*of\s*Bedrooms:\s*(\d+)/gi
    ];
    
    for (const pattern of bedPatterns) {
      const match = pattern.exec(text);
      if (match) {
        const beds = parseInt(match[1]);
        if (beds >= 1 && beds <= 10) {
          details.beds = beds;
          console.log(`   🔍 DEBUG: Found beds: ${beds} from pattern: ${pattern}`);
          break;
        }
      }
    }

    // Bathrooms patterns - based on actual format: "*   **Number of Bathrooms:** 2"
    const bathPatterns = [
      /\*\s+\*\*Number\s*of\s*Bathrooms:\*\*\s*(\d+(?:\.\d+)?)/gi,
      /Number\s*of\s*Bathrooms:\s*(\d+(?:\.\d+)?)/gi
    ];
    
    for (const pattern of bathPatterns) {
      const match = pattern.exec(text);
      if (match) {
        const baths = parseFloat(match[1]);
        if (baths >= 1 && baths <= 10) {
          details.baths = baths;
          console.log(`   🔍 DEBUG: Found baths: ${baths} from pattern: ${pattern}`);
          break;
        }
      }
    }

    // Year built patterns - based on actual format: "*   **Year Built:** 1979"
    const yearPatterns = [
      /\*\s+\*\*Year\s*Built:\*\*\s*(\d{4})/gi,
      /Year\s*Built:\s*(\d{4})/gi
    ];
    
    for (const pattern of yearPatterns) {
      const match = pattern.exec(text);
      if (match) {
        const year = parseInt(match[1]);
        if (year >= 1800 && year <= new Date().getFullYear()) {
          details.yearBuilt = year;
          console.log(`   🔍 DEBUG: Found yearBuilt: ${year} from pattern: ${pattern}`);
          break;
        }
      }
    }

    // Price patterns
    const pricePatterns = [
      /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g,
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*dollars?/gi
    ];
    
    for (const pattern of pricePatterns) {
      const match = text.match(pattern);
      if (match) {
        const price = parseInt(match[1].replace(/[,$]/g, ''));
        if (price >= 10000 && price <= 10000000) {
          details.price = price;
          break;
        }
      }
    }

    // Lot size patterns
    const lotPatterns = [
      /(\d{1,4}(?:,\d{3})*)\s*(?:sq\.?\s*ft\.?|square\s*feet?|sqft)\s*(?:lot|land)/gi,
      /lot[:\s]*(\d{1,4}(?:,\d{3})*)\s*(?:sq\.?\s*ft\.?|square\s*feet?|sqft)/gi
    ];
    
    for (const pattern of lotPatterns) {
      const match = text.match(pattern);
      if (match) {
        const lotSize = parseInt(match[1].replace(/,/g, ''));
        if (lotSize > 1000 && lotSize < 1000000) {
          details.lotSize = lotSize;
          break;
        }
      }
    }

    return details;
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

      // Retry logic for 503 errors
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`   🔄 Attempt ${attempt}/3...`);

      // Configure Gemini with Google Search grounding + structured JSON output
      const groundingTool = {
        googleSearch: {},
      };

    const config = {
      tools: [groundingTool]
    };

          // Make the request with proper content structure
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
          return comparables;

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
      
      const comparables: GeminiComparable[] = [];
      
      // Look for property patterns in the response
      const propertyPatterns = [
        // Pattern 1: Address followed by details
        /(\d+.*?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pl|Place).*?)(?:\$([\d,]+)|(\d+\s*(?:bed|br|bedroom))|(\d+(?:\.\d+)?\s*(?:bath|ba|bathroom))|(\d{3,4}\s*(?:sqft|sq\.?\s*ft)))/gi,
        // Pattern 2: Price followed by address
        /\$([\d,]+).*?(\d+.*?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Ct|Court|Way|Pl|Place).*?)/gi
      ];
      
      let foundProperties = new Set<string>();
      
      for (const pattern of propertyPatterns) {
        let match;
        while ((match = pattern.exec(responseText)) !== null) {
          try {
            let address = '';
            let price = 0;
            let beds = 0;
            let baths = 0;
            let sqft = 0;
            
            if (match[1] && match[1].includes('St') || match[1].includes('Ave') || match[1].includes('Rd') || match[1].includes('Dr')) {
              // Pattern 1: Address first
              address = match[1].trim();
              price = match[2] ? parseInt(match[2].replace(/,/g, '')) : 0;
              beds = match[3] ? parseInt(match[3]) : 0;
              baths = match[4] ? parseFloat(match[4]) : 0;
              sqft = match[5] ? parseInt(match[5]) : 0;
            } else if (match[1] && match[2]) {
              // Pattern 2: Price first
              price = parseInt(match[1].replace(/,/g, ''));
              address = match[2].trim();
            }
            
            // Skip if we already found this property or missing essential data
            if (foundProperties.has(address) || !address || !price) {
              continue;
            }
            
            // Try to extract additional details from surrounding text
            const contextStart = Math.max(0, match.index - 200);
            const contextEnd = Math.min(responseText.length, match.index + 200);
            const context = responseText.substring(contextStart, contextEnd);
            
            // Extract beds if not found
            if (!beds) {
              const bedMatch = context.match(/(\d+)\s*(?:bed|br|bedroom)/i);
              if (bedMatch) beds = parseInt(bedMatch[1]);
            }
            
            // Extract baths if not found
            if (!baths) {
              const bathMatch = context.match(/(\d+(?:\.\d+)?)\s*(?:bath|ba|bathroom)/i);
              if (bathMatch) baths = parseFloat(bathMatch[1]);
            }
            
            // Extract sqft if not found
            if (!sqft) {
              const sqftMatch = context.match(/(\d{3,4})\s*(?:sqft|sq\.?\s*ft|square\s*feet)/i);
              if (sqftMatch) sqft = parseInt(sqftMatch[1]);
            }
            
            // Calculate distance
            let distance = 0.5; // Default fallback
            const distMatch = context.match(/(\d+(?:\.\d+)?)\s*(?:mile|mi)/i);
            if (distMatch) {
              distance = parseFloat(distMatch[1]);
            } else if (address) {
              distance = await this.calculateDistance(address, subjectLat, subjectLon);
            }
            
            // Filter by distance
            if (distance > searchRadius) {
              console.log(`   ❌ Filtering out ${address} (distance: ${distance} > ${searchRadius})`);
              continue;
            }
            
            const comparable: GeminiComparable = {
              address: address,
              price: price,
              sqft: sqft || 1200, // Default fallback
              beds: beds || 3, // Default fallback
              baths: baths || 2, // Default fallback
              yearBuilt: 0, // Not available from search
              soldDate: new Date().toISOString().split('T')[0], // Default to today
              distance: distance,
              source: 'Gemini Search',
              confidence: 'medium' // Natural language parsing is medium confidence
            };
            
            comparables.push(comparable);
            foundProperties.add(address);
            console.log(`   ✅ Added: ${comparable.address} - $${comparable.price.toLocaleString()} - ${comparable.sqft}sqft`);
            
          } catch (error) {
            console.log(`   ⚠️ Error processing property match: ${error.message}`);
          }
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
