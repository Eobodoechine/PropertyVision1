import { type PropertyAnalysis, type InsertPropertyAnalysis, type AddressSearch } from "@shared/schema";
import { randomUUID } from "crypto";
import { GeminiRealEstateSearch } from "./gemini-real-estate-search";
// Simple in-memory cache for geocoding to reduce external calls
const geocodeCache = new Map<string, { lat: number; lon: number; ts: number }>();

// FAST MODE: Concurrency control utilities
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

// FAST MODE: Timeout wrapper
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => 
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

// FAST MODE: Check if lean mode is enabled
function isLeanMode(): boolean {
  return process.env.ANALYZE_DEBUG !== '1' && process.env.DEBUG !== '1';
}

// Helper to compute bathrooms including half baths when API splits fields
function computeBaths(desc: any): number | null {
  if (!desc) return null;
  const baths = Number(desc.baths);
  if (Number.isFinite(baths) && baths > 0) return baths;
  const fullCalc = Number(desc.baths_full_calc);
  const halfCalc = Number(desc.baths_partial_calc);
  const full = Number(desc.baths_full);
  const half = Number(desc.baths_half);
  let total = 0;
  if (Number.isFinite(fullCalc)) total += fullCalc;
  else if (Number.isFinite(full)) total += full;
  if (Number.isFinite(halfCalc)) total += 0.5 * halfCalc;
  else if (Number.isFinite(half)) total += 0.5 * half;
  return total > 0 ? total : null;
}

export interface IStorage {
  getPropertyAnalysis(id: string): Promise<PropertyAnalysis | undefined>;
  getPropertyAnalysisByAddress(address: string): Promise<PropertyAnalysis | undefined>;
  createPropertyAnalysis(analysis: InsertPropertyAnalysis): Promise<PropertyAnalysis>;
  analyzeProperty(addressSearch: AddressSearch): Promise<PropertyAnalysis>;
}

export class MemStorage implements IStorage {
  // FAST MODE: Concurrency limiters
  private detailLimiter = new ConcurrencyLimiter(4); // Max 4 detail lookups in-flight
  private geminiLimiter = new ConcurrencyLimiter(2); // Max 2 Gemini searches in-flight
  private geminiSearcher: GeminiRealEstateSearch;

  constructor() {
    // No storage - fresh analysis every time
    // Initialize Gemini searcher
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (geminiApiKey && googleMapsApiKey) {
      this.geminiSearcher = new GeminiRealEstateSearch(geminiApiKey, googleMapsApiKey);
      console.log('✅ Gemini Real Estate Search initialized');
    } else {
      console.warn('⚠️ Gemini API keys not found, analysis may be limited');
    }
  }

  private isPlausibleSqft(n: any): boolean {
    const v = Number(n);
    return Number.isFinite(v) && v >= 600 && v <= 10000;
  }

  private async assessMarketActivity(lat: number, lon: number, apiKey: string): Promise<{level: string, score: number}> {
    try {
      console.log(`   🔍 Assessing market activity in area...`);
      console.log(`   🔍 Activity Assessment Debug:`);
      console.log(`   • Search parameters: lat=${lat}, lon=${lon}, radius=1`);
      console.log(`   • Property types: ${['single_family', 'multi_family', 'condos', 'townhomes'].join(', ')}`);
      console.log(`   • Time window: 6 months`);
      
      // Search for recent sales in 1-mile radius to assess activity
      const recentSales = await this.searchWithFilters(lat, lon, 1, ['single_family', 'multi_family', 'condos', 'townhomes'], 500, 5000, null, '', 6);
      
      console.log(`   • Raw API response length: ${recentSales.length}`);
      
      // Count recent sales and calculate activity score
      const salesCount = recentSales.length;
      let activityScore = 0;
      let activityLevel = 'Unknown';
      
      if (salesCount >= 15) {
        activityScore = 9;
        activityLevel = 'Very High';
      } else if (salesCount >= 10) {
        activityScore = 8;
        activityLevel = 'High';
      } else if (salesCount >= 7) {
        activityScore = 7;
        activityLevel = 'Medium-High';
      } else if (salesCount >= 4) {
        activityScore = 6;
        activityLevel = 'Medium';
      } else if (salesCount >= 2) {
        activityScore = 4;
        activityLevel = 'Low-Medium';
      } else if (salesCount >= 1) {
        activityScore = 3;
        activityLevel = 'Low';
      } else {
        activityScore = 1;
        activityLevel = 'Very Low';
      }
      
      console.log(`   • Recent sales (6 months): ${salesCount}`);
      console.log(`   • Activity score: ${activityScore}/10`);
      
      return { level: activityLevel, score: activityScore };
    } catch (error) {
      console.log(`   ⚠️ Could not assess activity, defaulting to medium activity`);
      return { level: 'Medium', score: 5 };
    }
  }

  private isPlausibleYear(y: any): boolean {
    const v = Number(y);
    const now = new Date().getFullYear();
    return Number.isFinite(v) && v >= 1800 && v <= now + 1;
  }

  async getPropertyAnalysis(id: string): Promise<PropertyAnalysis | undefined> {
    // No storage - always return undefined
    return undefined;
  }

  async getPropertyAnalysisByAddress(address: string): Promise<PropertyAnalysis | undefined> {
    // No storage - always return undefined to force fresh analysis
    return undefined;
  }

  async createPropertyAnalysis(insertAnalysis: InsertPropertyAnalysis | any): Promise<PropertyAnalysis | any> {
    const id = randomUUID();
    const analysis: any = {
      id,
      address: insertAnalysis.address,
      arv: insertAnalysis.arv || null,
      confidence: insertAnalysis.confidence || null,
      pricePerSqFt: insertAnalysis.pricePerSqFt || null,
      beds: insertAnalysis.beds || null,
      baths: insertAnalysis.baths || null,
      sqft: insertAnalysis.sqft || null,
      yearBuilt: insertAnalysis.yearBuilt || null,
      comparables: insertAnalysis.comparables || null,
      isExactMatch: insertAnalysis.isExactMatch || false,
      createdAt: new Date(),
      // Handle dual calculation properties if they exist
      ...(insertAnalysis.isDualCalculation && {
        isDualCalculation: insertAnalysis.isDualCalculation,
        arvWith2ndBathroom: insertAnalysis.arvWith2ndBathroom,
        comparablesWith2ndBath: insertAnalysis.comparablesWith2ndBath,
      }),
      ...(insertAnalysis.alternates && { alternates: insertAnalysis.alternates })
    };
    // NO STORAGE - Return analysis without storing it
    return analysis;
  }

  private normalizeAddress(address: string): string {
    // Remove non-breaking spaces (U+00A0) and other invisible characters
    return address
      .replace(/\u00A0/g, ' ')  // Non-breaking spaces to regular spaces
      .replace(/\u2000-\u200F/g, ' ')  // Various Unicode spaces to regular spaces
      .replace(/\u2028-\u2029/g, ' ')  // Line and paragraph separators
      .replace(/\s+/g, ' ')  // Multiple spaces to single space
      .trim();  // Remove leading/trailing spaces
  }

  async analyzeProperty(addressSearch: AddressSearch): Promise<PropertyAnalysis> {
    // NO CACHING - Fresh analysis every time per user request
    // Normalize the address to handle invisible characters like non-breaking spaces
    const normalizedAddress = this.normalizeAddress(addressSearch.address);
    console.log(`Original address: "${addressSearch.address}"`);
    console.log(`Normalized address: "${normalizedAddress}"`);

    // Get API key from environment
    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error("RapidAPI key not configured. Please add RAPIDAPI_KEY to environment variables.");
    }

    if (!isLeanMode()) {
      console.log(`\n🔍 NEW INTELLIGENT SEARCH: Analyzing ${normalizedAddress}`);
    }

    try {
      // STEP 1: Get exact coordinates via auto-complete
      if (!isLeanMode()) {
        console.log('Step 1: Getting coordinates...');
      }
      const coords = await this.getCoordinatesFromAddress(normalizedAddress, apiKey);
      const centerLat = coords.lat;
      const centerLon = coords.lon;
      if (!isLeanMode()) {
        console.log(`✅ Coordinates found: ${centerLat}, ${centerLon}`);
      }

      // WEB_ONLY mode: use web search exclusively for subject details
      if ((process.env.WEB_ONLY || '').toString().trim() !== ''
          && (process.env.WEB_ONLY || '0') !== '0'
          && (process.env.WEB_ONLY || '').toLowerCase() !== 'false') {
        console.log('🧪 WEB_ONLY enabled: using web search for subject details');
        const details = await webSearch.forPropertyDetails(normalizedAddress);
        if (!details) {
          throw new Error('Web search did not return property details');
        }
        const webSqft = details.sqft ?? null;
        const webYear = details.yearBuilt ?? null;
        const webBeds = (details.beds as any) ?? null;
        const webBaths = (details.baths as any) ?? null;
        const webType = (details.type as any) ?? '';
        console.log(`🧪 WEB_ONLY DETAILS: sqft=${webSqft}, yearBuilt=${webYear}, beds=${webBeds}, baths=${webBaths}, type=${webType}`);
        if (!this.isPlausibleSqft(webSqft)) {
          throw new Error('Square footage not available from web search; unable to compute ARV in WEB_ONLY mode.');
        }
        return await this.continueAnalysisWithResearchedData(
          normalizedAddress,
          centerLat,
          centerLon,
          webSqft as number,
          webYear as number | null,
          webBeds as number,
          webBaths as number,
          (typeof webType === 'string' ? webType : '')
        );
      }

      // STEP 2: Find subject property with small boundary search  
      console.log('Step 2: Getting subject property details...');
      const subjectProperty = await this.findSubjectProperty(normalizedAddress, centerLat, centerLon, apiKey);

      if (!subjectProperty) {
        console.log('⚠️ Subject property not found in MLS data - proceeding with web research fallback');
        console.log('🔍 ROUTE: Taking WEB RESEARCH path because MLS returned no results');

        // Check if address exists in autocomplete first and get MPR ID
        console.log('🔍 STEP 2.5: Checking if address exists in autocomplete system...');
        const autocompleteResult = await this.checkAddressInAutocomplete(normalizedAddress, apiKey);
        console.log(`🔍 AUTOCOMPLETE RESULT: ${autocompleteResult ? 'FOUND' : 'NOT FOUND'}`);

        let researchedData = null;

        // If we have an MPR ID, try to get property details directly from API
        if (autocompleteResult && autocompleteResult.mpr_id) {
          console.log('🔍 STEP 2.6: Attempting to get property details via MPR ID...');
          const mprDetails = await this.getPropertyDetailsFromMPR(autocompleteResult.mpr_id, apiKey);
          if (mprDetails) {
            researchedData = mprDetails;
            console.log('✅ PROPERTY DETAILS FOUND via MPR API');
          }
        }

        // If MPR didn't work, fall back to web search
        if (!researchedData) {
          console.log('🔍 STEP 2.7: Falling back to web search research...');
          researchedData = await this.researchPropertyData(normalizedAddress);
        }

        if (!researchedData || (!researchedData.sqft && !researchedData.yearBuilt && !researchedData.beds)) {
          if (autocompleteResult) {
            throw new Error(`Property found at ${normalizedAddress}, but detailed property information (square footage, bedrooms, year built) is not available in public records. This may be a new construction, a property pending data updates, or have limited public information. Please try again later or contact the property owner for details.`);
          } else {
            throw new Error(`Property data unavailable for ${normalizedAddress}. This property may not exist in public records, may be a new construction, or the address may be incorrect. Please verify the address and try again.`);
          }
        }

        // Use authenticated property details we researched externally
        console.log(`📋 USING AUTHENTIC PROPERTY DETAILS FROM EXTERNAL RESEARCH:`);
        console.log(`   • Address: ${normalizedAddress}`);
        console.log(`   • Authentic Size: ${researchedData.sqft || 'unknown'} sqft (researched)`);
        console.log(`   • Authentic Type: ${researchedData.propertyType || 'unknown'} (researched)`);
        console.log(`   • Authentic Beds/Baths: ${researchedData.beds || 'unknown'} bed, ${researchedData.baths || 'unknown'} bath`);

        console.log(`🔄 CONTINUING ANALYSIS WITH RESEARCHED DATA`);

        // For 851 Hedge Garden Ct, use the known authentic property data from web research
        let finalSqft = researchedData.sqft;
        let finalYearBuilt = researchedData.yearBuilt;
        let finalBeds = researchedData.beds;
        let finalBaths = researchedData.baths;
        let finalType = researchedData.propertyType;



        console.log(`🔍 FINAL PROPERTY DATA: ${finalSqft} sqft, ${finalYearBuilt} built, ${finalBeds} bed, ${finalBaths} bath, ${finalType}`);

        return await this.continueAnalysisWithResearchedData(
          normalizedAddress, 
          centerLat, 
          centerLon,
          finalSqft,
          finalYearBuilt,
          finalBeds,
          finalBaths,
          finalType
        );
      }

      // Extract subject property details
      console.log('🔍 ROUTE: Taking MLS DATA path because subject property was found');
      let subjectSqft = subjectProperty.description?.sqft;
      const subjectYearBuilt = subjectProperty.description?.year_built;
      const subjectBeds = subjectProperty.description?.beds;
      const subjectBaths = subjectProperty.description?.baths;
      const propertyType = subjectProperty.description?.type?.toLowerCase();



      console.log(`Subject Property: ${subjectProperty.location?.address?.line}`);
      console.log(`🔍 MLS DATA: sqft=${subjectSqft}, yearBuilt=${subjectYearBuilt}, beds=${subjectBeds}, baths=${subjectBaths}, type=${propertyType}`);
      console.log(`Type: ${propertyType}, ${subjectSqft} sqft, built ${subjectYearBuilt || 'Unknown'}`);
      console.log(`${subjectBeds}bed/${subjectBaths}bath`);

      // Prepare final subject fields; prefer MLS, fill missing from RapidAPI detail
      // Normalize year built from MLS fields (year_built or yearBuilt)
      const mlsYearCandidates: Array<number | null | undefined> = [
        subjectProperty?.description?.year_built as any,
        (subjectProperty?.description as any)?.yearBuilt as any
      ];
      let finalYearBuilt: number | null | undefined = mlsYearCandidates.map(n => Number(n)).find(n => this.isPlausibleYear(n));
      let finalPropertyType = propertyType;
      let finalSubjectSqft = subjectSqft;

      // If any key subject fields are missing and we have a property_id, fetch detail to fill blanks
      try {
        const needsDetail = (!!subjectProperty?.property_id) && (
          !this.isPlausibleYear(finalYearBuilt) || !finalPropertyType || !finalSubjectSqft || !subjectBeds || !subjectBaths
        );
        if (needsDetail) {
          const detail = await this.fetchDetailById(String(subjectProperty.property_id));
          if (detail && detail.description) {
            // Prefer any plausible year from detail
            const detailYearCandidates: Array<number | null | undefined> = [
              (detail.description as any)?.year_built as any,
              (detail.description as any)?.yearBuilt as any
            ];
            const pick = detailYearCandidates.map(n => Number(n)).find(n => this.isPlausibleYear(n));
            if (this.isPlausibleYear(pick) && !this.isPlausibleYear(finalYearBuilt)) finalYearBuilt = pick as number;
            finalPropertyType = finalPropertyType ?? (detail.description.type ? String(detail.description.type).toLowerCase() : finalPropertyType);
            // Only fill sqft if MLS missing/implausible
            if (!finalSubjectSqft || !this.isPlausibleSqft(finalSubjectSqft)) {
              const dSqft = Number(detail.description.sqft);
              if (this.isPlausibleSqft(dSqft)) finalSubjectSqft = dSqft;
            }
            // Prefer consolidated baths value on subject when available (e.g., "1.5")
            const consolidated = (detail.description as any)?.baths_consolidated;
            const consolidatedNum = typeof consolidated === 'string' ? parseFloat(consolidated) : (typeof consolidated === 'number' ? consolidated : undefined);
            if (Number.isFinite(consolidatedNum)) {
              subjectProperty.description = subjectProperty.description || {};
              (subjectProperty.description as any).baths_consolidated = consolidatedNum;
            }
          }
        }
      } catch {}

      // Ensure baths_consolidated is populated even when other fields are already present
      try {
        const hasConsolidated = Number.isFinite(
          typeof (subjectProperty?.description as any)?.baths_consolidated === 'string'
            ? parseFloat((subjectProperty!.description as any).baths_consolidated)
            : (subjectProperty as any)?.description?.baths_consolidated
        );
        if (!hasConsolidated && subjectProperty?.property_id) {
          const detail = await this.fetchDetailById(String(subjectProperty.property_id));
          const consolidated = (detail?.description as any)?.baths_consolidated;
          const consolidatedNum = typeof consolidated === 'string' ? parseFloat(consolidated) : (typeof consolidated === 'number' ? consolidated : undefined);
          if (Number.isFinite(consolidatedNum)) {
            subjectProperty.description = subjectProperty.description || {};
            (subjectProperty.description as any).baths_consolidated = consolidatedNum;
          }
        }
      } catch {}

      // Determine if anything still missing after RapidAPI detail fill
      const missingData: string[] = [];
      if (!finalYearBuilt) missingData.push('year built');
      if (!finalSubjectSqft) missingData.push('square feet');
      const shouldResearch = missingData.length > 0;

      if (shouldResearch) {
        console.log(`📋 WEB RESEARCH: ${missingData.length > 0 ? `Missing: ${missingData.join(', ')}` : 'Verifying MLS data'} - Starting web research...`);

        const researchedData = await this.researchPropertyData(normalizedAddress);
        console.log(`🔍 WEB RESEARCH RESULT: ${researchedData ? JSON.stringify(researchedData) : 'null'}`);
        if (researchedData) {
          if (!this.isPlausibleYear(finalYearBuilt) && this.isPlausibleYear(researchedData.yearBuilt)) {
            finalYearBuilt = Number(researchedData.yearBuilt);
            if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false')) {
              console.log(`✅ WEB RESEARCH SUCCESS: Found year built ${finalYearBuilt}`);
            }
          }
          if (typeof researchedData.sqft === 'number' && this.isPlausibleSqft(researchedData.sqft)) {
            if (!finalSubjectSqft || !this.isPlausibleSqft(finalSubjectSqft)) {
              finalSubjectSqft = researchedData.sqft;
              console.log(`✅ WEB RESEARCH SUCCESS: Using researched sqft ${finalSubjectSqft} (MLS missing/implausible)`);
            } else {
              // Do not override MLS sqft when MLS value is present and plausible
              console.log(`ℹ️ Keeping MLS sqft ${finalSubjectSqft}; ignoring researched sqft ${researchedData.sqft}`);
            }
          } else if (researchedData?.sqft != null) {
            console.log(`ℹ️ Ignoring researched sqft ${researchedData.sqft} as implausible`);
          }
        } else {
          console.log(`❌ WEB RESEARCH FAILED: Missing data for ${missingData.join(', ')} - using fallback values`);
        }
      }

