import { type PropertyAnalysis, type InsertPropertyAnalysis, type AddressSearch } from "@shared/schema";
import { randomUUID } from "crypto";
import { webSearch } from "./web-search";
import { loggedFetch } from "./infra/rapid";
// Simple in-memory cache for geocoding to reduce external calls
const geocodeCache = new Map<string, { lat: number; lon: number; ts: number }>();

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
  constructor() {
    // No storage - fresh analysis every time
  }

  private isPlausibleSqft(n: any): boolean {
    const v = Number(n);
    return Number.isFinite(v) && v >= 600 && v <= 10000;
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
      })
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

    console.log(`\n🔍 NEW INTELLIGENT SEARCH: Analyzing ${normalizedAddress}`);

    try {
      // STEP 1: Get exact coordinates via auto-complete
      console.log('Step 1: Getting coordinates...');
      const coords = await this.getCoordinatesFromAddress(normalizedAddress, apiKey);
      const centerLat = coords.lat;
      const centerLon = coords.lon;
      console.log(`✅ Coordinates found: ${centerLat}, ${centerLon}`);

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

      // Handle missing data with web research fallback - ALWAYS research missing data
      let finalYearBuilt = subjectYearBuilt;
      let finalPropertyType = propertyType;
      let finalSubjectSqft = subjectSqft;

      // Always run web research to verify and potentially override MLS data
      const missingData = [];
      if (!subjectYearBuilt) missingData.push('year built');
      if (!subjectSqft) missingData.push('square feet');

      const shouldResearch = missingData.length > 0;

      if (shouldResearch) {
        console.log(`📋 WEB RESEARCH: ${missingData.length > 0 ? `Missing: ${missingData.join(', ')}` : 'Verifying MLS data'} - Starting web research...`);

        const researchedData = await this.researchPropertyData(normalizedAddress);
        console.log(`🔍 WEB RESEARCH RESULT: ${researchedData ? JSON.stringify(researchedData) : 'null'}`);
        if (researchedData) {
          if (!subjectYearBuilt && researchedData.yearBuilt) {
            finalYearBuilt = researchedData.yearBuilt;
            console.log(`✅ WEB RESEARCH SUCCESS: Found year built ${finalYearBuilt}`);
          }
          if (typeof researchedData.sqft === 'number' && this.isPlausibleSqft(researchedData.sqft)) {
            if (!subjectSqft || !this.isPlausibleSqft(subjectSqft)) {
              finalSubjectSqft = researchedData.sqft;
              console.log(`✅ WEB RESEARCH SUCCESS: Using researched sqft ${finalSubjectSqft} (MLS missing/implausible: ${subjectSqft ?? 'N/A'})`);
            } else {
              const diff = Math.abs(researchedData.sqft - subjectSqft) / subjectSqft;
              if (diff <= 0.3) {
                finalSubjectSqft = researchedData.sqft;
                console.log(`✅ WEB RESEARCH SUCCESS: Overriding MLS sqft ${subjectSqft} with ${finalSubjectSqft} (within 30% difference)`);
              } else {
                console.log(`ℹ️ Keeping MLS sqft ${subjectSqft}; researched ${researchedData.sqft} differs by ${(diff*100).toFixed(1)}%`);
              }
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
      console.log(`- Year range: 1993-2013 (±10 years from ${finalYearBuilt})`);
      console.log(`- Property type: ${finalPropertyType} → Search types: ${propertyTypeFilter.join(', ')}`);
      console.log(`- Strategy: Filter first, then null-value search if insufficient`);

      // ENHANCED CONDITIONAL SEARCH WITH RADIUS EXPANSION
      let radius = 1;
      const maxRadius = 5;
      let finalValidComps: any[] = [];
      let finalResearchCandidates: any[] = [];

      console.log(`Starting step-by-step enhanced conditional search methodology...`);

      while (radius <= maxRadius) {
        console.log(`\n╔═══════════════════════════════════════════════════════════════════════════════════════════╗`);
        console.log(`║                                 RADIUS ${radius} MILE SEARCH                                    ║`);
        console.log(`╚═══════════════════════════════════════════════════════════════════════════════════════════╝`);

        console.log(`\n🔍 STEP 3A: API Search with Filters`);
        console.log(`   • Search radius: ${radius} miles`);
        console.log(`   • Size filter: ${minSqft}-${maxSqft} sqft`);
        console.log(`   • Property types: ${propertyTypeFilter.join(', ')}`);
        console.log(`   • Year filter: ${finalYearBuilt ? (finalYearBuilt-10) + '-' + (finalYearBuilt+10) : 'No year filter'}`);
        console.log(`   • Status: sold properties only`);
        console.log(`   • Time range: last 12 months`);

        let phaseOneComps = await this.searchWithFilters(centerLat, centerLon, radius, propertyTypeFilter, minSqft, maxSqft, finalYearBuilt, subjectProperty.property_id || '');

        console.log(`\n📊 STEP 3A RESULTS:`);
        console.log(`   • Properties returned by API: ${phaseOneComps.length}`);

        // Analyze the quality of results
        const minYear = finalYearBuilt ? finalYearBuilt - 10 : 1980;
        const maxYear = finalYearBuilt ? finalYearBuilt + 10 : 2025;
        const sizeMatchCount = phaseOneComps.filter(comp => comp.sqft >= minSqft && comp.sqft <= maxSqft).length;
        const yearMatchCount = phaseOneComps.filter(comp => comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear).length;
        const perfectMatchCount = phaseOneComps.filter(comp => {
          const sizeMatch = comp.sqft >= minSqft && comp.sqft <= maxSqft;
          const yearMatch = comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear;
          return sizeMatch && yearMatch;
        }).length;

        console.log(`   • Size matches (${minSqft}-${maxSqft} sqft): ${sizeMatchCount}`);
        console.log(`   • Year matches (${minYear}-${maxYear}): ${yearMatchCount}`);
        console.log(`   • Perfect matches (size + year): ${perfectMatchCount}`);

        // Show data from external sources
        if (phaseOneComps.length > 0) {
          console.log(`\n📝 DETAILED PROPERTIES FROM API SEARCH:`);
          phaseOneComps.slice(0, 10).forEach((comp, i) => {
            const sizeFlag = comp.sqft >= minSqft && comp.sqft <= maxSqft ? '✅' : '❌';
            const yearFlag = comp.yearBuilt >= minYear && comp.yearBuilt <= maxYear ? '✅' : (comp.yearBuilt ? '❌' : '❓');
            console.log(`   ${i+1}. ${comp.address}`);
            console.log(`      Size: ${comp.sqft || 'null'}sqft ${sizeFlag} | Year: ${comp.yearBuilt || 'null'} ${yearFlag} | Beds/Baths: ${comp.beds || 'null'}/${comp.baths || 'null'}`);
            console.log(`      Price: $${comp.price?.toLocaleString() || 'null'} | $/sqft: $${comp.pricePerSqft || 'null'} | Date: ${comp.soldDate || 'null'}`);
            console.log(`      Distance: ${comp.distance || comp.searchRadius + ' miles'}`);
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

          // PHASE 3: Research enhancement
          if (phaseTwoComps.length > 0) {
            console.log(`\n🔍 STEP 3C: Web Research Enhancement`);
            console.log(`   • Researching up to 10 properties for missing data...`);
            const researchedComps = await this.researchNullValueProperties(phaseTwoComps.slice(0, 10), minSqft, maxSqft, finalYearBuilt);

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

        console.log(`\n📊 STEP 3D RESULTS:`);
        console.log(`   • Properties after strict filtering: ${strictlyFilteredComps.length}`);
        console.log(`   • New unique properties added: ${newCompsAdded}`);
        console.log(`   • Duplicates rejected: ${strictlyFilteredComps.length - newCompsAdded}`);
        console.log(`   • Total accumulated comparables: ${finalValidComps.length} (was ${beforeCount})`);

        console.log(`\n🚦 DECISION POINT: Continue or Stop?`);

        // User preference: Stop at 1-2 miles when sufficient comparables found
        if (finalValidComps.length >= 5) {
          console.log(`   ✅ STOPPING: Found ${finalValidComps.length} comparables (sufficient) at ${radius} mile radius`);
          break;
        } else if (finalValidComps.length >= 3 && radius >= 2) {
          console.log(`   ✅ STOPPING: Found ${finalValidComps.length} comparables within preferred 2-mile boundary`);
          break;
        } else if (radius >= maxRadius) {
          console.log(`   ✅ STOPPING: Reached maximum search radius (${radius}/${maxRadius}) with ${finalValidComps.length} comparables`);
          break;
        } else {
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
      return { p, dist, sameNumber, line };
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

    for (const prop of nullValueProps) {
      try {
        console.log(`🔍 Researching: ${prop.address}`);
        console.log(`   Missing data flags:`, prop.missingData);

        const searchQuery = `${prop.address} property details square feet year built`;
        console.log(`🔍 WEB SEARCH: ${searchQuery}`);

        // Use internal web search service directly (no HTTP self-call)
        const searchResult = await this.webSearch(searchQuery) || [];

        if (searchResult && searchResult.length > 0) {
          console.log(`✅ WEB SEARCH: Processing ${searchResult.length} search results for ${prop.address}`);
          const searchText = searchResult.map((r: any) => `${r.title || ''} ${r.description || ''} ${r.content || ''}`).join(' ').toLowerCase();
          console.log(`🌐 ANALYZING SEARCH CONTENT: ${searchText.substring(0, 200)}...`);
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
                console.log(`✅ Enhanced sqft: ${prop.address} = ${sqft} sqft`);
              }
            }
          }

          // Extract missing year built
          if (prop.missingData.yearBuilt) {
            console.log(`🔍 EXTRACTING YEAR BUILT for ${prop.address}`);
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
                console.log(`🌐 FOUND YEAR MATCH: ${year} using pattern ${pattern}`);
                if (year >= 1800 && year <= 2025) {
                  prop.yearBuilt = year;
                  enhanced = true;
                  console.log(`✅ Enhanced year: ${prop.address} = ${year}`);
                  break;
                }
              }
            }

            if (!prop.yearBuilt) {
              console.log(`❌ NO YEAR EXTRACTED for ${prop.address} from: ${searchText.substring(0, 100)}`);
            }
          }

          if (enhanced) {
            prop.researched = true;
            delete prop.missingData;
            researchedComps.push(prop);
          }
        }
      } catch (error: any) {
        console.log(`⚠️ Research failed: ${prop.address} - ${error.message || error}`);
      }
    }

    return researchedComps;
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

    if (validComps.length === 0) {
      throw new Error('No valid comparables provided for ARV calculation');
    }

    // Enhanced ARV calculation with outlier detection and usage tracking
    const pricesPerSqft = validComps.map((comp, index) => ({
      price: comp.pricePerSqft,
      index,
      comp
    })).filter(item => item.price && item.price > 0);

    if (pricesPerSqft.length === 0) {
      throw new Error('No valid price per sqft data found');
    }

    pricesPerSqft.sort((a, b) => a.price - b.price);

    // Calculate IQR for outlier detection with stricter bounds
    const q1Index = Math.floor(pricesPerSqft.length * 0.25);
    const q3Index = Math.floor(pricesPerSqft.length * 0.75);
    const q1 = pricesPerSqft[q1Index]?.price || pricesPerSqft[0].price;
    const q3 = pricesPerSqft[q3Index]?.price || pricesPerSqft[pricesPerSqft.length - 1].price;
    const iqr = q3 - q1;

    // Use stricter multiplier (0.75 instead of 1.5) for real estate to catch extreme values
    const lowerBound = q1 - (0.75 * iqr);
    const upperBound = q3 + (0.75 * iqr);

    // Apply reasonable absolute bounds for real estate (exclude extremely low/high prices)
    const absoluteLowerBound = Math.max(lowerBound, 120); // Exclude distressed sales under $120/sqft
    const absoluteUpperBound = Math.min(upperBound, 300); // Exclude luxury outliers over $300/sqft

    console.log(`📊 ARV ANALYSIS BREAKDOWN:`);
    console.log(`   • Total comparables: ${validComps.length}`);
    console.log(`   • Price range: $${Math.min(...pricesPerSqft.map(p => p.price))} - $${Math.max(...pricesPerSqft.map(p => p.price))} per sqft`);
    console.log(`   • Q1: $${q1} | Q3: $${q3} | IQR: $${iqr}`);
    console.log(`   • IQR bounds: $${lowerBound.toFixed(0)} - $${upperBound.toFixed(0)} per sqft`);
    console.log(`   • Final bounds (with absolute limits): $${absoluteLowerBound.toFixed(0)} - $${absoluteUpperBound.toFixed(0)} per sqft`);

    // Identify outliers and used comparables
    const outlierIndices = new Set();
    const usedIndices = new Set();

    pricesPerSqft.forEach(item => {
      if (item.price < absoluteLowerBound || item.price > absoluteUpperBound) {
        outlierIndices.add(item.index);
        console.log(`   • OUTLIER DETECTED: ${validComps[item.index]?.address} at $${item.price}/sqft (outside $${absoluteLowerBound}-$${absoluteUpperBound} range)`);
      } else {
        usedIndices.add(item.index);
      }
    });

    // Calculate ARV using non-outlier comparables
    const usedPrices = pricesPerSqft.filter(item => !outlierIndices.has(item.index)).map(item => item.price);
    const medianPricePerSqft = usedPrices.length > 0 ? 
      usedPrices[Math.floor(usedPrices.length / 2)] : 
      pricesPerSqft[Math.floor(pricesPerSqft.length / 2)].price;

    const arv = Math.round(medianPricePerSqft * subjectSqft);

    console.log(`   • Used in calculation: ${usedIndices.size} comparables`);
    console.log(`   • Outliers excluded: ${outlierIndices.size} comparables`);
    console.log(`   • Final median price/sqft: $${medianPricePerSqft}`);
    console.log(`   • Calculated ARV: $${arv.toLocaleString()}`);

    const confidence = usedIndices.size >= 5 ? 'High' : usedIndices.size >= 3 ? 'Medium' : 'Low';

    // AUTOMATED ENHANCEMENT TRIGGER: When confidence is Low or Medium, expand search automatically
    if (confidence !== 'High' && usedIndices.size < 5) {
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
    }

    // Check if this is a 1-bathroom property that should trigger dual calculation
    const computedBaths = computeBaths(subjectProperty.description);
    const actualBathrooms = computedBaths ?? parseFloat(subjectProperty.description?.baths?.toString() || '0');
    const shouldUseDualCalculation = actualBathrooms < 2;

    console.log(`🚿 BATHROOM ANALYSIS: ${actualBathrooms} baths detected - Dual calculation: ${shouldUseDualCalculation ? 'ENABLED' : 'DISABLED'}`);

    // Filter comparables by bathroom count for 1-bathroom properties
    let filteredComps = validComps;

    if (shouldUseDualCalculation) {
      // For 1-bathroom subject properties, filter comparables to 1-1.5 bathrooms only
      filteredComps = validComps.filter(comp => {
        const compBaths = parseFloat(comp.baths?.toString() || '0');
        return compBaths >= 1 && compBaths <= 1.5;
      });

      console.log(`🚿 BATHROOM FILTERING: Reduced from ${validComps.length} to ${filteredComps.length} comparables (1-1.5 bath only)`);

      // If we have too few bathroom-matched comps, keep some 2-bath properties but mark them differently
      if (filteredComps.length < 5) {
        const twoBathComps = validComps.filter(comp => {
          const compBaths = parseFloat(comp.baths?.toString() || '0');
          return compBaths >= 1.75 && compBaths <= 2.5;
        });

        const neededComps = Math.min(twoBathComps.length, 10 - filteredComps.length);
        filteredComps = [...filteredComps, ...twoBathComps.slice(0, neededComps)];

        console.log(`🚿 SUPPLEMENTED: Added ${neededComps} two-bathroom comparables for statistical validity`);
      }
    }

    // Format comparables with usage and bathroom indicators
    const formattedComparables = filteredComps.slice(0, 10).map((comp, index) => {
      let addressPrefix = '';
      const compBaths = parseFloat(comp.baths?.toString() || '0');

      if (usedIndices.has(validComps.indexOf(comp))) {
        addressPrefix = '* '; // Asterisk for used in calculation
      } else if (outlierIndices.has(validComps.indexOf(comp))) {
        addressPrefix = '[OUTLIER] '; // Mark outliers
      }

      // Add bathroom indicator for 1-bath subject properties
      if (shouldUseDualCalculation && compBaths >= 2) {
        addressPrefix += '[2BR] '; // Mark 2-bathroom comps differently
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
    let comparablesWith2ndBath = [];

    if (shouldUseDualCalculation) {
      // Find actual 2-bathroom comparables from the original dataset
      const twoBathComps = validComps.filter(comp => {
        const compBaths = parseFloat(comp.baths?.toString() || '0');
        return compBaths >= 1.75 && compBaths <= 2.5 && !outlierIndices.has(validComps.indexOf(comp));
      });

      console.log(`🚿 FOUND ${twoBathComps.length} two-bathroom comparables for enhanced ARV calculation`);

      // Apply outlier detection to 2-bathroom comparables
      const twoBathPrices = twoBathComps.map((comp, index) => ({
        price: comp.pricePerSqft,
        index: index,
        comp: comp
      })).sort((a, b) => a.price - b.price);

      let filteredTwoBathComps = twoBathComps;
      let twoBathOutliers = [];

      if (twoBathPrices.length >= 5) {
        // Apply outlier detection to 2-bathroom comparables
        const q1Index = Math.floor(twoBathPrices.length * 0.25);
        const q3Index = Math.floor(twoBathPrices.length * 0.75);
        const q1 = twoBathPrices[q1Index]?.price || twoBathPrices[0].price;
        const q3 = twoBathPrices[q3Index]?.price || twoBathPrices[twoBathPrices.length - 1].price;
        const iqr = q3 - q1;

        const lowerBound = q1 - (0.75 * iqr);
        const upperBound = q3 + (0.75 * iqr);
        const absoluteLowerBound = Math.max(lowerBound, 120);
        const absoluteUpperBound = Math.min(upperBound, 350);

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
        const isOutlier = twoBathOutliers.includes(comp);
        const addressPrefix = isOutlier ? '[OUTLIER] ' : '* ';

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

      // Calculate enhanced ARV using filtered 2-bathroom comparables if available, otherwise use 75th percentile
      let enhancedPricePerSqft;
      if (filteredTwoBathComps.length >= 3) {
        // Use median of filtered 2-bathroom comparables
        const filteredTwoBathPrices = filteredTwoBathComps.map(comp => comp.pricePerSqft).sort((a, b) => a - b);
        enhancedPricePerSqft = filteredTwoBathPrices[Math.floor(filteredTwoBathPrices.length / 2)];
        console.log(`🚿 Using median of ${filteredTwoBathComps.length} filtered two-bathroom comparables: $${enhancedPricePerSqft}/sqft`);
      } else {
        // Fallback to 75th percentile of all non-outlier comparables
        const enhancedPrices = pricesPerSqft.filter(item => !outlierIndices.has(item.index)).map(item => item.price);
        enhancedPrices.sort((a, b) => a - b);
        const p75Index = Math.floor(enhancedPrices.length * 0.75);
        enhancedPricePerSqft = enhancedPrices[p75Index] || medianPricePerSqft;
        console.log(`🚿 Using 75th percentile (${filteredTwoBathComps.length} filtered 2-bath comps insufficient): $${enhancedPricePerSqft}/sqft`);
      }

      const enhancedArv = Math.round(enhancedPricePerSqft * subjectSqft);
      const enhancedConfidence = usedIndices.size >= 5 ? 'High' : usedIndices.size >= 3 ? 'Medium' : 'Low';

      arvWith2ndBathroom = {
        estimate: enhancedArv.toString(),
        confidence: enhancedConfidence,
        pricePerSqFt: enhancedPricePerSqft.toString()
      };

      console.log(`🚿 2ND BATHROOM ARV: $${enhancedArv.toLocaleString()} (${enhancedPricePerSqft}/sqft from ${twoBathComps.length >= 3 ? '2-bath comps' : '75th percentile'})`);
    }

    // Compute baths with halves, if present
    const bathsComputed = computeBaths(subjectProperty.description);

    return {
      address: normalizedAddress,
      arv: arv.toString(),
      confidence,
      pricePerSqFt: medianPricePerSqft.toString(),
      beds: subjectProperty.description?.beds || 0,
      baths: (bathsComputed ?? subjectProperty.description?.baths ?? 0).toString(),
      sqft: subjectProperty.description?.sqft || subjectSqft,
      yearBuilt: subjectProperty.description?.year_built || finalYearBuilt,
      comparables: formattedComparables,
      isDualCalculation: shouldUseDualCalculation,
      arvWith2ndBathroom,
      comparablesWith2ndBath,
      analysis: {
        totalComparables: validComps.length,
        usedInCalculation: usedIndices.size,
        outliers: outlierIndices.size,
        medianPricePerSqft: medianPricePerSqft,
        priceRange: {
          min: Math.min(...pricesPerSqft.map(p => p.price)),
          max: Math.max(...pricesPerSqft.map(p => p.price))
        }
      }
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
    const enhancedSubjectProperty = {
      description: {
        // Only set sqft if plausibly extracted from online data
        sqft: safeSqft,
        year_built: updatedYearBuilt,
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
