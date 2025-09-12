import { type PropertyAnalysis, type InsertPropertyAnalysis, type AddressSearch } from "@shared/schema";
import { randomUUID } from "crypto";
import { GeminiRealEstateSearch } from "./gemini-real-estate-search";

// Simple in-memory cache for geocoding to reduce external calls
const geocodeCache = new Map<string, { lat: number; lon: number; ts: number }>();

// Concurrency control utilities
class ConcurrencyLimiter {
  private running = 0;
  constructor(private maxConcurrent: number) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
    }
  }
}

// Timeout utility
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    )
  ]);
}

// Google Maps API client for geocoding
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number }> {
  const cacheKey = address.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  
  if (cached && Date.now() - cached.ts < 24 * 60 * 60 * 1000) { // 24 hour cache
    return { lat: cached.lat, lon: cached.lon };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
  );
  
  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  if (data.status !== 'OK' || !data.results || data.results.length === 0) {
    throw new Error(`Geocoding failed: ${data.status} - ${data.error_message || 'No results found'}`);
  }

  const location = data.results[0].geometry.location;
  const result = { lat: location.lat, lon: location.lng };
  
  geocodeCache.set(cacheKey, { ...result, ts: Date.now() });
  return result;
}

// Haversine distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Extract property details from text using regex patterns
function extractPropertyDetails(text: string): Partial<{
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  price: number;
  lotSize: number;
}> {
  const details: any = {};

  // Square footage patterns
  const sqftPatterns = [
    /(\d{1,4})\s*(?:sq\.?\s*ft\.?|square\s*feet?|sqft)/gi,
    /(\d{1,4})\s*(?:sq\s*ft)/gi,
    /(\d{1,4})\s*sf/gi
  ];
  
  for (const pattern of sqftPatterns) {
    const match = text.match(pattern);
    if (match) {
      const sqft = parseInt(match[0].replace(/\D/g, ''));
      if (sqft > 200 && sqft < 10000) {
        details.sqft = sqft;
        break;
      }
    }
  }

  // Bedrooms patterns
  const bedPatterns = [
    /(\d+)\s*(?:bed|bedroom|br|beds)/gi,
    /(\d+)\s*bed/gi
  ];
  
  for (const pattern of bedPatterns) {
    const match = text.match(pattern);
    if (match) {
      const beds = parseInt(match[1]);
      if (beds >= 1 && beds <= 10) {
        details.beds = beds;
        break;
      }
    }
  }

  // Bathrooms patterns
  const bathPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba|baths)/gi,
    /(\d+(?:\.\d+)?)\s*bath/gi
  ];
  
  for (const pattern of bathPatterns) {
    const match = text.match(pattern);
    if (match) {
      const baths = parseFloat(match[1]);
      if (baths >= 1 && baths <= 10) {
        details.baths = baths;
        break;
      }
    }
  }

  // Year built patterns
  const yearPatterns = [
    /built\s*in\s*(\d{4})/gi,
    /year\s*built[:\s]*(\d{4})/gi,
    /constructed\s*in\s*(\d{4})/gi,
    /(\d{4})\s*construction/gi
  ];
  
  for (const pattern of yearPatterns) {
    const match = text.match(pattern);
    if (match) {
      const year = parseInt(match[1]);
      if (year >= 1800 && year <= new Date().getFullYear()) {
        details.yearBuilt = year;
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

  return details;
}

export interface IStorage {
  analyzeProperty(params: AddressSearch): Promise<PropertyAnalysis>;
}

export class MemStorage implements IStorage {
  private geminiLimiter = new ConcurrencyLimiter(2);
  private geminiSearcher: GeminiRealEstateSearch;

  constructor() {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!geminiApiKey || !googleMapsApiKey) {
      console.warn('Missing API keys: GEMINI_API_KEY and GOOGLE_MAPS_API_KEY are required');
    } else {
      this.geminiSearcher = new GeminiRealEstateSearch(geminiApiKey, googleMapsApiKey);
    }
  }

  async analyzeProperty(params: AddressSearch): Promise<PropertyAnalysis> {
    const { address } = params;
    console.log(`\n🏠 ANALYZING PROPERTY: ${address}`);
    console.log('=' .repeat(60));

    try {
      // Step 1: Geocode the address
      console.log('\n📍 STEP 1: GEOCODING ADDRESS');
      const coordinates = await geocodeAddress(address);
      console.log(`   ✅ Coordinates: ${coordinates.lat}, ${coordinates.lon}`);

      // Step 2: Research subject property details
      console.log('\n🔍 STEP 2: RESEARCHING SUBJECT PROPERTY');
      const subjectProperty = await this.researchSubjectProperty(address, coordinates.lat, coordinates.lon);
      console.log(`   ✅ Subject Property: ${subjectProperty.address}`);
      console.log(`   • Square Feet: ${subjectProperty.sqft || 'Unknown'}`);
      console.log(`   • Beds/Baths: ${subjectProperty.beds || 'Unknown'}/${subjectProperty.baths || 'Unknown'}`);
      console.log(`   • Year Built: ${subjectProperty.yearBuilt || 'Unknown'}`);

      // Step 3: Find comparables using Gemini
      console.log('\n🔍 STEP 3: FINDING COMPARABLES');
      const comparables = await this.findComparables(
        address,
        coordinates.lat,
        coordinates.lon,
        subjectProperty
      );

      console.log(`\n📊 STEP 4: ANALYSIS RESULTS`);
      console.log(`   • Comparables found: ${comparables.length}`);
      
      if (comparables.length === 0) {
        throw new Error('No comparables found for analysis');
      }

      // Calculate ARV
      const arv = this.calculateARV(comparables, subjectProperty.sqft);
      const pricePerSqft = subjectProperty.sqft ? Math.round(arv / subjectProperty.sqft) : 0;

      console.log(`   • Estimated ARV: $${arv.toLocaleString()}`);
      console.log(`   • Price per sqft: $${pricePerSqft}`);

      // Create analysis result
      const analysis: PropertyAnalysis = {
        id: randomUUID(),
        address,
        arv: arv.toString(),
        confidence: this.calculateConfidence(comparables),
        pricePerSqFt: pricePerSqft.toString(),
        beds: subjectProperty.beds,
        baths: subjectProperty.baths,
        sqft: subjectProperty.sqft,
        yearBuilt: subjectProperty.yearBuilt,
        comparables: comparables.map(comp => ({
          address: comp.address,
          price: comp.price,
          sqft: comp.sqft,
          pricePerSqft: comp.pricePerSqft,
          beds: comp.beds,
          baths: comp.baths,
          yearBuilt: comp.yearBuilt,
          soldDate: comp.soldDate,
          distance: comp.distance,
          source: comp.source || 'gemini'
        })),
        isExactMatch: true,
        createdAt: new Date()
      };

      return analysis;

    } catch (error) {
      console.error('❌ Analysis failed:', error);
      throw error;
    }
  }

  private async researchSubjectProperty(address: string, lat: number, lon: number): Promise<any> {
    console.log(`   🔍 Researching property details for: ${address}`);
    
    if (!this.geminiSearcher) {
      throw new Error('Gemini searcher not initialized');
    }

    try {
      // Step 1: Use Gemini to research the specific property
      console.log(`   📡 Researching property details using Gemini...`);
      
      const propertyDetails = await this.geminiSearcher.researchProperty(address, lat, lon);

      if (propertyDetails.sqft || propertyDetails.beds || propertyDetails.baths || propertyDetails.yearBuilt) {
        console.log(`   ✅ Found property details via Gemini`);
        return {
          address: propertyDetails.address || address,
          sqft: propertyDetails.sqft,
          beds: propertyDetails.beds,
          baths: propertyDetails.baths,
          yearBuilt: propertyDetails.yearBuilt,
          price: propertyDetails.price,
          lotSize: propertyDetails.lotSize
        };
      }

      // Step 2: Fallback to municipality/assessor site
      console.log(`   🏛️ Gemini didn't find details, checking municipality records...`);
      return await this.checkMunicipalityRecords(address, lat, lon);

    } catch (error) {
      console.warn(`   ⚠️ Error researching property: ${error.message}`);
      console.log(`   🏛️ Falling back to municipality records...`);
      return await this.checkMunicipalityRecords(address, lat, lon);
    }
  }

  private async checkMunicipalityRecords(address: string, lat: number, lon: number): Promise<any> {
    console.log(`   🏛️ Checking local municipality/assessor records...`);
    
    try {
      // Extract city and state from address
      const addressParts = address.split(',');
      const city = addressParts[1]?.trim() || '';
      const state = addressParts[2]?.trim().split(' ')[0] || '';
      
      console.log(`   📍 Searching for: ${city}, ${state}`);
      
      // Create search query for municipality records
      const municipalityQuery = `Find property records for ${address} on ${city} ${state} assessor website, property tax records, or municipality database. Get square footage, bedrooms, bathrooms, year built, lot size.`;
      
      const propertyDetails = await this.geminiSearcher.researchProperty(municipalityQuery, lat, lon);

      if (propertyDetails.sqft || propertyDetails.beds || propertyDetails.baths || propertyDetails.yearBuilt) {
        console.log(`   ✅ Found property details via municipality records`);
        return {
          address: propertyDetails.address || address,
          sqft: propertyDetails.sqft,
          beds: propertyDetails.beds,
          baths: propertyDetails.baths,
          yearBuilt: propertyDetails.yearBuilt,
          price: propertyDetails.price,
          lotSize: propertyDetails.lotSize
        };
      }

      // Final fallback - return minimal data
      console.log(`   ⚠️ No property details found, using minimal data`);
      return {
        address,
        sqft: null,
        beds: null,
        baths: null,
        yearBuilt: null,
        price: null,
        lotSize: null
      };

    } catch (error) {
      console.warn(`   ⚠️ Municipality search failed: ${error.message}`);
      return {
        address,
        sqft: null,
        beds: null,
        baths: null,
        yearBuilt: null,
        price: null,
        lotSize: null
      };
    }
  }

  private async findComparables(
    address: string,
    lat: number,
    lon: number,
    subjectProperty: any
  ): Promise<any[]> {
    if (!this.geminiSearcher) {
      throw new Error('Gemini searcher not initialized');
    }

    const maxRadius = 2; // Start with 2 mile radius
    let radius = 1.0; // Start with 1 mile instead of 0.5
    let allComparables: any[] = [];

    while (radius <= maxRadius && allComparables.length < 5) {
      console.log(`   🔍 Searching within ${radius} miles...`);
      
      try {
        const comps = await this.geminiSearcher.searchComparables(
          address,
          lat,
          lon,
          radius,
          10 // Request up to 10 comps per radius
        );

        // Filter and process comparables
        const validComps = comps
          .filter(comp => {
            // Basic validation
            if (!comp.address || !comp.price || !comp.sqft) return false;
            
            // Size similarity (within 50% of subject if we have subject sqft)
            if (subjectProperty.sqft) {
              const sizeRatio = comp.sqft / subjectProperty.sqft;
              if (sizeRatio < 0.5 || sizeRatio > 1.5) return false;
            }
            
            // Price reasonableness
            if (comp.price < 50000 || comp.price > 2000000) return false;
            
            return true;
          })
          .map(comp => ({
            address: comp.address,
            price: comp.price,
            sqft: comp.sqft,
            pricePerSqft: Math.round(comp.price / comp.sqft),
            beds: comp.beds,
            baths: comp.baths,
            yearBuilt: comp.yearBuilt,
            soldDate: comp.soldDate,
            distance: comp.distance || calculateDistance(lat, lon, comp.lat || lat, comp.lon || lon),
            source: 'gemini',
            confidence: comp.confidence
          }));

        allComparables.push(...validComps);
        console.log(`   ✅ Found ${validComps.length} valid comparables (${allComparables.length} total)`);
        
        radius += 0.5;
      } catch (error) {
        console.warn(`   ⚠️ Error searching at ${radius} miles:`, error.message);
        radius += 0.5;
      }
    }

    // Remove duplicates and sort by distance
    const uniqueComps = allComparables.filter((comp, index, self) => 
      index === self.findIndex(c => c.address === comp.address)
    );

    return uniqueComps
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5); // Return top 5
  }

  private calculateARV(comparables: any[], subjectSqft: number | null): number {
    if (comparables.length === 0) return 0;
    if (!subjectSqft) return 0;

    // Calculate price per square foot for each comparable
    const ppsfValues = comparables.map(comp => comp.pricePerSqft);
    
    // Remove outliers using IQR method
    ppsfValues.sort((a, b) => a - b);
    const q1Index = Math.floor(ppsfValues.length * 0.25);
    const q3Index = Math.floor(ppsfValues.length * 0.75);
    const q1 = ppsfValues[q1Index];
    const q3 = ppsfValues[q3Index];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const filteredPpsf = ppsfValues.filter(ppsf => 
      ppsf >= lowerBound && ppsf <= upperBound
    );

    // Use median of filtered values
    const medianPpsf = filteredPpsf.length > 0 
      ? filteredPpsf[Math.floor(filteredPpsf.length / 2)]
      : ppsfValues[Math.floor(ppsfValues.length / 2)];

    return Math.round(medianPpsf * subjectSqft);
  }

  private calculateConfidence(comparables: any[]): string {
    if (comparables.length === 0) return 'Low';
    if (comparables.length >= 5) return 'High';
    if (comparables.length >= 3) return 'Medium';
    return 'Low';
  }
}

export const storage = new MemStorage();