      // Research missing or unclear property type
      if (!propertyType || propertyType === 'unknown' || propertyType === 'other') {
        console.log('📋 MISSING/UNCLEAR PROPERTY TYPE: Attempting web research for property type...');

        const researchedData = await this.researchPropertyData(normalizedAddress);
        if (researchedData && researchedData.propertyType) {
          finalPropertyType = researchedData.propertyType.toLowerCase();
          console.log(`✅ WEB RESEARCH SUCCESS: Found property type ${finalPropertyType}`);
        } else {
          console.log('📋 WEB RESEARCH FAILED: Property type not available - using broad search');
          finalPropertyType = 'unknown';
        }
      }

      if (!finalSubjectSqft) {
        console.log('📋 MISSING DATA: Subject property missing square footage after web research');

        // Try one more comprehensive web search for this specific property
        const lastResortData = await this.researchPropertyData(normalizedAddress);
        if (lastResortData && lastResortData.sqft) {
          finalSubjectSqft = lastResortData.sqft;
          console.log(`✅ LAST RESORT SUCCESS: Found square feet ${finalSubjectSqft}`);
        } else {
          // Graceful error with user-friendly message
          throw new Error(`Property data unavailable for ${normalizedAddress}. This property may not exist in public records or may be a new construction. Please verify the address and try again.`);
        }
      }

      // ENHANCED STEP 3: CONDITIONAL SEARCH METHODOLOGY
      const minSqft = Math.round(finalSubjectSqft * 0.8);
      const maxSqft = Math.round(finalSubjectSqft * 1.2);

      // Debug the property type mapping
      console.log(`🔍 PROPERTY TYPE MAPPING:`);
      console.log(`   • Detected property type: "${finalPropertyType}"`);

      let propertyTypeFilter: string[];
      if (finalPropertyType === 'duplex' || finalPropertyType === 'multi_family') {
        propertyTypeFilter = ['multi_family'];
        console.log(`   • Mapped to: multi_family (duplex/multi-family)`);
      } else if (finalPropertyType === 'townhome' || finalPropertyType === 'townhomes') {
        propertyTypeFilter = ['townhomes'];
        console.log(`   • Mapped to: townhomes`);
      } else if (finalPropertyType === 'condo' || finalPropertyType === 'condos') {
        propertyTypeFilter = ['condos'];
        console.log(`   • Mapped to: condos`);
      } else if (finalPropertyType === 'single_family' || finalPropertyType === 'single family') {
        propertyTypeFilter = ['single_family'];
        console.log(`   • Mapped to: single_family`);
      } else {
        propertyTypeFilter = ['multi_family'];
        console.log(`   • Unknown type "${finalPropertyType}" - defaulting to: multi_family`);
      }

      console.log(`Step 3: Enhanced search parameters with conditional methodology:`);
      console.log(`- Size range: ${minSqft}-${maxSqft} sqft (±20% of ${finalSubjectSqft})`);
      const yrMax = finalYearBuilt ? finalYearBuilt + 10 : null;
      console.log(`- Year filter: ${yrMax ? `Max ${yrMax}` : 'No year filter'} (max 10 years newer than ${finalYearBuilt ?? 'N/A'})`);
      console.log(`- Property type: ${finalPropertyType} → Search types: ${propertyTypeFilter.join(', ')}`);
      console.log(`- Strategy: Gemini-first, then RapidAPI fallback if insufficient`);

      // Determine early whether dual ARV is needed (subject baths < 2)
      const subjBathsConsolRaw = (subjectProperty?.description as any)?.baths_consolidated;
      const subjBathsConsol = typeof subjBathsConsolRaw === 'string' ? parseFloat(subjBathsConsolRaw) : (typeof subjBathsConsolRaw === 'number' ? subjBathsConsolRaw : NaN);
      const subjBathsComputed = computeBaths(subjectProperty.description);
      const subjBathsNumeric = Number.isFinite(subjBathsConsol) ? subjBathsConsol : (Number.isFinite(subjBathsComputed as any) ? (subjBathsComputed as number) : Number(subjectProperty?.description?.baths) || 0);
      const dualNeeded = subjBathsNumeric < 2 - 1e-9;
      console.log(`🚿 EARLY BATH DECISION: subject baths=${subjBathsNumeric} → dual ARV ${dualNeeded ? 'NEEDED' : 'NOT needed'}`);

      // DYNAMIC SEARCH WITH ACTIVITY-BASED RADIUS EXPANSION
      let radius = 1;
      let maxRadius = 5; // Will be adjusted based on activity level
      let finalValidComps: any[] = [];
      let finalResearchCandidates: any[] = [];
      // Track targets to ensure enough comps for baseline (and two-bath if dual)
      const baselineTarget = 5;
      const twoBathTarget = dualNeeded ? 5 : 0;
      const epsilon = 1e-9;
      let geminiAttempted = false; // Track if Gemini has been attempted at current radius
      
      // Start with default activity level - will be adjusted based on search results
      let activityLevel = { level: 'Medium', score: 5 };
      console.log(`\n🔍 MARKET ACTIVITY ASSESSMENT:`);
      console.log(`   • Starting with default activity level: ${activityLevel.level} (${activityLevel.score}/10)`);
      console.log(`   • Will adjust based on search results`);
      
      // Start with default max radius - will be adjusted based on results
      maxRadius = 3; // Default to medium activity
      console.log(`   • Starting with default max radius: ${maxRadius} miles`);

      const isBaselineEligible = (comp: any): boolean => {
        const b = parseFloat(comp?.baths?.toString() || 'NaN');
        if (!Number.isFinite(b)) return false;
        if (b > subjBathsNumeric + epsilon) return false;
        if (subjBathsNumeric < 2 - epsilon && b >= 2 - epsilon) return false;
        return true;
      };
      const isTwoBathEligible = (comp: any): boolean => {
        const b = parseFloat(comp?.baths?.toString() || 'NaN');
        return Number.isFinite(b) && b >= 1.75 && b <= 2.5;
      };

      console.log(`Starting step-by-step enhanced conditional search methodology...`);

      while (radius <= maxRadius) {
        console.log(`\n╔═══════════════════════════════════════════════════════════════════════════════════════════╗`);
        console.log(`║                                 RADIUS ${radius} MILE SEARCH                                    ║`);
        console.log(`╚═══════════════════════════════════════════════════════════════════════════════════════════╝`);
        
        // Reset Gemini attempt flag for each radius
        geminiAttempted = false;

        console.log(`\n🔍 STEP 3A: GEMINI-FIRST SEARCH`);
        console.log(`   • Search radius: ${radius} miles`);
        console.log(`   • Size filter: ${minSqft}-${maxSqft} sqft`);
        console.log(`   • Property types: ${propertyTypeFilter.join(', ')}`);
        console.log(`   • Year filter: ${finalYearBuilt ? 'Max ' + (finalYearBuilt+10) : 'No year filter'}`);
        console.log(`   • Status: sold properties only`);
        console.log(`   • Time range: ${activityLevel.score >= 6 ? '6 months' : activityLevel.score >= 4 ? '12 months' : '18 months'}`);

        // GEMINI-FIRST APPROACH: Start with Gemini search
        let phaseOneComps: any[] = [];
        console.log(`   🔍 Gemini Integration Debug:`);
        console.log(`   • Gemini searcher available: ${!!this.geminiSearcher}`);
        console.log(`   • Search parameters: ${normalizedAddress}, ${centerLat}, ${centerLon}, ${radius}`);
        console.log(`   • Max results: 8`);
        
        if (this.geminiSearcher) {
          try {
            console.log(`   🔍 GEMINI PRIMARY: Searching with Gemini at ${radius} mile radius...`);
            const geminiComps = await this.geminiSearcher.searchComparables(
              normalizedAddress,
              centerLat,
              centerLon,
              radius,
              8 // Request more comps initially
            );

            if (geminiComps.length > 0) {
              console.log(`   ✅ GEMINI: Found ${geminiComps.length} comparables`);
              
              // Convert Gemini results to our format
              phaseOneComps = geminiComps.map(comp => ({
                address: comp.address,
                sqft: comp.sqft,
                price: comp.price,
                pricePerSqft: Math.round(comp.price / comp.sqft),
                beds: comp.beds,
                baths: comp.baths,
                yearBuilt: comp.yearBuilt,
                last_sold_date: comp.soldDate,
                distance_miles: comp.distance,
                source: 'gemini',
                confidence: comp.confidence,
                researched: false
              }));

              // Show Gemini results
              geminiComps.forEach((comp, i) => {
                console.log(`   ${i+1}. ${comp.address} - ${comp.sqft}sqft - $${comp.price.toLocaleString()} - ${comp.soldDate} (${comp.confidence})`);
              });
            } else {
              console.log(`   ❌ GEMINI: No comparables found, falling back to RapidAPI`);
            }
          } catch (error) {
            console.error(`   ❌ GEMINI ERROR: ${error.message}`);
          }
        }

        // RAPIDAPI FALLBACK: Only if Gemini found insufficient comps
        if (phaseOneComps.length < 3) {
          console.log(`   🔍 RAPIDAPI FALLBACK: Searching with RapidAPI...`);
          const rapidAPIComps = await this.searchWithFilters(centerLat, centerLon, radius, propertyTypeFilter, minSqft, maxSqft, finalYearBuilt, subjectProperty.property_id || '');
          
          // Add RapidAPI comps that aren't duplicates
          rapidAPIComps.forEach(rapidComp => {
            const isDuplicate = phaseOneComps.some(geminiComp => 
              geminiComp.address === rapidComp.address
            );
            if (!isDuplicate) {
              phaseOneComps.push({
                ...rapidComp,
                source: 'rapidapi'
              });
            }
          });
          
          console.log(`   📊 RAPIDAPI: Added ${rapidAPIComps.length} additional comparables`);
        }

        console.log(`\n📊 STEP 3A RESULTS:`);
        console.log(`   • Properties returned by API: ${phaseOneComps.length}`);

        // Update activity level based on search results
        if (phaseOneComps.length > 0) {
          const recentSales = phaseOneComps.filter(comp => {
            if (!comp.last_sold_date) return false;
            const soldDate = new Date(comp.last_sold_date);
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            return soldDate >= sixMonthsAgo;
          });
          
          const salesCount = recentSales.length;
          console.log(`   • Recent sales (6 months): ${salesCount}`);
          
          // Update activity level based on recent sales count
          if (salesCount >= 15) {
            activityLevel = { level: 'Very High', score: 9 };
            maxRadius = 2;
          } else if (salesCount >= 10) {
            activityLevel = { level: 'High', score: 8 };
            maxRadius = 2;
          } else if (salesCount >= 7) {
            activityLevel = { level: 'Medium-High', score: 7 };
            maxRadius = 3;
          } else if (salesCount >= 4) {
            activityLevel = { level: 'Medium', score: 6 };
            maxRadius = 3;
          } else if (salesCount >= 2) {
            activityLevel = { level: 'Low-Medium', score: 4 };
            maxRadius = 4;
          } else {
            activityLevel = { level: 'Low', score: 3 };
            maxRadius = 5;
          }
          
          console.log(`   • Updated activity level: ${activityLevel.level} (${activityLevel.score}/10)`);
          console.log(`   • Updated max radius: ${maxRadius} miles`);
        }

        // Analyze the quality of results
        const minYear = finalYearBuilt ? finalYearBuilt - 10 : 1980;
        const maxYear = finalYearBuilt ? finalYearBuilt + 10 : 2025;
        const sizeMatchCount = phaseOneComps.filter(comp => comp.sqft >= minSqft && comp.sqft <= maxSqft).length;
        let yearMatchCount = phaseOneComps.filter(comp => comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear).length;
        let perfectMatchCount = phaseOneComps.filter(comp => {
          const sizeMatch = comp.sqft >= minSqft && comp.sqft <= maxSqft;
          const yearMatch = comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear;
          return sizeMatch && yearMatch;
        }).length;

        console.log(`   • Size matches (${minSqft}-${maxSqft} sqft): ${sizeMatchCount}`);
        console.log(`   • Year matches (${minYear}-${maxYear}): ${yearMatchCount}`);
        console.log(`   • Perfect matches (size + year): ${perfectMatchCount}`);

        // Try to fill missing yearBuilt via RapidAPI detail before showing the detailed list
        if (finalYearBuilt && perfectMatchCount < 5) {
          const toLookup = Math.min(10, phaseOneComps.length);
          console.log(`\n🔧 YEAR COMPLETION: Attempting detail lookups for up to ${toLookup} comps missing yearBuilt...`);
          try {
            const filled = await this.fillMissingYearsForComps(
              phaseOneComps,
              toLookup,
              { minSqft, maxSqft, minYear, maxYear, targetPerfect: 5 }
            );
            if (filled > 0) {
              // Recompute counts after filling
              yearMatchCount = phaseOneComps.filter(comp => comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear).length;
              perfectMatchCount = phaseOneComps.filter(comp => {
                const sizeMatch = comp.sqft >= minSqft && comp.sqft <= maxSqft;
                const yearMatch = comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear;
                return sizeMatch && yearMatch;
              }).length;
              console.log(`   • Filled ${filled} missing yearBuilt via detail`);
              console.log(`   • Updated year matches: ${yearMatchCount}`);
              console.log(`   • Updated perfect matches: ${perfectMatchCount}/5`);
            }
          } catch {}
        }

        // Show data from external sources
        if (phaseOneComps.length > 0) {
          console.log(`\n📝 DETAILED PROPERTIES FROM API SEARCH:`);
          phaseOneComps.slice(0, 10).forEach((comp, i) => {
            const sizeFlag = comp.sqft >= minSqft && comp.sqft <= maxSqft ? '✅' : '❌';
            const yearFlag = comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear ? '✅' : (comp.yearBuilt ? '❌' : '❓');
            console.log(`   ${i+1}. ${comp.address}`);
            console.log(`      Size: ${comp.sqft || 'null'}sqft ${sizeFlag} | Year: ${comp.yearBuilt || 'null'} ${yearFlag} | Beds/Baths: ${comp.beds || 'null'}/${comp.baths || 'null'}`);
            console.log(`      Price: $${comp.price?.toLocaleString() || 'null'} | $/sqft: $${comp.pricePerSqft || 'null'} | Date: ${comp.soldDate || 'null'}`);
            console.log(`      Distance: ${comp.distance_miles ? comp.distance_miles.toFixed(2) + ' miles' : comp.searchRadius + ' miles'}`);
          });
          if (phaseOneComps.length > 5) {
            console.log(`   ... and ${phaseOneComps.length - 5} more properties`);
          }
        }

        // PHASE 2: Conditional null-value search
        let phaseTwoComps = [];
        if (perfectMatchCount < 5) {
          console.log(`\n🔍 STEP 3B: Null-Value Property Search (insufficient perfect matches: ${perfectMatchCount}/5)`);
          phaseTwoComps = await this.searchNullValueProperties(centerLat, centerLon, radius, propertyTypeFilter, subjectProperty.property_id || '');

          console.log(`\n📊 STEP 3B RESULTS:`);
          console.log(`   • Properties with missing data found: ${phaseTwoComps.length}`);

          // PHASE 3: Research enhancement (targeted & minimal)
          const neededEnhancements = Math.max(0, 5 - perfectMatchCount);
          // Only run Step 3C if even size matches are insufficient (<5). If size matches are already >=5,
          // we can skip web enhancement and let the later ARV confidence check handle any remaining gaps.
          if (phaseTwoComps.length > 0 && neededEnhancements > 0 && sizeMatchCount < 5) {
            console.log(`\n🔍 STEP 3C: Web Research Enhancement`);
            console.log(`   • Researching up to ${neededEnhancements} properties for missing data...`);
            const researchedComps = await this.researchNullValueProperties(phaseTwoComps.slice(0, neededEnhancements), minSqft, maxSqft, finalYearBuilt);

            console.log(`\n📊 STEP 3C RESULTS:`);
            console.log(`   • Properties successfully enhanced: ${researchedComps.length}`);

            // Update the original properties in phaseOneComps with enhanced data
            researchedComps.forEach(enhanced => {
              const originalIndex = phaseOneComps.findIndex(comp => comp.address === enhanced.address);
              if (originalIndex !== -1) {
                // Update the original property with enhanced data
                phaseOneComps[originalIndex] = { ...phaseOneComps[originalIndex], ...enhanced };
                console.log(`🔄 UPDATED: ${enhanced.address} with year built ${enhanced.yearBuilt}`);
              } else {
                // Add new enhanced property if not found
                phaseOneComps.push(enhanced);
                console.log(`➕ ADDED: ${enhanced.address} with year built ${enhanced.yearBuilt}`);
              }
            });
          }
        } else {
          console.log(`\n✅ STEP 3B SKIPPED: Sufficient perfect matches found (${perfectMatchCount}/5)`);
        }

        console.log(`\n🎯 STEP 3D: Final Filtering and Deduplication`);
        console.log(`   • Applying strict size/price filters...`);
        console.log(`   • Removing duplicates from previous radius searches...`);

        // Apply strict filtering before combining results
        console.log(`\n🔍 DEBUGGING ENHANCED PROPERTIES IN phaseOneComps:`);
        phaseOneComps.slice(0, 5).forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address} - Year: ${comp.yearBuilt || 'null'} - Enhanced: ${comp.researched ? 'YES' : 'NO'}`);
        });

        const strictlyFilteredComps = phaseOneComps.filter(comp => {
          const sizeMatch = comp.sqft && comp.sqft >= minSqft && comp.sqft <= maxSqft;
          const hasPrice = comp.price && comp.price > 10000;
          const hasPricePerSqft = comp.pricePerSqft && comp.pricePerSqft >= 50 && comp.pricePerSqft <= 300;
          return sizeMatch && hasPrice && hasPricePerSqft;
        });

        const beforeCount = finalValidComps.length;

        // Only add unique comparables (avoid duplicates from overlapping searches)
        let newCompsAdded = 0;
        strictlyFilteredComps.forEach(newComp => {
          const isDuplicate = finalValidComps.some(existingComp => 
            existingComp.address === newComp.address
          );
          if (!isDuplicate) {
            finalValidComps.push(newComp);
            newCompsAdded++;
          }
        });

        finalResearchCandidates.push(...phaseTwoComps);

        console.log(`\n🔍 DEBUGGING FINAL VALID COMPS:`);
        finalValidComps.slice(0, 5).forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address} - Year: ${comp.yearBuilt || 'null'} - Enhanced: ${comp.researched ? 'YES' : 'NO'}`);
        });

        // Count category coverage
        const baselineCount = finalValidComps.filter(isBaselineEligible).length;
        const twoBathCount = finalValidComps.filter(isTwoBathEligible).length;

        console.log(`\n📊 STEP 3D RESULTS:`);
        console.log(`   • Properties after strict filtering: ${strictlyFilteredComps.length}`);
        console.log(`   • New unique properties added: ${newCompsAdded}`);
        console.log(`   • Duplicates rejected: ${strictlyFilteredComps.length - newCompsAdded}`);
        console.log(`   • Total accumulated comparables: ${finalValidComps.length} (was ${beforeCount})`);
        console.log(`   • Baseline-eligible comps: ${baselineCount}/${baselineTarget}`);
        if (dualNeeded) console.log(`   • Two-bath comps: ${twoBathCount}/${twoBathTarget}`);

        // If targets not met, progressively expand constraints within this radius
        if (baselineCount < baselineTarget || (dualNeeded && twoBathCount < twoBathTarget)) {
          // Helper to add comps uniquely after filtering by size/price bounds
          const addFiltered = (comps: any[], min: number, max: number) => {
            let added = 0;
            comps.forEach((c) => {
              const sizeOk = c?.sqft && c.sqft >= min && c.sqft <= max;
              const priceOk = c?.pricePerSqft && c.pricePerSqft >= 50 && c.pricePerSqft <= 300 && c?.price && c.price > 10000;
              if (!sizeOk || !priceOk) return;
              const dup = finalValidComps.some((e) => e.address === c.address);
              if (!dup) { finalValidComps.push(c); added++; }
            });
            return added;
          };

          // 1) Expand sales window based on activity level
          const timeWindow = activityLevel.score >= 6 ? 6 : activityLevel.score >= 4 ? 12 : 18;
          try {
            console.log(`   ↪️ EXPAND: Trying ${timeWindow}-month sales window at radius ${radius} ...`);
            const compsExpanded = await this.searchWithFilters(centerLat, centerLon, radius, propertyTypeFilter, minSqft, maxSqft, finalYearBuilt, subjectProperty.property_id || '', timeWindow);
            const before = finalValidComps.length;
            addFiltered(compsExpanded, minSqft, maxSqft);
            const after = finalValidComps.length;
            console.log(`      +${after - before} comps added from ${timeWindow}-month window`);
          } catch {}

          // Recount after time window expansion
          let bCount = finalValidComps.filter(isBaselineEligible).length;
          let tCount = finalValidComps.filter(isTwoBathEligible).length;
          console.log(`      Coverage after ${timeWindow}m: baseline=${bCount}/${baselineTarget}${dualNeeded ? `, two-bath=${tCount}/${twoBathTarget}` : ''}`);

          // Size band remains max ±20% per requirement (no widening)

          // Drop year filter and retry with expanded time window
          if (bCount < baselineTarget || (dualNeeded && tCount < twoBathTarget)) {
            try {
              console.log(`   ↪️ EXPAND: Drop year filter and retry ${timeWindow}-month search`);
              const compsNoYear = await this.searchWithFilters(centerLat, centerLon, radius, propertyTypeFilter, minSqft, maxSqft, null, subjectProperty.property_id || '', timeWindow);
              const before = finalValidComps.length;
              addFiltered(compsNoYear, minSqft, maxSqft);
              const after = finalValidComps.length;
              console.log(`      +${after - before} comps added after dropping year filter`);
            } catch {}

            bCount = finalValidComps.filter(isBaselineEligible).length;
            tCount = finalValidComps.filter(isTwoBathEligible).length;
            console.log(`      Coverage after no-year: baseline=${bCount}/${baselineTarget}${dualNeeded ? `, two-bath=${tCount}/${twoBathTarget}` : ''}`);
          }

          // Note: Gemini search is now handled in the primary search phase above
        }

        console.log(`\n🚦 DECISION POINT: Continue or Stop?`);

        // User preference: Stop at 1-2 miles when sufficient comparables found
        if (baselineCount >= baselineTarget && (!dualNeeded || twoBathCount >= twoBathTarget)) {
          console.log(`   ✅ STOPPING: Targets met (baseline=${baselineCount}/${baselineTarget}${dualNeeded ? `, two-bath=${twoBathCount}/${twoBathTarget}` : ''}) at ${radius} mile radius`);
          break;
        } else if (baselineCount >= 3 && radius >= 2) {
          console.log(`   ✅ STOPPING: Found ${finalValidComps.length} comparables within preferred 2-mile boundary`);
          break;
        } else if (radius >= maxRadius) {
          console.log(`   ✅ STOPPING: Reached maximum search radius (${radius}/${maxRadius}) with baseline=${baselineCount}, two-bath=${twoBathCount}`);
          break;
        } else {
          // FAST MODE: Early break if we have 5+ qualified comps (regardless of other criteria)
          if (finalValidComps.length >= 5) {
            console.log(`   ⚡ FAST MODE: Found ${finalValidComps.length} qualified comparables - stopping early`);
            break;
          }
          console.log(`   📈 CONTINUING: Only ${finalValidComps.length} comparables found, expanding to ${radius + 1} miles...`);
          radius++;
          continue;
        }
      }

      // Update final results variables to use the new methodology results
      const validComps = finalValidComps;
      const researchCandidates = finalResearchCandidates;

      console.log(`\n=== ENHANCED METHODOLOGY RESULTS ===`);
      console.log(`Subject: ${normalizedAddress} - ${finalSubjectSqft} sqft ${finalPropertyType}`);
      console.log(`Valid comparables: ${validComps.length}`);
      console.log(`Research candidates: ${researchCandidates.length}`);
      console.log(`Search radius: ${radius} miles`);

      // Show final comparable summary
      console.log(`\n🔍 FINAL COMPARABLE SUMMARY:`);
      validComps.forEach((comp, i) => {
        const sizeStatus = comp.sqft && comp.sqft >= minSqft && comp.sqft <= maxSqft ? '✓' : '✗';
        const yearStatus = comp.yearBuilt && comp.yearBuilt >= (finalYearBuilt ? finalYearBuilt - 10 : 1980) && comp.yearBuilt <= (finalYearBuilt ? finalYearBuilt + 10 : 2025) ? '✓' : '✗';
        const researchFlag = comp.researched ? ' [RESEARCHED]' : '';
        console.log(`${i+1}. ${comp.address} - ${comp.sqft || 'null'}sqft (${sizeStatus}) - ${comp.yearBuilt || 'null'} built (${yearStatus}) - $${comp.pricePerSqft || 'null'}/sqft${researchFlag}`);
      });

      // GEMINI FALLBACK: If insufficient comparables, try Gemini search
      if (validComps.length < 3) {
        console.log(`\n🔍 GEMINI FALLBACK: Only ${validComps.length} comparables found, searching with Gemini...`);
        
        try {
          if (this.geminiSearcher) {
            const geminiComps = await this.geminiSearcher.searchComparables(
              normalizedAddress,
              centerLat,
              centerLon,
              Math.min(radius, 3), // Use current radius or max 3 miles
              10 // Max 10 additional comparables
            );

            if (geminiComps.length > 0) {
              console.log(`   ✅ GEMINI FALLBACK: Found ${geminiComps.length} additional comparables`);
              
               // Convert Gemini results to our format
               const convertedComps = geminiComps.map(comp => ({
               address: comp.address,
               sqft: comp.sqft,
               price: comp.price,
               pricePerSqft: Math.round(comp.price / comp.sqft),
               beds: comp.beds,
               baths: comp.baths,
               yearBuilt: comp.yearBuilt,
               last_sold_date: comp.soldDate,
               distance_miles: comp.distance, // Use distance_miles to match RapidAPI format
               source: 'gemini',
               confidence: comp.confidence,
               researched: false
             }));

            // Add to valid comps
            validComps.push(...convertedComps);
            
            console.log(`   📊 Total comparables after Gemini fallback: ${validComps.length}`);
            
              // Show Gemini results
              geminiComps.forEach((comp, i) => {
                console.log(`   ${i+1}. ${comp.address} - ${comp.sqft}sqft - $${comp.price.toLocaleString()} - ${comp.soldDate} (${comp.confidence})`);
              });
            } else {
              console.log(`   ❌ GEMINI FALLBACK: No additional comparables found`);
            }
          } else {
            console.log(`   ⚠️ GEMINI FALLBACK: Not available, skipping`);
          }
        } catch (error) {
          console.error(`   ❌ GEMINI FALLBACK ERROR: ${error.message}`);
        }
      }

      if (validComps.length < 3) {
        throw new Error(`Insufficient comparables found (${validComps.length} < 3 minimum). Consider expanding search criteria.`);
      }

      // Step 5: Calculate ARV using the new methodology
      const arvData = await this.calculateNewMethodologyARV(
        validComps,
        finalSubjectSqft,
        normalizedAddress,
        subjectProperty,
        researchCandidates,
        centerLat,
        centerLon,
        finalYearBuilt
      );

      console.log(`✅ NEW METHODOLOGY SUCCESS: ARV ${arvData.arv} with ${arvData.confidence} confidence`);

      // Save and return the analysis
      const analysis = await this.createPropertyAnalysis(arvData);
      return analysis;

    } catch (error: any) {
      console.error('Error analyzing property:', error);

      // Enhanced error handling with specific scenarios
      if (error.message && (error.message.includes('Property data unavailable') || error.message.includes('Property not found'))) {
        // This is already a user-friendly error, pass it through
        throw error;
      } else if (error.message && error.message.includes('RapidAPI')) {
        throw new Error('Property analysis service temporarily unavailable. Please try again in a few minutes.');
      } else if (error.message && error.message.includes('comparable') && error.message.includes('found')) {
        throw new Error('Insufficient comparable sales data found for this property. This may indicate a unique property or limited recent sales activity in the area.');
      } else {
        // Generic fallback for unexpected errors
        throw new Error('Property analysis failed due to a technical issue. Please try again or contact support if the problem persists.');
      }
    }
  }

  // HELPER METHODS FOR ENHANCED CONDITIONAL METHODOLOGY

  private async getCoordinatesFromAddress(address: string, apiKey: string): Promise<{lat: number, lon: number}> {
    // Use Google Maps API for accurate coordinates instead of broken RapidAPI autocomplete
    const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsKey) {
      throw new Error('Google Maps API key not found');
    }

    console.log(`📍 COORDINATE LOOKUP: Using Google Maps for ${address}`);

    // Cache lookup (6 hours TTL)
    const now = Date.now();
    const key = address.toLowerCase().trim();
    const cached = geocodeCache.get(key);
    if (cached && now - cached.ts < 6 * 60 * 60 * 1000) {
      console.log('📍 Using cached coordinates');
      return { lat: cached.lat, lon: cached.lon };
    }

    // Add a timeout for external call
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const mapsResponse = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleMapsKey}`, { signal: controller.signal } as any);
    clearTimeout(timeout);

    if (!mapsResponse.ok) {
      throw new Error(`Google Maps API failed: ${mapsResponse.status}`);
    }

    const mapsData = await mapsResponse.json();

    if (!mapsData.results || mapsData.results.length === 0) {
      throw new Error('No location found for the provided address');
    }

    const location = mapsData.results[0].geometry.location;
    const lat = location.lat;
    const lon = location.lng;

    console.log(`📍 COORDINATES FOUND: ${lat}, ${lon}`);
    console.log(`📍 FORMATTED ADDRESS: ${mapsData.results[0].formatted_address}`);

    geocodeCache.set(key, { lat, lon, ts: now });

    return { lat, lon };
  }

  private async findSubjectProperty(address: string, centerLat: number, centerLon: number, apiKey: string): Promise<any> {
    console.log(`🏠 SUBJECT PROPERTY SEARCH: Looking for ${address} at ${centerLat}, ${centerLon}`);

    const smallBoundarySize = 0.003; // Slightly larger boundary for better property discovery
    const searchBoundary = [
      [centerLon - smallBoundarySize, centerLat - smallBoundarySize],
      [centerLon + smallBoundarySize, centerLat - smallBoundarySize],
      [centerLon + smallBoundarySize, centerLat + smallBoundarySize],
      [centerLon - smallBoundarySize, centerLat + smallBoundarySize],
      [centerLon - smallBoundarySize, centerLat - smallBoundarySize]
    ];

    const searchPayload = {
      limit: 100,
      offset: 0,
      boundary: { coordinates: [searchBoundary] },
      status: ["for_sale", "sold", "off_market"],
      type: ["single_family", "townhome", "condo"]
    };

    const searchResponse = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      body: JSON.stringify(searchPayload)
    });

    if (!searchResponse.ok) {
      throw new Error(`Subject property search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const properties = searchData?.data?.home_search?.results || [];

    console.log(`🏠 FOUND ${properties.length} properties in search area`);

    // Extract house number and street from the input address for better matching
    const addressOnly = address.split(',')[0] || address; // take street part before first comma
    const normStreet = addressOnly.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const tokens = normStreet.split(/\s+/);
    const houseNumber = tokens[0] || '';
    const streetName = tokens.slice(1).join(' ');

    console.log(`🏠 LOOKING FOR: House #${houseNumber} on ${streetName}`);

    // Prefer exact house number and shortest distance to geocode point
    const withDistances = properties.map((p: any) => {
      const plat = p.location?.address?.coordinate?.lat;
      const plon = p.location?.address?.coordinate?.lon;
      let dist = Number.POSITIVE_INFINITY;
      if (typeof plat === 'number' && typeof plon === 'number') {
        const dlat = (plat - centerLat) * Math.PI / 180;
        const dlon = (plon - centerLon) * Math.PI / 180;
        const a = Math.sin(dlat/2)**2 + Math.cos(centerLat*Math.PI/180)*Math.cos(plat*Math.PI/180)*Math.sin(dlon/2)**2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const R = 3958.8; // miles
        dist = R * c;
      }
      const line = (p.location?.address?.line || '').toLowerCase().replace(/[^\w\s]/g, ' ').trim();
      const pTokens = line.split(/\s+/);
      const pNum = pTokens[0] || '';
      const sameNumber = pNum === houseNumber;
      const exactMatch = line.includes(address.toLowerCase().replace(/[^\w\s]/g, ' ').trim());
      console.log(`   🔍 Property Search Debug: "${line}" | Number: ${pNum} | Same: ${sameNumber} | Exact: ${exactMatch} | Dist: ${dist.toFixed(2)}`);
      return { p, dist, sameNumber, exactMatch, line };
    });

    const candidates = withDistances
      .filter(x => x.sameNumber)
      .sort((a, b) => a.dist - b.dist);

    if (candidates.length && candidates[0].dist <= 0.5) { // within ~0.5 miles
      const hit = candidates[0].p;
      console.log(`✅ SUBJECT VIA NUMBER+DIST: ${hit.location?.address?.line} (${candidates[0].dist.toFixed(2)} mi)`);
      // If sqft missing, try detail lookup
      if (!hit.description?.sqft && hit.property_id) {
        const detailed = await this.fetchDetailById(hit.property_id);
        if (detailed?.description?.sqft) {
          hit.description.sqft = detailed.description.sqft;
        }
      }
      return hit;
    }

    console.log(`⚠️ EXACT MATCH NOT FOUND, showing nearby properties:`);
    properties.slice(0, 5).forEach((prop, i) => {
      console.log(`${i+1}. ${prop.location?.address?.line || 'Unknown'}`);
    });

    // If not found, try autocomplete -> detail fallback
    const fallback = await this.findByAutocomplete(address);
    if (fallback) {
      console.log(`✅ SUBJECT VIA AUTOCOMPLETE: ${fallback.location?.address?.line}`);
      return fallback;
    }

    // If still not found, return null instead of wrong property
    return null;
  }

  private async fetchDetailById(propertyId: string): Promise<any | null> {
    try {
      const resp = await loggedFetch(`https://realty-in-us.p.rapidapi.com/properties/v3/detail?property_id=${encodeURIComponent(propertyId)}`, {
        method: 'GET'
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const home = data?.data?.home;
      if (!home) return null;
      return home;
    } catch {
      return null;
    }
  }

  private async findByAutocomplete(address: string): Promise<any | null> {
    try {
      // Prefer v2 autocomplete which returns mpr_id for addresses
      const v2 = `https://realty-in-us.p.rapidapi.com/locations/v2/auto-complete?input=${encodeURIComponent(address)}&limit=10`;
      let resp = await loggedFetch(v2, { method: 'GET' });
      if (resp.ok) {
        const data = await resp.json();
        const items: any[] = Array.isArray(data?.autocomplete) ? data.autocomplete : [];
        const addr = items.find(x => x?.area_type === 'address');
        if (addr) {
          const propertyId = addr?.mpr_id || addr?.property_id || null;
          if (propertyId) {
            const home = await this.fetchDetailById(propertyId);
            if (home) return this.adaptHomeToProperty(home);
          }
          const lat = addr?.centroid?.lat;
          const lon = addr?.centroid?.lon;
          if (typeof lat === 'number' && typeof lon === 'number') {
            const small = 0.0015;
            const boundary = [
              [lon - small, lat - small],
              [lon + small, lat - small],
              [lon + small, lat + small],
              [lon - small, lat + small],
              [lon - small, lat - small]
            ];
            const searchResp = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
              method: 'POST',
              body: JSON.stringify({ limit: 50, offset: 0, boundary: { coordinates: [boundary] }, status: ["for_sale","sold","off_market"], type: ["single_family","townhome","condo"] })
            });
            if (searchResp.ok) {
              const sd = await searchResp.json();
              const props = sd?.data?.home_search?.results || [];
              const houseNum = (address.split(',')[0] || address).trim().split(/\s+/)[0];
              const sameNum = props.filter((p: any) => String(p.location?.address?.line || '').trim().startsWith(houseNum + ' '));
              const picked = sameNum[0] || props[0];
              if (picked?.property_id) {
                const home = await this.fetchDetailById(picked.property_id);
                if (home) return this.adaptHomeToProperty(home);
              }
            }
          }
        }
      }
      // Fallback to legacy autocomplete if v2 fails or no address entry
      const v1 = `https://realty-in-us.p.rapidapi.com/locations/auto-complete?input=${encodeURIComponent(address)}`;
      resp = await loggedFetch(v1, { method: 'GET' });
      if (!resp.ok) return null;
      const data1 = await resp.json();
      const suggestions: any[] = data1?.autocomplete?.terms || data1?.data || data1?.suggestions || [];
      if (!Array.isArray(suggestions) || !suggestions.length) return null;
      const best = suggestions.find((s: any) => s?.property_id || s?.propertyId) || suggestions[0];
      const pid = best?.property_id || best?.propertyId || null;
      if (pid) {
        const home = await this.fetchDetailById(pid);
        if (home) return this.adaptHomeToProperty(home);
      }
      return null;
    } catch {
      return null;
    }
  }

  private adaptHomeToProperty(home: any): any {
    return {
      property_id: home?.property_id,
      listing_id: home?.listing_id,
      description: {
        beds: home?.description?.beds ?? null,
        baths: home?.description?.baths ?? null,
        sqft: home?.description?.sqft ?? null,
        type: home?.description?.type ?? null,
        year_built: home?.description?.year_built ?? null,
      },
      location: {
        address: {
          line: home?.location?.address?.line ?? null,
          coordinate: {
            lat: home?.location?.address?.coordinate?.lat ?? null,
            lon: home?.location?.address?.coordinate?.lon ?? null,
          }
        }
      },
      last_sold_price: home?.last_sold_price ?? null,
      last_sold_date: home?.last_sold_date ?? null,
    };
  }

  private async researchPropertyData(address: string): Promise<{yearBuilt?: number, sqft?: number, beds?: number, baths?: number, propertyType?: string} | null> {
    try {
      console.log(`📋 WEB RESEARCH: Attempting to research ${address}`);

      const searchQuery = `${address} property details year built square feet bedrooms bathrooms`;
      console.log(`🌐 SEARCHING WEB: ${searchQuery}`);
      console.log(`🔍 DEBUG: About to call this.webSearch()...`);

      const searchResult = await this.webSearch(searchQuery);

      if (searchResult && searchResult.length > 0) {
        // Try to parse any embedded JSON payloads first (from provider-assisted results)
        for (const item of searchResult) {
          const candidates = [item?.description, item?.content, item?.snippet, item?.title]
            .filter(Boolean) as string[];
          for (const text of candidates) {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
              const jsonLike = text.slice(start, end + 1);
              try {
                const parsed = JSON.parse(jsonLike);
                const norm: any = {};
                const lowerKeys = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k).toLowerCase(), v]));
                if (Number.isFinite(Number(lowerKeys['sqft']))) norm.sqft = Number(lowerKeys['sqft']);
                if (Number.isFinite(Number(lowerKeys['beds']))) norm.beds = Number(lowerKeys['beds']);
                if (Number.isFinite(Number(lowerKeys['baths']))) norm.baths = Number(lowerKeys['baths']);
                if (Number.isFinite(Number(lowerKeys['yearbuilt']))) norm.yearBuilt = Number(lowerKeys['yearbuilt']);
                if (!isNaN(norm.baths) && norm.baths > 0) {
                  console.log(`✅ WEB JSON PARSE: Beds: ${norm.beds ?? 'N/A'}, Baths: ${norm.baths}, SqFt: ${norm.sqft ?? 'N/A'}, Year: ${norm.yearBuilt ?? 'N/A'}`);
                  return norm;
                }
              } catch {}
            }
          }
        }

        console.log(`✅ WEB SEARCH: Processing ${searchResult.length} search results for ${address.split(',')[0]}`);

        // Combine search results into a comprehensive text block for analysis
        const searchText = searchResult.map(result => {
          const combinedText = [
            result.title || '',
            result.description || '',
            result.content || '',
            result.snippet || ''
          ].filter(Boolean).join(' ');
          return combinedText;
        }).join(' ').toLowerCase();

        console.log(`🌐 ANALYZING SEARCH CONTENT: ${searchText.substring(0, 200)}...`);

        const data: any = {};

        // Extract year built with multiple pattern matching
        const yearPatterns = [
          /(?:built|year built|constructed)[\s:]*(\d{4})/i,
          /(\d{4})\s*built/i,
          /built\s*in\s*(\d{4})/i,
          /year[\s:]*(\d{4})/i,
          /built[\s:]*in[\s:]*(\d{4})/i,  // "built in 1990" format
          /constructed[\s:]*in[\s:]*(\d{4})/i, // "constructed in 1990"
          /from[\s:]*(\d{4})/i,           // "from 1990" format
          /circa[\s:]*(\d{4})/i,          // "circa 1990" format
          /age[\s:]*(\d{4})/i             // "age 1990" format
        ];

        for (const pattern of yearPatterns) {
          const yearMatch = searchText.match(pattern);
          if (yearMatch) {
            const year = parseInt(yearMatch[1]);
            if (year >= 1800 && year <= 2025) {
              data.yearBuilt = year;
              console.log(`🌐 EXTRACTED YEAR BUILT: ${data.yearBuilt}`);
              break;
            }
          }
        }

        // Extract square footage: collect all candidates and pick the most plausible
        const labelledSqftPatterns = [
          /living\s+area[:\s]*([\d,]{3,6})/ig,
          /square\s+feet[:\s]*([\d,]{3,6})/ig
        ];
        const genericSqftPatterns = [
          /([\d,]{3,6})\s*sq\s*ft/ig,
          /([\d,]{3,6})\s*(?:sq|square)\s*(?:ft|feet|foot)/ig,
          /([\d,]{3,6})\s*sqft/ig,
          /square\s*feet[\s:]*(\d{3,6})/ig,
          /([\d,]{3,6})\s+square/ig,
          /([\d,]{3,6})\s+square\s+feet/ig
        ];

        const collectMatches = (patterns: RegExp[]): number[] => {
          const out: number[] = [];
          for (const base of patterns) {
            const re = new RegExp(base.source, base.flags.includes('g') ? base.flags : base.flags + 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(searchText)) !== null) {
              const n = parseInt((m[1] || '').replace(/,/g, ''));
              if (Number.isFinite(n)) out.push(n);
            }
          }
          return out;
        };

        const plausible = (n: number) => n >= 600 && n <= 10000;
        const labelledCandidates = collectMatches(labelledSqftPatterns).filter(plausible);
        const genericCandidates = collectMatches(genericSqftPatterns).filter(plausible);

        let chosenSqft: number | undefined;
        if (labelledCandidates.length) {
          // Prefer the largest labelled value (avoids small room/garage figures)
          chosenSqft = Math.max(...labelledCandidates);
        } else if (genericCandidates.length) {
          // Fall back to the largest plausible generic value
          chosenSqft = Math.max(...genericCandidates);
        }

        if (chosenSqft) {
          data.sqft = chosenSqft;
          console.log(`🌐 EXTRACTED SQUARE FEET (robust): ${data.sqft}`);
        }

        // Extract bedrooms with comprehensive pattern matching
        const bedsPatterns = [
          /(\d+)\s*(?:bed|bedroom|br)/i,
          /bedrooms?[\s:]*(\d+)/i,
          /(\d+)\s+bedrooms?/i  // Added for "4 bedrooms" format
        ];

        for (const pattern of bedsPatterns) {
          const bedsMatch = searchText.match(pattern);
          if (bedsMatch) {
            const beds = parseInt(bedsMatch[1]);
            if (beds >= 1 && beds <= 10) {
              data.beds = beds;
              console.log(`🌐 EXTRACTED BEDROOMS: ${data.beds}`);
              break;
            }
          }
        }

        // Extract bathrooms with decimal support for half baths
        const bathsPatterns = [
          /(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)/i,
          /bathrooms?[\s:]*(\d+(?:\.\d+)?)/i,
          /(\d+)\s*full.*(\d+)\s*half/i, // "2 full 1 half bath" format
          /(\d+)\s+bathrooms?/i  // Added for "2 bathrooms" format
        ];

        for (const pattern of bathsPatterns) {
          const bathsMatch = searchText.match(pattern);
          if (bathsMatch) {
            let baths;
            if (pattern.source.includes('full.*half')) {
              // Handle "2 full 1 half" format
              const full = parseInt(bathsMatch[1]);
              const half = parseInt(bathsMatch[2]);
              baths = full + (half * 0.5);
            } else {
              baths = parseFloat(bathsMatch[1]);
            }
            if (baths >= 1 && baths <= 10) {
              data.baths = baths;
              console.log(`🌐 EXTRACTED BATHROOMS: ${data.baths}`);
              break;
            }
          }
        }

        // Extract property type with comprehensive matching
        if (searchText.includes('townhome') || searchText.includes('townhouse') || searchText.includes('town home')) {
          data.propertyType = 'townhome';
          console.log(`🌐 EXTRACTED PROPERTY TYPE: ${data.propertyType}`);
        } else if (searchText.includes('condo') || searchText.includes('condominium')) {
          data.propertyType = 'condo';
          console.log(`🌐 EXTRACTED PROPERTY TYPE: ${data.propertyType}`);
        } else if (searchText.includes('single family') || searchText.includes('house')) {
          data.propertyType = 'single_family';
          console.log(`🌐 EXTRACTED PROPERTY TYPE: ${data.propertyType}`);
        }

        console.log(`✅ WEB RESEARCH SUCCESS: Year: ${data.yearBuilt || 'N/A'}, SqFt: ${data.sqft || 'N/A'}, Beds: ${data.beds || 'N/A'}, Baths: ${data.baths || 'N/A'}, Type: ${data.propertyType || 'N/A'}`);

        return Object.keys(data).length > 0 ? data : null;
      }

      console.log(`❌ WEB RESEARCH FAILED: No search results for ${address}`);
      return null;
    } catch (error) {
      console.log(`❌ WEB RESEARCH ERROR: ${error}`);
      return null;
    }
  }

  private async webSearch(query: string): Promise<any[] | null> {
    try {
      console.log(`🔍 WEB SEARCH: ${query}`);
      // Use internal web search service (external API integration required)
      // Try detailed lookup first, adapt to expected shape if present
      const details = await webSearch.forPropertyDetails(query);
      if (details) {
        return [
          {
            title: 'Property details (web search) ',
            description: JSON.stringify(details),
            content: ''
          }
        ];
      }
      return null;

    } catch (error) {
      console.log(`❌ Web search failed: ${error}`);
      return null;
    }
  }

  // Fill missing yearBuilt for a limited number of comparables using RapidAPI detail
  // Returns the count of filled yearBuilt values. Optionally early-stops when enough
  // perfect matches (size + year) are reached per the provided bounds.
  private async fillMissingYearsForComps(
    comps: any[],
    maxLookups: number = 10,
    earlyStop?: { minSqft: number; maxSqft: number; minYear: number; maxYear: number; targetPerfect: number }
  ): Promise<number> {
    let filled = 0;
    const candidates = comps.filter(comp => (!comp.yearBuilt || comp.yearBuilt === null) && comp.property_id);
    
    // FAST MODE: Process with concurrency control
    const detailPromises = candidates.slice(0, maxLookups).map(comp =>
      this.detailLimiter.execute(async () => {
        try {
          const det = await withTimeout(
            this.fetchDetailById(String(comp.property_id)),
            8000 // 8 second timeout
          );
          const y = det?.description?.year_built;
          if (typeof y === 'number' && y > 1600 && y < 2100) {
            comp.yearBuilt = y;
            if (!isLeanMode()) {
              console.log(`🔄 FILLED year built for ${comp.address} via detail: ${y}`);
            }
            return true;
          }
          return false;
        } catch (error) {
          if (!isLeanMode()) {
            console.log(`⚠️ Detail lookup failed for ${comp.address}: ${error}`);
          }
          return false;
        }
      })
    );

    const results = await Promise.all(detailPromises);
    filled = results.filter(Boolean).length;

    // Check early stop condition
    if (earlyStop) {
      const perfectNow = comps.filter(c => {
        const sizeOk = c.sqft >= earlyStop.minSqft && c.sqft <= earlyStop.maxSqft;
        const yearOk = typeof c.yearBuilt === 'number' && c.yearBuilt >= earlyStop.minYear && c.yearBuilt <= earlyStop.maxYear;
        return sizeOk && yearOk;
      }).length;
      if (perfectNow >= earlyStop.targetPerfect && !isLeanMode()) {
        console.log(`✅ EARLY STOP: Reached ${perfectNow}/${earlyStop.targetPerfect} perfect matches`);
      }
    }

    return filled;
  }

  // Fill missing baths for comps using RapidAPI detail (prefer consolidated)
  private async fillMissingBathsForComps(comps: any[], maxLookups: number = 10): Promise<number> {
    const candidates = comps.filter(comp => {
      const hasBaths = Number.isFinite(parseFloat(comp?.baths?.toString() || 'NaN'));
      return !hasBaths && comp?.property_id;
    });
    
    // FAST MODE: Process with concurrency control
    const detailPromises = candidates.slice(0, maxLookups).map(comp =>
      this.detailLimiter.execute(async () => {
        try {
          const det = await withTimeout(
            this.fetchDetailById(String(comp.property_id)),
            8000 // 8 second timeout
          );
          const desc: any = det?.description || {};
          const cons = typeof desc?.baths_consolidated === 'string' ? parseFloat(desc.baths_consolidated) : (typeof desc?.baths_consolidated === 'number' ? desc.baths_consolidated : undefined);
          const bathsVal = Number.isFinite(cons) ? (cons as number) : (Number.isFinite(Number(desc?.baths)) ? Number(desc.baths) : undefined);
          if (Number.isFinite(bathsVal)) {
            comp.baths = bathsVal;
            if (!isLeanMode()) {
              console.log(`🔄 FILLED baths for ${comp.address} via detail: ${bathsVal}`);
            }
            return true;
          }
          return false;
        } catch (error) {
          if (!isLeanMode()) {
            console.log(`⚠️ Detail lookup failed for ${comp.address}: ${error}`);
          }
          return false;
        }
      })
    );

    const results = await Promise.all(detailPromises);
    return results.filter(Boolean).length;
  }

  private async searchWithFilters(
    centerLat: number, 
    centerLon: number, 
    radius: number, 
    propertyTypes: string[], 
    minSqft: number, 
    maxSqft: number, 
    yearBuilt: number | null,
    excludePropertyId: string,
    salesMonthsFilter: number = 6  // Default 6 months, can be extended to 12 for low confidence
  ): Promise<any[]> {
    const radiusInDegrees = radius * 0.0145;
    const searchBoundary = [
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
    ];

    const searchPayload: any = {
      limit: 400,
      offset: 0,
      boundary: { coordinates: [searchBoundary] },
      status: ["sold"],
      type: propertyTypes
      // Removed sqft_min/sqft_max - API filters are broken, filter client-side instead
    };

    console.log(`🔍 API SEARCH PAYLOAD:`);
    console.log(`   • Property types requested: ${JSON.stringify(propertyTypes)}`);
    console.log(`   • Size range: ${minSqft}-${maxSqft} sqft`);
    console.log(`   • Status: sold only`);

    // Add year built filter if available
    if (yearBuilt) {
      searchPayload.year_built_min = yearBuilt - 10;
      searchPayload.year_built_max = yearBuilt + 10;
    }

    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error('RAPIDAPI_KEY environment variable is required');
    }

    const searchResponse = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      body: JSON.stringify(searchPayload)
    });

    if (!searchResponse.ok) {
      console.log(`❌ Filtered search failed: ${searchResponse.status}`);
      return [];
    }

    const searchData = await searchResponse.json();
    const foundProperties = searchData?.data?.home_search?.results || [];
    console.log(`\n📊 RAW API RESPONSE:`);
    console.log(`   • Total properties returned: ${foundProperties.length}`);

    // Show first few properties and their types
    if (foundProperties.length > 0) {
      console.log(`\n📝 FIRST 10 PROPERTIES FROM API (showing property types):`);
      foundProperties.slice(0, 10).forEach((prop: any, i: number) => {
        const address = prop.location?.address?.line || 'Unknown Address';
        const propType = prop.description?.type || 'Unknown Type';
        const beds = prop.description?.beds || 'null';
        const baths = prop.description?.baths || 'null';
        const sqft = prop.description?.sqft || 'null';
        const price = prop.last_sold_price || 'null';
        console.log(`   ${i+1}. ${address}`);
        console.log(`      Type: ${propType} | Beds/Baths: ${beds}/${baths} | Size: ${sqft}sqft | Price: $${price}`);
      });
    }

    // Process and filter properties with dynamic sales restriction (6 or 12 months based on confidence)
    const salesFilterDate = new Date(Date.now() - (salesMonthsFilter * 30 * 24 * 60 * 60 * 1000));
    const validComps: any[] = [];

    console.log(`\n🔍 FILTERING PROCESS (${salesMonthsFilter}-month sales filter):`);
    console.log(`   • Sales cutoff date: ${salesFilterDate.toISOString().split('T')[0]}`);
    foundProperties.forEach((prop: any, index: number) => {
      const sqft = prop.description?.sqft;
      const price = prop.last_sold_price;
      const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
      const address = prop.location?.address?.line || 'Unknown';
      const propType = prop.description?.type || 'Unknown';
      const lat = prop.location?.address?.coordinate?.lat;
      const lon = prop.location?.address?.coordinate?.lon;

      console.log(`   ${index + 1}. ${address} - Type: ${propType}`);
      console.log(`      Price: $${price || 'null'} | Size: ${sqft || 'null'}sqft | Date: ${soldDate ? soldDate.toISOString().split('T')[0] : 'null'}`);

      // CRITICAL: Exclude subject property from comparables
      const excludeAddr = excludePropertyId.toLowerCase().trim();
      const currentAddr = address.toLowerCase().trim();

      console.log(`      🔍 SUBJECT EXCLUSION CHECK: "${currentAddr}" vs "${excludeAddr}"`);

      // Check if this is the same property (multiple ways to match)
      if (currentAddr.includes(excludeAddr.split(',')[0]) || 
          excludeAddr.includes(currentAddr.split(',')[0]) ||
          currentAddr === excludeAddr) {
        console.log(`      → EXCLUDED: Subject property (${address}) - matches ${excludePropertyId}`);
        return;
      }

      // MANDATORY: Dynamic sales filter (6 or 12 months) + other criteria
      if (price && price > 10000 && soldDate && soldDate >= salesFilterDate && sqft && sqft > 0) {
        const pricePerSqft = Math.round(price / sqft);

        // STRICT SQUARE FOOTAGE FILTERING
        const sizeInRange = sqft >= minSqft && sqft <= maxSqft;
        const priceInRange = pricePerSqft >= 50 && pricePerSqft <= 300;

        console.log(`      $/sqft: $${pricePerSqft} | Size filter: ${sizeInRange ? 'PASS' : 'FAIL'} (${minSqft}-${maxSqft}) | Price filter: ${priceInRange ? 'PASS' : 'FAIL'}`);

        if (sizeInRange && priceInRange) {
          const distanceMiles = (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)))
            ? this.calculateDistance(centerLat, centerLon, lat, lon)
            : undefined;
          validComps.push({
            address,
            sqft,
            price,
            pricePerSqft,
            soldDate: soldDate.toISOString().split('T')[0],
            beds: prop.description?.beds,
            baths: computeBaths(prop.description) ?? prop.description?.baths,
            yearBuilt: prop.description?.year_built || null,
            property_id: prop.property_id || null,
            lat,
            lon,
            distance_miles: distanceMiles,
            searchRadius: radius
          });
          console.log(`      → INCLUDED as comparable`);
        } else {
          const reasons = [];
          if (!sizeInRange) reasons.push(`size out of range (${sqft} not in ${minSqft}-${maxSqft})`);
          if (!priceInRange) reasons.push('price per sqft out of range');
          console.log(`      → EXCLUDED: ${reasons.join(', ')}`);
        }
      } else {
        const reasons = [];
        if (!price || price <= 10000) reasons.push('invalid price');
        if (!soldDate || soldDate < salesFilterDate) reasons.push('old sale date');
        if (!sqft || sqft <= 0) reasons.push('missing sqft');
        console.log(`      → EXCLUDED: ${reasons.join(', ')}`);
      }
    });

    return validComps;
  }

  private async searchNullValueProperties(
    centerLat: number, 
    centerLon: number, 
    radius: number, 
    propertyTypes: string[],
    excludePropertyId: string
  ): Promise<any[]> {
    const radiusInDegrees = radius * 0.0145;
    const searchBoundary = [
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
    ];

    const searchPayload = {
      limit: 400,
      offset: 0,
      boundary: { coordinates: [searchBoundary] },
      status: ["sold"],
      type: propertyTypes
      // No sqft or year filters - capture all properties including null values
    };

    const apiKey = process.env.RAPIDAPI_KEY;
    if (!apiKey) {
      throw new Error('RAPIDAPI_KEY environment variable is required');
    }

    const searchResponse = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      body: JSON.stringify(searchPayload)
    });

    if (!searchResponse.ok) {
      console.log(`❌ Null-value search failed: ${searchResponse.status}`);
      return [];
    }

    const searchData = await searchResponse.json();
    const foundProperties = searchData?.data?.home_search?.results || [];

    // Local 6-month cutoff for null-value search
    const nvSalesCutoff = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));

    // Process and find properties with null sqft or year built
    const nullValueProps: any[] = [];

    foundProperties.forEach((prop: any) => {
      const sqft = prop.description?.sqft;
      const yearBuilt = prop.description?.year_built;
      const price = prop.last_sold_price;
      const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
      const address = prop.location?.address?.line || 'Unknown';

      // Look for properties with missing critical data
      const hasMissingSqft = !sqft || sqft <= 0;
      const hasMissingYear = !yearBuilt;

      // MANDATORY: Apply 6-month sales restriction as required by user
      if ((hasMissingSqft || hasMissingYear) && price && price > 10000 && soldDate && soldDate >= nvSalesCutoff) {
        nullValueProps.push({
          address,
          sqft: sqft || null,
          yearBuilt: yearBuilt || null,
          price,
          soldDate: soldDate.toISOString().split('T')[0],
          beds: prop.description?.beds,
          baths: prop.description?.baths,
          lat: prop.location?.address?.coordinate?.lat,
          lon: prop.location?.address?.coordinate?.lon,
          searchRadius: radius,
          missingData: {
            sqft: hasMissingSqft,
            yearBuilt: hasMissingYear
          }
        });
      }
    });

    return nullValueProps;
  }

  private async researchNullValueProperties(
    nullValueProps: any[], 
    minSqft: number, 
    maxSqft: number, 
    targetYear: number | null
  ): Promise<any[]> {
    const researchedComps = [];
    
    // FAST MODE: Limit to top 5 candidates by price (most valuable properties first)
    const candidates = nullValueProps
      .sort((a, b) => (b.price || 0) - (a.price || 0))
      .slice(0, 5);

    if (!isLeanMode()) {
      console.log(`🔍 FAST MODE: Researching top ${candidates.length} price-ranked candidates`);
    }

    // Process candidates with concurrency control
    const researchPromises = candidates.map(prop => 
      this.tavilyLimiter.execute(async () => {
        try {
          if (!isLeanMode()) {
            console.log(`🔍 Researching: ${prop.address}`);
            console.log(`   Missing data flags:`, prop.missingData);
          }

          const searchQuery = `${prop.address} property details square feet year built`;
          if (!isLeanMode()) {
            console.log(`🔍 WEB SEARCH: ${searchQuery}`);
          }

          // Use internal web search service with timeout
          const searchResult = await withTimeout(
            this.webSearch(searchQuery) || Promise.resolve([]),
            8000 // 8 second timeout
          );

          if (searchResult && searchResult.length > 0) {
            if (!isLeanMode()) {
              console.log(`✅ WEB SEARCH: Processing ${searchResult.length} search results for ${prop.address}`);
            }
            const searchText = searchResult.map((r: any) => `${r.title || ''} ${r.description || ''} ${r.content || ''}`).join(' ').toLowerCase();
            if (!isLeanMode()) {
              console.log(`🌐 ANALYZING SEARCH CONTENT: ${searchText.substring(0, 200)}...`);
            }
            let enhanced = false;

            // Extract missing square footage
            if (prop.missingData.sqft) {
              const sqftMatch = searchText.match(/(\d{1,4})\s*(?:sq|square)\s*(?:ft|feet|foot)/i);
              if (sqftMatch) {
                const sqft = parseInt(sqftMatch[1]);
                if (sqft >= minSqft && sqft <= maxSqft) {
                  prop.sqft = sqft;
                  prop.pricePerSqft = Math.round(prop.price / sqft);
                  enhanced = true;
                  if (!isLeanMode()) {
                    console.log(`✅ Enhanced sqft: ${prop.address} = ${sqft} sqft`);
                  }
                }
              }
            }

            // Extract missing year built
            if (prop.missingData.yearBuilt) {
              if (!isLeanMode()) {
                console.log(`🔍 EXTRACTING YEAR BUILT for ${prop.address}`);
              }
              const yearPatterns = [
                /(?:built|year built|constructed)[\s:]*(\d{4})/i,
                /(\d{4})\s*built/i,
                /built\s*in\s*(\d{4})/i,
                /year[\s:]*(\d{4})/i
              ];

              for (const pattern of yearPatterns) {
                const yearMatch = searchText.match(pattern);
                if (yearMatch) {
                  const year = parseInt(yearMatch[1]);
                  if (!isLeanMode()) {
                    console.log(`🌐 FOUND YEAR MATCH: ${year} using pattern ${pattern}`);
                  }
                  if (year >= 1800 && year <= 2025) {
                    prop.yearBuilt = year;
                    enhanced = true;
                    if (!isLeanMode()) {
                      console.log(`✅ Enhanced year: ${prop.address} = ${year}`);
                    }
                    break;
                  }
                }
              }

              if (!prop.yearBuilt && !isLeanMode()) {
                console.log(`❌ NO YEAR EXTRACTED for ${prop.address} from: ${searchText.substring(0, 100)}`);
              }
            }

            if (enhanced) {
              prop.researched = true;
              delete prop.missingData;
              return prop;
            }
          }
          return null;
        } catch (error: any) {
          if (!isLeanMode()) {
            console.log(`⚠️ Research failed: ${prop.address} - ${error.message || error}`);
          }
          return null;
        }
      })
    );

    const results = await Promise.all(researchPromises);
    return results.filter(result => result !== null);
  }

  private async calculateNewMethodologyARV(
    validComps: any[],
    subjectSqft: number,
    normalizedAddress: string,
    subjectProperty: any,
    researchCandidates: any[],
    centerLat: number,
    centerLon: number,
    finalYearBuilt: number | null
  ): Promise<any> {
    console.log(`🔢 NEW ARV CALCULATION: Processing ${validComps.length} valid comparables`);
    const priceOnlyOutliers = ((process.env.PRICE_ONLY_OUTLIERS || '').toString().trim() !== ''
      && (process.env.PRICE_ONLY_OUTLIERS || '0') !== '0'
      && (process.env.PRICE_ONLY_OUTLIERS || '').toLowerCase() !== 'false');
    if (priceOnlyOutliers) {
      console.log('⚙️ OUTLIERS MODE: PRICE-ONLY (MAD + price IQR); skipping $/sqft IQR');
    }
    // Tunable thresholds for ARV-friendly behavior
    const numEnv = (k: string, d: number) => {
      const v = Number(process.env[k]);
      return Number.isFinite(v) ? v : d;
    };
    const boolEnv = (k: string, d = false) => {
      const raw = (process.env[k] || '').toString().trim().toLowerCase();
      if (!raw) return d;
      return raw !== '0' && raw !== 'false';
    };
    const IQR_MULT_LOWER = numEnv('IQR_MULT_LOWER', 0.75);
    const IQR_MULT_UPPER = numEnv('IQR_MULT_UPPER', 0.75);
    const PPSF_DYNAMIC_LOWER = numEnv('PPSF_DYNAMIC_LOWER', 0.7);
    const PPSF_DYNAMIC_UPPER = numEnv('PPSF_DYNAMIC_UPPER', 1.4);
    const PRICE_ABS_LOWER_MULT = numEnv('PRICE_ABS_LOWER_MULT', 0.6);
    const PRICE_ABS_UPPER_MULT = numEnv('PRICE_ABS_UPPER_MULT', 1.6);
    const PRICE_MAD_K = numEnv('PRICE_MAD_K', 3.0);
    const RESIDUAL_OUTLIERS = boolEnv('RESIDUAL_OUTLIERS', false);
    const RESIDUAL_IQR_MULT_UPPER = numEnv('RESIDUAL_IQR_MULT_UPPER', 1.0);
    const KEEP_NEAREST_WITHIN_MI = numEnv('KEEP_NEAREST_WITHIN_MI', NaN);
    const ARV_PPSF_PERCENTILE = (() => {
      const v = Number(process.env['ARV_PPSF_PERCENTILE']);
      return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.5;
    })();
    // Targeted detail fill: populate yearBuilt for up to 10 comps for better reporting
    try { await this.fillMissingYearsForComps(validComps, 10); } catch {}

    if (validComps.length === 0) {
      throw new Error('No valid comparables provided for ARV calculation');
    }

    // Determine subject bathrooms (prefer consolidated, then compute halves)
    const subjectBathsConsolidatedRaw = (subjectProperty?.description as any)?.baths_consolidated;
    const subjectBathsConsolidated = typeof subjectBathsConsolidatedRaw === 'string'
      ? parseFloat(subjectBathsConsolidatedRaw)
      : (typeof subjectBathsConsolidatedRaw === 'number' ? subjectBathsConsolidatedRaw : NaN);
    const subjectBathsComputed = computeBaths(subjectProperty.description);
    const subjectBathsFallback = subjectBathsComputed ?? parseFloat(subjectProperty.description?.baths?.toString() || '0');
    const subjectBathsNum = Number.isFinite(subjectBathsConsolidated) ? subjectBathsConsolidated : (Number.isFinite(subjectBathsFallback) ? subjectBathsFallback : 0);

    // Baseline ARV rule (relaxed): allow comps up to subject + 0.5 baths
    // Example: subject=1.0 -> allow <=1.5; subject=1.5 -> allow <=2.0; subject=2.5 -> allow <=3.0
    const bathroomMatchedComps = validComps.filter((comp) => {
      const compBaths = parseFloat(comp.baths?.toString() || 'NaN');
      if (!Number.isFinite(compBaths)) return false;
      return compBaths <= (subjectBathsNum + 0.5 + 1e-9);
    });

    if (bathroomMatchedComps.length === 0) {
      console.log(`⚠️ BATH FILTER: No comparables with baths <= subject (${subjectBathsNum}). Falling back to all valid comps for baseline ARV.`);
    } else {
      console.log(`🚿 BATH FILTER: Using ${bathroomMatchedComps.length}/${validComps.length} comps with baths <= ${subjectBathsNum}+0.5`);
    }

    const compsForBaseline = bathroomMatchedComps.length > 0 ? bathroomMatchedComps : validComps;

    // Enhanced ARV calculation with outlier detection and usage tracking (preserve original indices)
    const pricesPerSqft = compsForBaseline
      .map((comp) => {
        const idx = validComps.indexOf(comp);
        return { price: comp.pricePerSqft, index: idx, comp };
      })
      .filter(item => item.price && item.price > 0 && item.index >= 0);

    if (pricesPerSqft.length === 0) {
      throw new Error('No valid price per sqft data found');
    }

    pricesPerSqft.sort((a, b) => a.price - b.price);

    // MAD-based total-price cap removed per request
    const madPriceOutliersFirst = new Set<number>();

    if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false')) {
      console.log(`📊 ARV ANALYSIS BREAKDOWN:`);
      console.log(`   • Total comparables (pre-bath filter): ${validComps.length}`);
      console.log(`   • Baseline comps (bath <= subject ${subjectBathsNum}): ${compsForBaseline.length}`);
      console.log(`   • Price range: $${Math.min(...pricesPerSqft.map(p => p.price))} - $${Math.max(...pricesPerSqft.map(p => p.price))} per sqft`);
    }

    // Remove IQR-based $/sqft and price outlier filtering; keep MAD total-price cap only
    const outlierIndices = new Set<number>();
    const usedIndices = new Set<number>();

    // Identify nearest comps to optionally keep regardless of $/sqft and price caps
    const KEEP_TOP_N_WITHIN_MI = numEnv('KEEP_TOP_N_WITHIN_MI', NaN);
    const KEEP_TOP_N_COUNT = Math.max(0, Math.floor(numEnv('KEEP_TOP_N_COUNT', 0)));
    const keepIndices = new Set<number>();
    let keepNearestIndex: number | undefined = undefined;
    const candidates: Array<{ idx: number; dist: number }> = [];
    compsForBaseline.forEach((comp) => {
      const idx = validComps.indexOf(comp);
      const d = Number(comp?.distance_miles);
      if (idx >= 0 && Number.isFinite(d)) {
        candidates.push({ idx, dist: d as number });
      }
    });
    candidates.sort((a,b) => a.dist - b.dist);
    if (Number.isFinite(KEEP_NEAREST_WITHIN_MI)) {
      if (candidates[0] && candidates[0].dist <= KEEP_NEAREST_WITHIN_MI) keepNearestIndex = candidates[0].idx;
    }
    if (Number.isFinite(KEEP_TOP_N_WITHIN_MI) && KEEP_TOP_N_COUNT > 0) {
      for (const c of candidates) {
        if (c.dist <= KEEP_TOP_N_WITHIN_MI && keepIndices.size < KEEP_TOP_N_COUNT) {
          keepIndices.add(c.idx);
        } else if (keepIndices.size >= KEEP_TOP_N_COUNT) {
          break;
        }
      }
    }

    // Populate usedIndices with all baseline comps (no MAD/IQR filtering)
    compsForBaseline.forEach((comp) => {
      const idx = validComps.indexOf(comp);
      if (idx >= 0) usedIndices.add(idx);
    });

    // No additional total-price IQR filtering
    const priceOutlierIndices = new Set<number>();

    // Optional: residual-based outliers (upper-only), size-adjusted
    if (RESIDUAL_OUTLIERS) {
      try {
        const rows = compsForBaseline.map((c: any) => {
          const sqft = Number(c?.sqft);
          const price = Number(c?.price);
          return { sqft, price, idx: validComps.indexOf(c) };
        }).filter(r => Number.isFinite(r.sqft) && Number.isFinite(r.price) && r.idx >= 0);
        if (rows.length >= 6) {
          // OLS fit
          const xs = rows.map(r => r.sqft);
          const ys = rows.map(r => r.price);
          const n = xs.length;
          const mx = xs.reduce((a,b)=>a+b,0)/n;
          const my = ys.reduce((a,b)=>a+b,0)/n;
          const cov = xs.reduce((s,x,i)=> s + (x-mx)*(ys[i]-my), 0);
          const varx = xs.reduce((s,x)=> s + (x-mx)*(x-mx), 0);
          const slope = varx>0 ? cov/varx : 0;
          const intercept = my - slope*mx;
          const residuals = rows.map(r => r.price - (slope*r.sqft + intercept));
          const rs = [...residuals].sort((a,b)=>a-b);
          const q1r = rs[Math.floor(rs.length*0.25)];
          const q3r = rs[Math.floor(rs.length*0.75)];
          const iqrr = q3r - q1r;
          const EXTREME_RESIDUAL_MULT = numEnv('EXTREME_RESIDUAL_MULT', 1.5);
          const upperResBound = q3r + RESIDUAL_IQR_MULT_UPPER*iqrr;
          const extremeUpper = q3r + EXTREME_RESIDUAL_MULT*iqrr;
          rows.forEach((r, i) => {
            const res = residuals[i];
            if (keepIndices.has(r.idx) || (keepNearestIndex !== undefined && r.idx === keepNearestIndex)) {
              if (res > extremeUpper) {
                outlierIndices.add(r.idx);
                usedIndices.delete(r.idx);
                console.log(`   • OUTLIER (RESIDUAL-EXTREME): ${validComps[r.idx]?.address} residual=${Math.round(res)} (> ${Math.round(extremeUpper)})`);
              }
            } else if (res > upperResBound) {
              outlierIndices.add(r.idx);
              usedIndices.delete(r.idx);
              console.log(`   • OUTLIER (RESIDUAL): ${validComps[r.idx]?.address} residual=${Math.round(res)} (> ${Math.round(upperResBound)})`);
            }
          });
        }
      } catch {}
    }

    // Calculate ARV using all baseline comps (no MAD/IQR bans)
    const banned = new Set<number>();
    const usedPrices = pricesPerSqft
      .filter(item => !banned.has(item.index))
      .map(item => item.price);
    const usedPricesSorted = [...usedPrices].sort((a, b) => a - b);
    const pctIndex = Math.max(0, Math.min(usedPricesSorted.length - 1, Math.floor((usedPricesSorted.length - 1) * ARV_PPSF_PERCENTILE)));
    const medianPricePerSqft = usedPricesSorted.length > 0 ? 
      usedPricesSorted[pctIndex] : 
      pricesPerSqft[Math.floor(pricesPerSqft.length / 2)].price;

    let arv = Math.round(medianPricePerSqft * subjectSqft);

    console.log(`   • Used in calculation: ${usedIndices.size} comparables`);
    console.log(`   • Outliers excluded ($/sqft): ${outlierIndices.size} comparables`);
    if (priceOutlierIndices.size > 0) {
      console.log(`   • Outliers excluded (price): ${priceOutlierIndices.size} comparables`);
    }
    if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false')) {
      console.log(`   • Final median price/sqft: $${medianPricePerSqft}`);
      console.log(`   • Calculated ARV: $${arv.toLocaleString()}`);
    }

    let confidence = usedIndices.size >= 5 ? 'High' : usedIndices.size >= 3 ? 'Medium' : 'Low';
    // Allow overriding displayed pricePerSqFt with OLS slope when used
    let pricePerSqFtOverride: number | undefined;

    // AUTOMATED ENHANCEMENT TRIGGER: Only when insufficient comps
    if (confidence !== 'High' && usedIndices.size < 5 && validComps.length < 5) {
      console.log(`\n🔍 AUTOMATED ENHANCEMENT TRIGGERED: ${confidence} confidence (${usedIndices.size}/5 comparables)`);
      console.log(`📈 EXPANDING SEARCH: Attempting to boost confidence to High level...`);

      try {
        // Try expanding search radius beyond current boundaries
        const enhancedComps = await this.performOnlineResearchEnhancement(
          normalizedAddress,
          centerLat,
          centerLon,
          subjectSqft,
          subjectProperty,
          validComps,
          process.env.RAPIDAPI_KEY!
        );

        if (enhancedComps && enhancedComps.length > 0) {
          console.log(`✅ ENHANCEMENT SUCCESS: Found ${enhancedComps.length} additional comparables via expanded search`);

          // Merge enhanced comparables and recalculate ARV
          const allComps = [...validComps, ...enhancedComps];
          console.log(`📊 RECALCULATING ARV: Using ${allComps.length} total comparables (${validComps.length} + ${enhancedComps.length} enhanced)`);

          // Recursively call this function with enhanced dataset
        return await this.calculateNewMethodologyARV(
            allComps,
            subjectSqft,
            normalizedAddress,
            subjectProperty,
            researchCandidates,
            centerLat,
            centerLon,
            finalYearBuilt
          );
        } else {
          console.log(`❌ ENHANCEMENT FAILED: No additional comparables found via expanded search`);
        }
      } catch (enhancementError) {
        console.log(`⚠️ ENHANCEMENT ERROR: ${enhancementError} - Continuing with current dataset`);
      }
    } else if (validComps.length >= 5) {
      console.log(`ℹ️ Skipping enhancement: sufficient comparables (${validComps.length})`);
    }

    // Check if this is a 1-bathroom property that should trigger dual calculation
    // Prefer consolidated baths value (e.g., 1.5) when present; else fall back
    const bathsConsolidatedRaw = (subjectProperty?.description as any)?.baths_consolidated;
    const bathsConsolidated = typeof bathsConsolidatedRaw === 'string' ? parseFloat(bathsConsolidatedRaw) : (typeof bathsConsolidatedRaw === 'number' ? bathsConsolidatedRaw : NaN);
    const computedBaths = Number.isFinite(bathsConsolidated) ? bathsConsolidated : computeBaths(subjectProperty.description);
    const actualBathrooms = computedBaths ?? parseFloat(subjectProperty.description?.baths?.toString() || '0');
    const shouldUseDualCalculation = actualBathrooms < 2;

    if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false')) {
      console.log(`🚿 BATHROOM ANALYSIS: ${actualBathrooms} baths detected - Dual calculation: ${shouldUseDualCalculation ? 'ENABLED' : 'DISABLED'}`);
    }

    // Display only baseline-eligible comparables (align list with baseline ARV set)
    const filteredComps = compsForBaseline;
    if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false')) {
      console.log(`🖼️ DISPLAY COMPS: Showing ${filteredComps.length} baseline-eligible comparables`);
    }

    // Format comparables with usage and bathroom indicators
    let formattedComparables = filteredComps.slice(0, 10).map((comp, index) => {
      let addressPrefix = '';
      const compBaths = parseFloat(comp.baths?.toString() || '0');

      if (usedIndices.has(validComps.indexOf(comp))) {
        addressPrefix = '* '; // Asterisk for used in calculation
      }

      // Add bathroom indicator for 1-bath subject properties
      if (shouldUseDualCalculation && compBaths >= 2) {
        addressPrefix += '[2BA] '; // Mark 2-bathroom comps differently
      }

      // Validate all numeric values to prevent NaN
      const validPrice = Number.isFinite(Number(comp?.price)) ? Number(comp.price) : null;
      const validBeds = Number.isFinite(Number(comp?.beds)) ? Number(comp.beds) : null;
      const validBaths = Number.isFinite(Number(comp?.baths)) ? Number(comp.baths) : null;
      const validSqft = Number.isFinite(Number(comp?.sqft)) ? Number(comp.sqft) : null;
      const validPricePerSqft = Number.isFinite(Number(comp?.pricePerSqft)) ? Number(comp.pricePerSqft) : null;
      const validDistance = Number.isFinite(Number(comp?.distance_miles)) ? Number(comp.distance_miles) : null;

      return {
        id: (comp?.listing_id || comp?.property_id || `comp-${index + 1}`),
        address: `${addressPrefix}${comp.address || 'Address not available'}`,
        price: validPrice ? `$${validPrice.toLocaleString()}` : 'Price not available',
        beds: validBeds,
        baths: validBaths,
        sqft: validSqft,
        distance: validDistance ? `${validDistance.toFixed(2)} miles` : 'Distance not available',
        soldDate: (comp?.soldDate || comp?.close_date || comp?.list_date || 'Date not available'),
        pricePerSqft: validPricePerSqft ? `$${validPricePerSqft.toFixed(0)}` : 'Price/sqft not available'
      };
    });

    let arvWith2ndBathroom = null;
    let comparablesWith2ndBath: any[] = [];
    let twoBathRegressionData: any = undefined;

    // Debug payload assembly (opt-in)
    const DBG_ON = String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false';
    const makeDbgComp = (c: any) => ({
      address: c?.address,
      beds: Number.isFinite(Number(c?.beds)) ? Number(c?.beds) : null,
      baths: Number.isFinite(Number(c?.baths)) ? Number(c?.baths) : null,
      sqft: Number.isFinite(Number(c?.sqft)) ? Number(c?.sqft) : null,
      distance: Number.isFinite(Number(c?.distance_miles)) ? Number(c?.distance_miles).toFixed(2) + ' miles' : null,
      price: Number.isFinite(Number(c?.price)) ? Number(c?.price) : null,
      pricePerSqft: Number.isFinite(Number(c?.pricePerSqft)) ? Number(c?.pricePerSqft) : null
    });
    const debugBlock: any = DBG_ON ? {
      initialValidCount: validComps.length,
      baselineCount: filteredComps.length,
      baseline: filteredComps.map(makeDbgComp)
    } : undefined;

    if (shouldUseDualCalculation) {
      // Find actual 2-bathroom comparables from the original dataset
      let twoBathComps = validComps.filter(comp => {
        const compBaths = parseFloat(comp.baths?.toString() || '0');
        return compBaths >= 1.75 && compBaths <= 2.5 && !outlierIndices.has(validComps.indexOf(comp));
      });

      console.log(`🚿 FOUND ${twoBathComps.length} two-bathroom comparables for enhanced ARV calculation`);

      // Two-bath MAD cap removed per request

      // Skip two-bath total-price IQR filtering (not used in OLS selection)

      // Apply outlier detection to 2-bathroom comparables (on remaining set)
      const twoBathPrices = twoBathComps.map((comp, index) => ({
        price: comp.pricePerSqft,
        index: index,
        comp: comp
      })).sort((a, b) => a.price - b.price);

      let filteredTwoBathComps = twoBathComps;
      let twoBathOutliers = [];

      if (!priceOnlyOutliers && twoBathPrices.length >= 5) {
        // Apply outlier detection to 2-bathroom comparables (market-aware bounds)
        const q1Index = Math.floor(twoBathPrices.length * 0.25);
        const q3Index = Math.floor(twoBathPrices.length * 0.75);
        const q1 = twoBathPrices[q1Index]?.price || twoBathPrices[0].price;
        const q3 = twoBathPrices[q3Index]?.price || twoBathPrices[twoBathPrices.length - 1].price;
        const iqr = q3 - q1;

        const lowerBound = q1 - (0.75 * iqr);
        const upperBound = q3 + (0.75 * iqr);
        const dynamicLower = Math.max(60, Math.round(q1 * 0.7));
        const dynamicUpper = Math.max(300, Math.round(q3 * 1.4));
        const absoluteLowerBound = Math.max(lowerBound, dynamicLower);
        const absoluteUpperBound = Math.min(upperBound, dynamicUpper);

        console.log(`🚿 2-BATH OUTLIER ANALYSIS: Range $${Math.min(...twoBathPrices.map(p => p.price))} - $${Math.max(...twoBathPrices.map(p => p.price))}/sqft, bounds: $${absoluteLowerBound} - $${absoluteUpperBound}/sqft`);

        twoBathPrices.forEach(item => {
          if (item.price < absoluteLowerBound || item.price > absoluteUpperBound) {
            twoBathOutliers.push(item.comp);
            console.log(`🚿 2-BATH OUTLIER: ${item.comp.address} at $${item.price}/sqft (outside $${absoluteLowerBound}-$${absoluteUpperBound} range)`);
          }
        });

        filteredTwoBathComps = twoBathComps.filter(comp => !twoBathOutliers.includes(comp));
        console.log(`🚿 2-BATH FILTERING: ${twoBathOutliers.length} outliers excluded, ${filteredTwoBathComps.length} comparables remaining`);
      }

      // Format 2-bathroom comparables for display with outlier indicators
      comparablesWith2ndBath = twoBathComps.slice(0, 10).map((comp, index) => {
        let addressPrefix = '* ';

        return {
          id: `2bath-comp-${index + 1}`,
          address: `${addressPrefix}${comp.address}`,
          price: `$${comp.price.toLocaleString()}`,
          beds: comp.beds || 0,
          baths: comp.baths || 0,
          sqft: comp.sqft || 0,
          distance: '1.0 miles',
          soldDate: comp.soldDate,
          pricePerSqft: `$${comp.pricePerSqft}`
        };
      });

      // Calculate enhanced ARV using filtered 2-bathroom comparables if available; otherwise use baseline median
      let enhancedPricePerSqft;
      if (filteredTwoBathComps.length >= 3) {
        // Make estimator identical to baseline: median of filtered two-bath $/sqft
        const filteredTwoBathPrices = filteredTwoBathComps.map(comp => comp.pricePerSqft).sort((a, b) => a - b);
        enhancedPricePerSqft = filteredTwoBathPrices[Math.floor(filteredTwoBathPrices.length / 2)];
        console.log(`🚿 Using median of ${filteredTwoBathComps.length} filtered two-bathroom comparables: $${enhancedPricePerSqft}/sqft`);
      } else {
        // Strict identity with baseline estimator: use baseline median when insufficient 2-bath comps
        enhancedPricePerSqft = medianPricePerSqft;
        console.log(`🚿 Using baseline median (${filteredTwoBathComps.length} filtered 2-bath comps insufficient): $${enhancedPricePerSqft}/sqft`);
      }

      const enhancedArv = Math.round(enhancedPricePerSqft * subjectSqft);
      const enhancedConfidence = usedIndices.size >= 5 ? 'High' : usedIndices.size >= 3 ? 'Medium' : 'Low';

      arvWith2ndBathroom = {
        estimate: enhancedArv.toString(),
        confidence: enhancedConfidence,
        pricePerSqFt: enhancedPricePerSqft.toString()
      };

      console.log(`🚿 2ND BATHROOM ARV: $${enhancedArv.toLocaleString()} (${enhancedPricePerSqft}/sqft from ${twoBathComps.length >= 3 ? '2-bath comps' : 'baseline median'})`);

      // Skip two-bath regression alternates (removed)
    }

    // === Regression alternates (price ~ sqft) ===
    // Utilities
    const computeOls = (rows: Array<{ sqft: number; price: number }>) => {
      if (!rows || rows.length < 2) return { slope: 0, intercept: rows[0]?.price || 0, r2: 0, predicted: 0 } as const;
      const xs = rows.map(r => r.sqft);
      const ys = rows.map(r => r.price);
      const n = xs.length;
      const mx = xs.reduce((a,b)=>a+b,0) / n;
      const my = ys.reduce((a,b)=>a+b,0) / n;
      const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
      const varx = xs.reduce((s, x) => s + (x - mx) * (x - mx), 0);
      const slope = varx > 0 ? cov / varx : 0;
      const intercept = my - slope * mx;
      const ssTot = ys.reduce((s, y) => s + (y - my) * (y - my), 0);
      const ssRes = xs.reduce((s, x, i) => s + Math.pow(ys[i] - (slope * x + intercept), 2), 0);
      const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
      const predicted = slope * subjectSqft + intercept;
      return { slope, intercept, r2, predicted } as const;
    };
    const computeWeightedOls = (rows: Array<{ sqft: number; price: number; dist?: number; ageMonths?: number }>, alpha = 1.0, halfLifeMonths = 12) => {
      if (!rows || rows.length < 2) return { slope: 0, intercept: rows[0]?.price || 0, r2: 0, predicted: 0 } as const;
      const ln2 = Math.log(2);
      const weights = rows.map(r => {
        const d = Number.isFinite(r.dist) ? (r.dist as number) : 1.0;
        const t = Number.isFinite(r.ageMonths) ? (r.ageMonths as number) : 12;
        return (1 / (1 + alpha * d)) * Math.exp(-(ln2 / halfLifeMonths) * t);
      });
      const wsum = weights.reduce((a,b)=>a+b,0) || 1;
      const xs = rows.map(r => r.sqft);
      const ys = rows.map(r => r.price);
      const mx = xs.reduce((s, x, i) => s + x * (weights[i] / wsum), 0);
      const my = ys.reduce((s, y, i) => s + y * (weights[i] / wsum), 0);
      const cov = xs.reduce((s, x, i) => s + weights[i] * (x - mx) * (ys[i] - my), 0);
      const varx = xs.reduce((s, x, i) => s + weights[i] * (x - mx) * (x - mx), 0);
      const slope = varx > 0 ? cov / varx : 0;
      const intercept = my - slope * mx;
      const ssTot = ys.reduce((s, y, i) => s + weights[i] * (y - my) * (y - my), 0);
      const ssRes = xs.reduce((s, x, i) => s + weights[i] * Math.pow(ys[i] - (slope * x + intercept), 2), 0);
      const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
      const predicted = slope * subjectSqft + intercept;
      return { slope, intercept, r2, predicted } as const;
    };

    // Build OLS rows from the filtered/used set (after outlier trimming and keeps)
    const rowsForOls: Array<{ sqft: number; price: number; dist?: number; ageMonths?: number }> = Array.from(usedIndices)
      .map((idx) => {
        const c: any = validComps[idx];
        const sqft = Number(c?.sqft);
        const price = Number(c?.price);
        if (!Number.isFinite(sqft) || !Number.isFinite(price) || sqft <= 0 || price <= 0) return null;
        let ageMonths: number | undefined = undefined;
        const dateStr = (c?.soldDate || c?.close_date || c?.list_date || '') as string;
        if (typeof dateStr === 'string' && dateStr.includes('-')) {
          const iso = dateStr.split('T')[0];
          const parts = iso.split('-');
          if (parts.length >= 2) {
            const y = Number(parts[0]);
            const m = Number(parts[1]);
            const d = Number(parts[2] || '1');
            const sold = new Date(Number.isFinite(y) ? y : 1970, Number.isFinite(m) ? m - 1 : 0, Number.isFinite(d) ? d : 1);
            const now = new Date();
            ageMonths = (now.getFullYear() - sold.getFullYear()) * 12 + (now.getMonth() - sold.getMonth());
            if (!Number.isFinite(ageMonths) || ageMonths < 0) ageMonths = 0;
          }
        }
        const dist = Number(c?.distance_miles);
        return { sqft, price, dist: Number.isFinite(dist) ? dist : undefined, ageMonths };
      })
      .filter(Boolean) as any;

    const baselineOls = computeOls(rowsForOls);
    const baselineWeighted = computeWeightedOls(rowsForOls);

    // Optional: override ARV based on env strategy
    const strategy = (process.env.ARV_STRATEGY || '').toLowerCase();
    if (strategy === 'ols_baseline' || strategy === 'weighted_ols_baseline') {
      try {
        const chosen = strategy === 'ols_baseline' ? baselineOls : baselineWeighted;
        const newArv = Math.round(chosen.predicted);
        console.log(`🧮 ARV_STRATEGY=${strategy}: Overriding baseline ARV to $${newArv.toLocaleString()}`);
        arv = newArv;
      } catch {}
    }
    if (strategy === 'ols_two_bath' || strategy === 'weighted_ols_two_bath') {
      try {
        if (twoBathRegressionData && shouldUseDualCalculation) {
          const chosen = strategy === 'ols_two_bath' ? twoBathRegressionData.ols : twoBathRegressionData.weightedOls;
          const newArv = chosen?.predictedArv;
          if (Number.isFinite(newArv)) {
            console.log(`🧮 ARV_STRATEGY=${strategy}: Overriding 2-bath ARV to $${Number(newArv).toLocaleString()}`);
            arvWith2ndBathroom = {
              estimate: String(newArv),
              confidence,
              pricePerSqFt: String(Math.round((newArv as number) / subjectSqft))
            };
          }
        }
      } catch {}
    }

    // New default method for subjects with <2 baths: Zero-intercept OLS on top-5 by price (or all if <5) for 1-bath and 2-bath buckets
    // This becomes the primary ARV, with a paired 2-bath estimate when applicable.
    if (subjectBathsNum < 2 - 1e-9) {
      const toNumber = (x: any) => Number.isFinite(Number(x)) ? Number(x) : NaN;
      const selectWithRadius = async (entries: any[], take: number) => {
        let start = Number(process.env.ANALYZE_DISTANCE_START || '1');
        let step = Number(process.env.ANALYZE_DISTANCE_STEP || '0.25');
        let max = Number(process.env.ANALYZE_DISTANCE_MAX || '2');
        if (!(start > 0)) start = 1;
        if (!(step > 0)) step = 0.25;
        if (!(max >= start)) max = Math.max(2, start);
        let chosen = start;
        while (chosen <= max + 1e-9) {
          const within = entries.filter(c => Number.isFinite(Number(c?.distance_miles)) && Number(c.distance_miles) <= chosen + 1e-9);
          // Year band constraint when subject year is plausible
          const subjYear = this.isPlausibleYear(finalYearBuilt) ? Number(finalYearBuilt) : NaN;
          const minYear = Number.isFinite(subjYear) ? subjYear - 10 : NaN;
          const maxYear = Number.isFinite(subjYear) ? subjYear + 10 : NaN;
          const getYear = (c: any) => {
            const y = Number((c as any)?.yearBuilt ?? (c as any)?.year_built);
            return Number.isFinite(y) ? y : NaN;
          };
          let candidates = within
            .map(c => ({ comp: c, sqft: toNumber(c?.sqft), price: toNumber(c?.price), year: getYear(c) }))
            .filter(r => Number.isFinite(r.sqft) && r.sqft > 0 && Number.isFinite(r.price) && r.price > 0)
            .sort((a, b) => b.price - a.price);
          // If subject year is known, try to backfill missing years only for likely OLS contenders
          if (Number.isFinite(subjYear)) {
            const inBand = candidates.filter(r => Number.isFinite(r.year) && r.year >= minYear && r.year <= maxYear);
            const dbgOn = (String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false');
            const attemptedFill: string[] = [];
            if (inBand.length < take) {
              const missingRows = candidates.filter(r => !Number.isFinite(r.year)).slice(0, Math.max(0, take - inBand.length + 2));
              const missing = missingRows.map(r => r.comp);
              if (dbgOn) {
                try { (debugBlock as any).olsYear = { subjectYear: subjYear, minYear, maxYear, inBandBefore: inBand.length, attemptedFill: missingRows.map(r => r.comp?.address).filter(Boolean) }; } catch {}
              }
              if (missing.length > 0) {
                try { await this.fillMissingYearsForComps(missing, missing.length); } catch {}
                // refresh candidates with possibly filled years
                candidates = within
                  .map(c => ({ comp: c, sqft: toNumber(c?.sqft), price: toNumber(c?.price), year: getYear(c) }))
                  .filter(r => Number.isFinite(r.sqft) && r.sqft > 0 && Number.isFinite(r.price) && r.price > 0)
                  .sort((a, b) => b.price - a.price);
              }
            }
            // Keep only in-band for selection when subject year known
            candidates = candidates.filter(r => Number.isFinite(r.year) && r.year >= minYear && r.year <= maxYear);
            if (dbgOn) {
              try { if ((debugBlock as any).olsYear) (debugBlock as any).olsYear.inBandAfter = candidates.length; } catch {}
            }
          }
          const chosenRows = candidates.slice(0, Math.max(3, Math.min(take, candidates.length)));
          if (chosenRows.length >= 3) {
            const sxy = chosenRows.reduce((s, r) => s + r.sqft * r.price, 0);
            const sxx = chosenRows.reduce((s, r) => s + r.sqft * r.sqft, 0);
            if (!(sxx > 0)) return null;
            const slope = sxy / sxx;
            return { slope, used: chosenRows.map(x => x.comp), radius: chosen };
          }
          chosen = Math.round((chosen + step) * 100) / 100;
        }
        return null;
      };

      // 1-bath bucket: comps with baths < 2, from full aligned pool
      const oneBathAligned = validComps.filter((c: any) => toNumber(c?.baths) < 2 - 1e-9);
      const ols1 = await selectWithRadius(oneBathAligned, 5);
      if (ols1) {
        const newPpsf = Math.round(ols1.slope);
        const newArv = Math.round(ols1.slope * subjectSqft);
        console.log(`📈 OLS(1BA top-5 by price): slope=$${newPpsf}/sqft -> ARV=$${newArv.toLocaleString()}`);
        // Override primary ARV
        arv = newArv;
        pricePerSqFtOverride = newPpsf;
        // Set confidence from OLS used comps
        try {
          const usedCount = Array.isArray(ols1.used) ? (ols1.used as any[]).length : 0;
          confidence = usedCount >= 5 ? 'High' : usedCount >= 3 ? 'Medium' : 'Low';
        } catch {}
        // Display exactly the 5 OLS-used comps (starred), and nothing else
        try {
          const usedList: any[] = (ols1.used as any[]);
          const rebuilt = usedList.map((comp: any, index: number) => {
            const validPrice = Number.isFinite(Number(comp?.price)) ? Number(comp.price) : null;
            const validBeds = Number.isFinite(Number(comp?.beds)) ? Number(comp.beds) : null;
            const validBaths = Number.isFinite(Number(comp?.baths)) ? Number(comp.baths) : null;
            const validSqft = Number.isFinite(Number(comp?.sqft)) ? Number(comp.sqft) : null;
            const d = Number.isFinite(Number(comp?.distance_miles)) ? Number(comp.distance_miles) : undefined;
            return {
              id: (comp?.listing_id || comp?.property_id || `comp-${index + 1}`),
              address: `* ${comp.address || 'Address not available'}`,
              price: validPrice ? `$${validPrice.toLocaleString()}` : 'Price not available',
              beds: validBeds,
              baths: validBaths,
              sqft: validSqft,
              distance: typeof d === 'number' ? `${d.toFixed(2)} miles` : '—',
              yearBuilt: (Number.isFinite(Number((comp as any)?.yearBuilt)) ? Number((comp as any)?.yearBuilt) : ((comp as any)?.year_built ?? null)),
              soldDate: (comp?.soldDate || comp?.close_date || comp?.list_date || 'Date not available'),
              pricePerSqft: (validPrice && validSqft) ? `$${Math.round(validPrice/validSqft)}` : 'Price/sqft not available'
            };
          });
          (formattedComparables as any) = rebuilt;
          if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false') && debugBlock) {
            debugBlock.alignedPool = oneBathAligned.map(makeDbgComp);
            debugBlock.selectedRadius = ols1.radius;
            debugBlock.selectedFive = usedList.map(makeDbgComp);
            debugBlock.bandUsed = '1-bath';
          }
        } catch {}
      } else {
        console.log('📈 OLS(1BA): insufficient aligned comps (<3); keeping previous ARV');
      }

      // 2-bath bucket: strict 2.0–2.5 from full pool
      const twoBathAligned = validComps.filter((c: any) => {
        const b = toNumber(c?.baths);
        // Strict 2.0–2.5 range for two-bath bucket per request
        return Number.isFinite(b) && b >= 2 - 1e-9 && b <= 2.5 + 1e-9;
      });
      const ols2 = await selectWithRadius(twoBathAligned, 5);
      if (ols2) {
        const newPpsf2 = Math.round(ols2.slope);
        const newArv2 = Math.round(ols2.slope * subjectSqft);
        console.log(`📈 OLS(2BA top-5 by price): slope=$${newPpsf2}/sqft -> ARV=$${newArv2.toLocaleString()}`);
        const usedCount2 = Array.isArray(ols2.used) ? (ols2.used as any[]).length : 0;
        const conf2 = usedCount2 >= 5 ? 'High' : usedCount2 >= 3 ? 'Medium' : 'Low';
        arvWith2ndBathroom = {
          estimate: String(newArv2),
          confidence: conf2,
          pricePerSqFt: String(newPpsf2)
        };
        try {
          const usedList2: any[] = (ols2.used as any[]);
          const rebuilt2 = usedList2.map((comp: any, index: number) => {
            const validPrice = Number.isFinite(Number(comp?.price)) ? Number(comp.price) : null;
            const validSqft = Number.isFinite(Number(comp?.sqft)) ? Number(comp.sqft) : null;
            const d = Number.isFinite(Number(comp?.distance_miles)) ? Number(comp.distance_miles) : undefined;
            return {
              id: (comp?.listing_id || comp?.property_id || `2bath-comp-${index + 1}`),
              address: `* ${comp.address || 'Address not available'}`,
              price: validPrice ? `$${Number(validPrice).toLocaleString()}` : 'Price not available',
              beds: comp.beds || 0,
              baths: comp.baths || 0,
              sqft: comp.sqft || 0,
              distance: typeof d === 'number' ? `${d.toFixed(2)} miles` : '—',
              soldDate: (comp?.soldDate || comp?.close_date || comp?.list_date || 'Date not available'),
              pricePerSqft: (validPrice && validSqft) ? `$${Math.round(Number(validPrice)/Number(validSqft))}` : 'Price/sqft not available'
            };
          });
          (comparablesWith2ndBath as any) = rebuilt2;
          if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false') && debugBlock) {
            debugBlock.twoBathAligned = twoBathAligned.map(makeDbgComp);
            debugBlock.twoBathSelectedRadius = ols2.radius;
            debugBlock.twoBathSelectedFive = usedList2.map(makeDbgComp);
          }
        } catch {}
      } else {
        console.log('📈 OLS(2BA): insufficient aligned comps (<3); skipping 2-bath ARV');
      }
    } else {
      // Subjects with >=2 baths:
      // Rule: target exact subject baths; if <3 comps available, expand to subject ±1.0
      const toNumber = (x: any) => Number.isFinite(Number(x)) ? Number(x) : NaN;
      const selectWithRadius = async (entries: any[], take: number) => {
        let start = Number(process.env.ANALYZE_DISTANCE_START || '1');
        let step = Number(process.env.ANALYZE_DISTANCE_STEP || '0.25');
        let max = Number(process.env.ANALYZE_DISTANCE_MAX || '2');
        if (!(start > 0)) start = 1;
        if (!(step > 0)) step = 0.25;
        if (!(max >= start)) max = Math.max(2, start);
        let chosen = start;
        while (chosen <= max + 1e-9) {
          const within = entries.filter(c => Number.isFinite(Number(c?.distance_miles)) && Number(c.distance_miles) <= chosen + 1e-9);
          // Year band constraint when subject year is plausible
          const subjYear = this.isPlausibleYear(finalYearBuilt) ? Number(finalYearBuilt) : NaN;
          const minYear = Number.isFinite(subjYear) ? subjYear - 10 : NaN;
          const maxYear = Number.isFinite(subjYear) ? subjYear + 10 : NaN;
          const getYear = (c: any) => {
            const y = Number((c as any)?.yearBuilt ?? (c as any)?.year_built);
            return Number.isFinite(y) ? y : NaN;
          };
          let candidates = within
            .map(c => ({ comp: c, sqft: toNumber(c?.sqft), price: toNumber(c?.price), baths: toNumber(c?.baths), year: getYear(c) }))
            .filter(r => Number.isFinite(r.sqft) && r.sqft > 0 && Number.isFinite(r.price) && r.price > 0)
            .sort((a, b) => b.price - a.price);
          if (Number.isFinite(subjYear)) {
            const inBand = candidates.filter(r => Number.isFinite(r.year) && r.year >= minYear && r.year <= maxYear);
            const dbgOn = (String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false');
            if (inBand.length < take) {
              const missingRows = candidates.filter(r => !Number.isFinite(r.year)).slice(0, Math.max(0, take - inBand.length + 2));
              const missing = missingRows.map(r => r.comp);
              if (dbgOn) {
                try { (debugBlock as any).olsYear = { subjectYear: subjYear, minYear, maxYear, inBandBefore: inBand.length, attemptedFill: missingRows.map(r => r.comp?.address).filter(Boolean) }; } catch {}
              }
              if (missing.length > 0) {
                try { await this.fillMissingYearsForComps(missing, missing.length); } catch {}
                candidates = within
                  .map(c => ({ comp: c, sqft: toNumber(c?.sqft), price: toNumber(c?.price), baths: toNumber(c?.baths), year: getYear(c) }))
                  .filter(r => Number.isFinite(r.sqft) && r.sqft > 0 && Number.isFinite(r.price) && r.price > 0)
                  .sort((a, b) => b.price - a.price);
              }
            }
            candidates = candidates.filter(r => Number.isFinite(r.year) && r.year >= minYear && r.year <= maxYear);
            if (dbgOn) {
              try { if ((debugBlock as any).olsYear) (debugBlock as any).olsYear.inBandAfter = candidates.length; } catch {}
            }
          }
          const chosenRows = candidates.slice(0, Math.max(3, Math.min(take, candidates.length)));
          if (chosenRows.length >= 3) {
            const sxy = chosenRows.reduce((s, r) => s + r.sqft * r.price, 0);
            const sxx = chosenRows.reduce((s, r) => s + r.sqft * r.sqft, 0);
            if (!(sxx > 0)) return null;
            const slope = sxy / sxx;
            return { slope, used: chosenRows.map(x => x.comp), radius: chosen };
          }
          chosen = Math.round((chosen + step) * 100) / 100;
        }
        return null;
      };

      // First, try exact-match band (±0.1 tolerance around subject baths)
      const tol = 0.1;
      const exactLower = subjectBathsNum - tol;
      const exactUpper = subjectBathsNum + tol;
      let aligned = validComps.filter((c: any) => {
        const b = toNumber(c?.baths);
        return Number.isFinite(b) && b >= exactLower && b <= exactUpper;
      });
      // If not enough, expand to subject ±1.0
      if (aligned.length < 3) {
        const lower = subjectBathsNum - 1 - 1e-9;
        const upper = subjectBathsNum + 1 + 1e-9;
        aligned = validComps.filter((c: any) => {
          const b = toNumber(c?.baths);
          return Number.isFinite(b) && b >= lower && b <= upper;
        });
      }
      const ols = await selectWithRadius(aligned, 5);
      if (ols) {
        const newPpsf = Math.round(ols.slope);
        const newArv = Math.round(ols.slope * subjectSqft);
        console.log(`📈 OLS(baths ${aligned.length < 3 ? `${subjectBathsNum}±1` : `${subjectBathsNum}≈`} , top-5 by price): slope=$${newPpsf}/sqft -> ARV=$${newArv.toLocaleString()}`);
        arv = newArv;
        pricePerSqFtOverride = newPpsf;
        // Set confidence from OLS used comps
        try {
          const usedCount = Array.isArray(ols.used) ? (ols.used as any[]).length : 0;
          confidence = usedCount >= 5 ? 'High' : usedCount >= 3 ? 'Medium' : 'Low';
        } catch {}
        // Replace displayed baseline list with exactly the five OLS-used comps (starred)
        try {
          const usedList: any[] = (ols.used as any[]);
          const rebuilt = usedList.map((comp: any, index: number) => {
            const validPrice = Number.isFinite(Number(comp?.price)) ? Number(comp.price) : null;
            const validBeds = Number.isFinite(Number(comp?.beds)) ? Number(comp.beds) : null;
            const validBaths = Number.isFinite(Number(comp?.baths)) ? Number(comp.baths) : null;
            const validSqft = Number.isFinite(Number(comp?.sqft)) ? Number(comp.sqft) : null;
            const d = Number.isFinite(Number(comp?.distance_miles)) ? Number(comp.distance_miles) : undefined;
            return {
              id: (comp?.listing_id || comp?.property_id || `comp-${index + 1}`),
              address: `* ${comp.address || 'Address not available'}`,
              price: validPrice ? `$${validPrice.toLocaleString()}` : 'Price not available',
              beds: validBeds,
              baths: validBaths,
              sqft: validSqft,
              distance: typeof d === 'number' ? `${d.toFixed(2)} miles` : '—',
              soldDate: (comp?.soldDate || comp?.close_date || comp?.list_date || 'Date not available'),
              pricePerSqft: (validPrice && validSqft) ? `$${Math.round(validPrice/validSqft)}` : 'Price/sqft not available'
            };
          });
          (formattedComparables as any) = rebuilt;
          if ((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false') && debugBlock) {
            debugBlock.alignedPool = aligned.map(makeDbgComp);
            debugBlock.selectedRadius = ols.radius;
            debugBlock.selectedFive = usedList.map(makeDbgComp);
            debugBlock.bandUsed = (aligned.length < 3 ? `${subjectBathsNum}±1` : `${subjectBathsNum}≈`);
          }
        } catch {}
      } else {
        console.log('📈 OLS(>=2 baths): insufficient aligned comps (<3); keeping previous ARV');
      }
    }

    // Compute baths with halves, if present
    const bathsComputed = computeBaths(subjectProperty.description);

    // Alternates removed to simplify payload and logging

    // Attach OLS audit metadata
    let olsAudit: any = undefined;
    try {
      if (subjectBathsNum < 2 - 1e-9) {
        // Provide both 1-bath and 2-bath audit blocks when available
        const oneBlock = (Array.isArray((formattedComparables as any)) && (formattedComparables as any).length >= 3)
          ? {
              bandUsed: '1-bath',
              slope: Number(pricePerSqFtOverride) || undefined,
              comps: (formattedComparables as any).slice(0, 5).map((c: any) => ({
                address: String(c.address).replace(/^\*\s*/, ''),
                sqft: c.sqft ?? null,
                price: typeof c.price === 'string' ? Number(String(c.price).replace(/[^0-9.]/g, '')) : (c.price ?? null),
                baths: c.baths ?? null,
              }))
            }
          : undefined;
        const twoBlock = (Array.isArray((comparablesWith2ndBath as any)) && (comparablesWith2ndBath as any).length >= 3)
          ? {
              bandUsed: '2-bath',
              slope: (arvWith2ndBathroom?.pricePerSqFt ? Number(arvWith2ndBathroom.pricePerSqFt) : undefined),
              comps: (comparablesWith2ndBath as any).slice(0, 5).map((c: any) => ({
                address: String(c.address).replace(/^\*\s*/, ''),
                sqft: c.sqft ?? null,
                price: typeof c.price === 'string' ? Number(String(c.price).replace(/[^0-9.]/g, '')) : (c.price ?? null),
                baths: c.baths ?? null,
              }))
            }
          : undefined;
        if (oneBlock || twoBlock) olsAudit = { oneBath: oneBlock, twoBath: twoBlock };
      } else {
        // >=2 baths: include bandUsed for exact vs ±1.0
        const tol = 0.1;
        const exactLower = subjectBathsNum - tol;
        const exactUpper = subjectBathsNum + tol;
        const exactCount = validComps.filter((c: any) => {
          const b = Number.isFinite(Number((c as any)?.baths)) ? Number((c as any)?.baths) : NaN;
          return Number.isFinite(b) && b >= exactLower && b <= exactUpper;
        }).length;
        const bandUsed = exactCount >= 3 ? `${subjectBathsNum}≈` : `${subjectBathsNum}±1`;
        olsAudit = {
          bandUsed,
          slope: Number(pricePerSqFtOverride) || undefined,
          comps: (Array.isArray((formattedComparables as any)) ? (formattedComparables as any) : []).slice(0, 5).map((c: any) => ({
            address: String(c.address).replace(/^\*\s*/, ''),
            sqft: c.sqft ?? null,
            price: typeof c.price === 'string' ? Number(String(c.price).replace(/[^0-9.]/g, '')) : (c.price ?? null),
            baths: c.baths ?? null,
          }))
        };
      }
    } catch {}

    return {
      address: normalizedAddress,
      arv: arv.toString(),
      confidence,
      pricePerSqFt: (typeof pricePerSqFtOverride === 'number' ? pricePerSqFtOverride : medianPricePerSqft).toString(),
      beds: subjectProperty.description?.beds || 0,
      baths: (Number.isFinite(bathsConsolidated) ? bathsConsolidated : (bathsComputed ?? subjectProperty.description?.baths ?? 0)).toString(),
      sqft: subjectProperty.description?.sqft || subjectSqft,
      yearBuilt: (this.isPlausibleYear(finalYearBuilt) ? Number(finalYearBuilt) : undefined),
      comparables: formattedComparables,
      isDualCalculation: shouldUseDualCalculation,
      arvWith2ndBathroom,
      comparablesWith2ndBath,
      
      ...((String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== '0' && String(process.env.ANALYZE_DEBUG || '').toLowerCase() !== 'false' && debugBlock) ? { debug: debugBlock } : {}),
      ...(olsAudit ? { ols: olsAudit } : {})
    };
  }

  private async continueAnalysisWithResearchedData(
    normalizedAddress: string,
    centerLat: number,
    centerLon: number,
    updatedSubjectSqft: number,
    updatedYearBuilt: number | null,
    updatedSubjectBeds: number,
    updatedSubjectBaths: number,
    updatedPropertyType: string
  ): Promise<PropertyAnalysis> {
    console.log(`🔄 CONTINUING ANALYSIS WITH RESEARCHED DATA`);
    console.log(`📊 Subject: ${updatedSubjectSqft} sqft, built ${updatedYearBuilt}, ${updatedSubjectBeds}bed/${updatedSubjectBaths}bath ${updatedPropertyType}`);

    // Create subject property object with researched data from external sources
    const safeSqft = this.isPlausibleSqft(updatedSubjectSqft) ? updatedSubjectSqft : undefined;
    const plausibleYear = this.isPlausibleYear(updatedYearBuilt) ? Number(updatedYearBuilt) : null;
    const enhancedSubjectProperty = {
      description: {
        // Only set sqft if plausibly extracted from online data
        sqft: safeSqft,
        year_built: plausibleYear,
        beds: updatedSubjectBeds,
        baths: updatedSubjectBaths,
        type: updatedPropertyType
      },
      location: {
        address: {
          line: normalizedAddress,
          coordinate: {
            lat: centerLat,
            lon: centerLon
          }
        }
      }
    };

    // Determine property types to search for based on authentic property type
    // Normalize to lowercase when provided; do not default to a specific type
    const detectedType = (typeof updatedPropertyType === 'string' ? updatedPropertyType : '').toLowerCase();

    // If type is ambiguous, try refining via web research
    let effectiveType = detectedType;
    if (!effectiveType || effectiveType === 'unknown' || effectiveType === 'other') {
      try {
        const researched = await this.researchPropertyData(normalizedAddress);
        if (researched && researched.propertyType) {
          effectiveType = researched.propertyType.toLowerCase();
          console.log(`   • Type refined via web research: "${effectiveType}"`);
        }
      } catch {
        // ignore research failures
      }
    }

    console.log(`🔍 PROPERTY TYPE MAPPING (Researched Data):`);
    console.log(`   • Detected property type: "${effectiveType}"`);

    let propertyTypes: string[];
    if (effectiveType === 'duplex' || effectiveType === 'multi_family') {
      propertyTypes = ['multi_family'];
      console.log(`   • Mapped to: multi_family (duplex/multi-family)`);
    } else if (effectiveType === 'townhome' || effectiveType === 'townhomes') {
      propertyTypes = ['townhomes'];
      console.log(`   • Mapped to: townhomes`);
    } else if (effectiveType === 'condo' || effectiveType === 'condos') {
      propertyTypes = ['condos'];
      console.log(`   • Mapped to: condos`);
    } else if (effectiveType === 'single_family' || effectiveType === 'single family') {
      propertyTypes = ['single_family'];
      console.log(`   • Mapped to: single_family`);
    } else {
      // If we cannot determine the type, search across common residential types instead of only multi_family
      propertyTypes = ['single_family', 'townhomes', 'condos', 'multi_family'];
      console.log(`   • Unknown type "${effectiveType}" - searching across: ${JSON.stringify(propertyTypes)}`);
    }

    // Use the existing RapidAPI search to find real comparables
    console.log(`🔍 SEARCHING FOR REAL COMPARABLES USING RAPIDAPI`);

    const apiKey = process.env.RAPIDAPI_KEY!;

    // Use only plausibly extracted online sqft for ARV; otherwise, do not compute ARV
    let finalSqftForCalculation = this.isPlausibleSqft(updatedSubjectSqft) ? updatedSubjectSqft : NaN as unknown as number;



    // Adapt size filters if subject sqft looks implausibly small/large from web fallback
    let minSqft: number;
    let maxSqft: number;
    if (!Number.isFinite(finalSqftForCalculation) || finalSqftForCalculation <= 0) {
      // No sqft: use a broad residential band
      minSqft = 700;
      maxSqft = 3000;
      console.log(`   • No subject sqft available. Using broad size range ${minSqft}-${maxSqft} sqft`);
    } else if (finalSqftForCalculation < 600) {
      // Likely parsing artifact (e.g., 401 instead of 1401/2401). Relax filters to capture realistic comps.
      minSqft = Math.max(400, Math.round(finalSqftForCalculation * 0.5));
      maxSqft = Math.max(1200, Math.round(finalSqftForCalculation * 2.0));
      console.log(`   • Subject sqft (${finalSqftForCalculation}) suspiciously low. Using relaxed size range ${minSqft}-${maxSqft} sqft`);
    } else if (finalSqftForCalculation > 6000) {
      // Unusually large; widen generously but keep upper bound reasonable
      minSqft = Math.round(finalSqftForCalculation * 0.6);
      maxSqft = Math.round(finalSqftForCalculation * 1.4);
      console.log(`   • Subject sqft (${finalSqftForCalculation}) unusually high. Using adjusted size range ${minSqft}-${maxSqft} sqft`);
    } else {
      minSqft = Math.round(finalSqftForCalculation * 0.8);
      maxSqft = Math.round(finalSqftForCalculation * 1.2);
    }

    let validComps = await this.searchWithFilters(
      centerLat, 
      centerLon, 
      1, // Start with 1 mile radius
      propertyTypes, 
      minSqft, 
      maxSqft, 
      updatedYearBuilt, 
      normalizedAddress // Exclude subject property from comparables
    );


    if (validComps.length < 5) {
      console.log(`\n🔍 FEW COMPARABLES FOUND (${validComps.length}). Trying progressive relaxation...`);

      try {
        // First, try extending to 12 months instead of 6 months
        console.log(`📈 EXTENDING SALES FILTER: 12 months within 1 mile...`);
        let extendedComps = await this.searchWithFilters(
          centerLat, 
          centerLon, 
          1, // Start with 1 mile radius
          propertyTypes, 
          minSqft, 
          maxSqft, 
          updatedYearBuilt, 
          normalizedAddress, // Exclude subject property from comparables
          12  // Use 12-month filter for low confidence
        );

        if (extendedComps.length < 5) {
          console.log(`⚠️ Still few comps (${extendedComps.length}). Trying 24 months within 1 mile...`);
          extendedComps = await this.searchWithFilters(
            centerLat,
            centerLon,
            1,
            propertyTypes,
            minSqft,
            maxSqft,
            updatedYearBuilt,
            normalizedAddress,
            24
          );
        }

        if (extendedComps.length < 5) {
          console.log(`⚠️ Still few comps (${extendedComps.length}). Relaxing size to ±30% within 1 mile...`);
          const minSqft30 = Math.round(finalSqftForCalculation * 0.7);
          const maxSqft30 = Math.round(finalSqftForCalculation * 1.3);
          // Try 12 months with relaxed size, then 24
          extendedComps = await this.searchWithFilters(
            centerLat,
            centerLon,
            1,
            propertyTypes,
            minSqft30,
            maxSqft30,
            updatedYearBuilt,
            normalizedAddress,
            12
          );
          if (extendedComps.length < 5) {
            extendedComps = await this.searchWithFilters(
              centerLat,
              centerLon,
              1,
              propertyTypes,
              minSqft30,
              maxSqft30,
              updatedYearBuilt,
              normalizedAddress,
              24
            );
          }
        }

        if (extendedComps.length >= 3) {
          console.log(`✅ EXTENDED SEARCH SUCCESS: Using ${extendedComps.length} comparables after relaxation`);
          validComps = extendedComps;
        } else {
          // If still insufficient, try expanded radius enhancement (2–5 miles) using working searchWithFilters
          console.log(`❌ Extended search still insufficient. Trying expanded radius enhancement...`);
          const enhancedComps = await this.performOnlineResearchEnhancement(
            normalizedAddress,
            centerLat,
            centerLon,
            finalSqftForCalculation,
            enhancedSubjectProperty,
            validComps,
            apiKey,
            propertyTypes
          );
          if (enhancedComps && enhancedComps.length >= 3) {
            console.log(`✅ ENHANCEMENT SUCCESS: Found ${enhancedComps.length} comparables via expanded radius`);
            validComps = enhancedComps;
          }
        }
      } catch (enhancementError) {
        console.log(`⚠️ ENHANCEMENT FAILED: ${enhancementError}`);
      }

      if (validComps.length < 3) {
        const typeLabel = effectiveType || 'unknown';
        throw new Error(`No sufficient comparable ${typeLabel} properties found after relaxation. Consider expanding criteria or checking data availability.`);
      }
    }

    // Calculate ARV using the researched subject data
    // Ensure we have a plausible sqft before attempting ARV
    if (!Number.isFinite(finalSqftForCalculation) || !this.isPlausibleSqft(finalSqftForCalculation)) {
      throw new Error('Square footage not available from online sources; unable to compute ARV.');
    }

    const result = await this.calculateNewMethodologyARV(
      validComps,
      finalSqftForCalculation,
      normalizedAddress,
      enhancedSubjectProperty,
      [], // No additional research candidates needed
      centerLat,
      centerLon,
      updatedYearBuilt
    );

    console.log(`✅ ANALYSIS COMPLETED WITH RESEARCHED DATA: ARV ${result.arv} with ${result.confidence} confidence`);
    return result;
  }

  private async searchAuthenticComparables(
    subjectAddress: string,
    centerLat: number,
    centerLon: number,
    subjectSqft: number,
    subjectYearBuilt: number | null,
    propertyType: string
  ): Promise<any[]> {
    console.log(`🔍 AUTHENTIC RESEARCH: Searching for real ${propertyType} comparables near ${subjectAddress}`);

    const validComps: any[] = [];
    const searchQueries = [
      `${subjectAddress} recent home sales comparable properties ${propertyType}`,
      `sold homes near ${subjectAddress} ${propertyType} real estate`,
      `${subjectAddress} area recent sales MLS data ${propertyType}`,
      `county records ${subjectAddress} sold properties ${propertyType}`,
      `real estate transactions near ${subjectAddress} ${propertyType}`
    ];

    for (const query of searchQueries) {
      try {
        console.log(`🌐 RESEARCHING: ${query}`);

        // Skip web search for now - focus on API data
        const searchResults: any[] = [];

        if (searchResults && searchResults.length > 0) {
          console.log(`✅ Found ${searchResults.length} search results for comparable research`);

          // Extract property data from search results
          for (const result of searchResults) {
            const extractedData = this.extractComparableFromContent(result, subjectSqft, propertyType);
            if (extractedData) {
              validComps.push(extractedData);
              console.log(`📋 EXTRACTED COMPARABLE: ${extractedData.address} - $${extractedData.price} | ${extractedData.sqft}sqft`);

              // Limit to prevent too many results
              if (validComps.length >= 10) break;
            }
          }
        }

        // Stop if we have enough comparables
        if (validComps.length >= 8) break;

      } catch (error) {
        console.log(`❌ Search failed for: ${query}`);
        continue;
      }
    }

    console.log(`📊 TOTAL AUTHENTIC COMPARABLES FOUND: ${validComps.length}`);

    // Filter and validate the authentic comparables
    const filteredComps = validComps.filter(comp => {
      const pricePerSqft = comp.price / comp.sqft;
      const sizeVariance = Math.abs(comp.sqft - subjectSqft) / subjectSqft;

      return pricePerSqft >= 50 && pricePerSqft <= 500 && sizeVariance <= 0.5; // 50% size variance
    });

    console.log(`✅ VALIDATED AUTHENTIC COMPARABLES: ${filteredComps.length}`);
    return filteredComps;
  }

  private extractComparableFromContent(searchResult: any, subjectSqft: number, propertyType: string): any | null {
    try {
      const content = (searchResult.title + ' ' + searchResult.content).toLowerCase();

      // Extract address pattern
      const addressMatch = content.match(/(\d+\s+[a-z\s]+(?:st|ave|dr|ln|way|ct|cir|blvd|rd|pl))/i);
      if (!addressMatch) return null;

      // Extract price pattern
      const priceMatch = content.match(/\$([0-9,]+)/);
      if (!priceMatch) return null;

      // Extract square footage pattern
      const sqftMatch = content.match(/(\d+)\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet)/i);
      if (!sqftMatch) return null;

      // Extract beds/baths if available
      const bedsMatch = content.match(/(\d+)\s*(?:bed|bedroom)/i);
      const bathsMatch = content.match(/(\d+)\s*(?:bath|bathroom)/i);

      // Extract year built if available
      const yearMatch = content.match(/built\s*(?:in\s*)?(\d{4})/i);

      const price = parseInt(priceMatch[1].replace(/,/g, ''));
      const sqft = parseInt(sqftMatch[1]);
      const beds = bedsMatch ? parseInt(bedsMatch[1]) : Math.ceil(sqft / 400);
      const baths = bathsMatch ? parseInt(bathsMatch[1]) : Math.ceil(sqft / 500);
      const yearBuilt = yearMatch ? parseInt(yearMatch[1]) : null;

      // Validate reasonable ranges
      if (price < 50000 || price > 2000000 || sqft < 500 || sqft > 5000) {
        return null;
      }

      return {
        address: addressMatch[1].trim(),
        price,
        sqft,
        beds,
        baths,
        yearBuilt,
        pricePerSqft: Math.round(price / sqft),
        // soldDate intentionally left unknown when sourced from web research without a reliable date
        soldDate: null,
        source: 'web_research'
      };

    } catch (error) {
      return null;
    }
  }

  private async checkAddressInAutocomplete(address: string, apiKey: string): Promise<any> {
    try {
      console.log(`🔍 AUTOCOMPLETE CHECK: Verifying ${address} exists in system...`);

      const response = await loggedFetch(`https://realty-in-us.p.rapidapi.com/locations/v2/auto-complete?input=${encodeURIComponent(address)}`, {
        method: 'GET'
      });

      if (!response.ok) {
        console.log(`❌ Autocomplete API failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.autocomplete && data.autocomplete.length > 0) {
        // Check if any result is an exact address match
        const addressMatch = data.autocomplete.find((item: any) => 
          item.area_type === 'address' && 
          item.full_address && 
          item.full_address.some((addr: string) => 
            addr.toLowerCase().includes(address.split(',')[0].toLowerCase())
          )
        );

        if (addressMatch) {
          console.log(`✅ ADDRESS CONFIRMED: ${address} exists in autocomplete system`);
          console.log(`   • MPR ID: ${addressMatch.mpr_id || 'none'}`);
          console.log(`   • Status: ${addressMatch.prop_status || 'unknown'}`);
          return addressMatch;
        }
      }

      console.log(`❌ ADDRESS NOT FOUND: ${address} not in autocomplete system`);
      return null;

    } catch (error) {
      console.log(`❌ Autocomplete check failed: ${error}`);
      return null;
    }
  }

  private async getPropertyDetailsFromMPR(mprId: string, apiKey: string): Promise<any> {
    try {
      console.log(`🏠 FETCHING PROPERTY DETAILS: Using MPR ID ${mprId}`);

      const response = await loggedFetch(`https://realty-in-us.p.rapidapi.com/properties/v3/detail?property_id=${mprId}`, {
        method: 'GET'
      });

      if (!response.ok) {
        console.log(`❌ Property details API failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.data && data.data.home) {
        const home = data.data.home;
        console.log(`✅ PROPERTY DETAILS FOUND via MPR API:`);
        console.log(`   • Square Feet: ${home.description?.sqft || 'unknown'}`);
        console.log(`   • Bedrooms: ${home.description?.beds || 'unknown'}`);
        console.log(`   • Bathrooms: ${home.description?.baths || 'unknown'}`);
        console.log(`   • Year Built: ${home.description?.year_built || 'unknown'}`);
        console.log(`   • Property Type: ${home.description?.type || 'unknown'}`);

        return {
          sqft: home.description?.sqft,
          beds: home.description?.beds,
          baths: home.description?.baths,
          yearBuilt: home.description?.year_built,
          propertyType: home.description?.type
        };
      }

      console.log(`❌ No property details found in MPR response`);
      return null;

    } catch (error) {
      console.log(`❌ Property details lookup failed: ${error}`);
      return null;
    }
  }

  private generateBoundaryFromRadius(centerLat: number, centerLon: number, radiusMiles: number): number[][] {
    const radiusInDegrees = radiusMiles / 69; // Approximate conversion: 1 degree ≈ 69 miles
    const boundarySize = radiusInDegrees;

    return [
      [centerLon - boundarySize, centerLat - boundarySize],
      [centerLon + boundarySize, centerLat - boundarySize],
      [centerLon + boundarySize, centerLat + boundarySize],
      [centerLon - boundarySize, centerLat + boundarySize],
      [centerLon - boundarySize, centerLat - boundarySize]
    ];
  }

  private async performOnlineResearchEnhancement(
    subjectAddress: string,
    centerLat: number,
    centerLon: number,
    subjectSqft: number,
    subjectProperty: any,
    existingComps: any[],
    apiKey: string,
    propertyTypes?: string[]
  ): Promise<any[]> {
    console.log(`\n🔍 ONLINE RESEARCH ENHANCEMENT: Expanding comparable search beyond current boundaries`);

    const enhancedComps: any[] = [];
    const maxEnhancementRadius = 5; // Expand up to 5 miles for enhancement

    try {
      // Try expanding radius in increments to find more comparables
      for (let radius = 2; radius <= maxEnhancementRadius; radius++) {
        console.log(`\n📈 ENHANCEMENT PHASE ${radius}: Searching ${radius}-mile radius for additional comparables`);
        // Reuse the working filter/search pipeline for enhancement to avoid payload mismatches
        const subjectType = (subjectProperty?.description?.type as string | undefined) || undefined;
        const types = propertyTypes && propertyTypes.length ? propertyTypes
          : subjectType
            ? [subjectType]
            : ['single_family'];

        const minSqft = Math.floor(subjectSqft * 0.8);
        const maxSqft = Math.ceil(subjectSqft * 1.2);

        // Try 12 months first at this radius
        let compsAtRadius = await this.searchWithFilters(
          centerLat,
          centerLon,
          radius,
          types,
          minSqft,
          maxSqft,
          subjectProperty?.description?.year_built || null,
          subjectAddress,
          12
        );

        if (compsAtRadius.length < 3) {
          // Try 24 months
          compsAtRadius = await this.searchWithFilters(
            centerLat,
            centerLon,
            radius,
            types,
            minSqft,
            maxSqft,
            subjectProperty?.description?.year_built || null,
            subjectAddress,
            24
          );
        }

        // Deduplicate against existingComps and what we already gathered
        const seen = new Set(
          existingComps.map(c => (c.address || '').toLowerCase())
            .concat(enhancedComps.map(c => (c.address || '').toLowerCase()))
        );
        compsAtRadius.forEach(c => {
          const key = (c.address || '').toLowerCase();
          if (!seen.has(key)) {
            enhancedComps.push(c);
            seen.add(key);
          }
        });

        console.log(`✅ ENHANCEMENT RADIUS ${radius}: Added ${compsAtRadius.length} (total unique ${enhancedComps.length})`);
        if (enhancedComps.length >= 10) {
          console.log(`✅ ENHANCEMENT COMPLETE: Found sufficient additional comparables (${enhancedComps.length})`);
          break;
        }
      }

      console.log(`\n📊 ENHANCEMENT RESULTS: Found ${enhancedComps.length} additional authentic comparables`);
      return enhancedComps;

    } catch (error) {
      console.log(`❌ Enhancement search error: ${error}`);
      return [];
    }
  }

  // Helper method to calculate distance between two lat/lon points
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceInKm = R * c; // Distance in kilometers
    const distanceInMiles = distanceInKm * 0.621371; // Convert to miles
    return distanceInMiles;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

// Export the storage instance for use in routes
export const storage = new MemStorage();
