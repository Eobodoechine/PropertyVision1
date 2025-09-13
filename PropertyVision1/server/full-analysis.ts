import { GeocodingService } from './step1-geocoding';
import { PropertyResearchService } from './step2-property-research';
import { ComparableSearchService } from './step3-find-comparables';
import { ARVCalculationService } from './step4-arv-calculation';
import { deriveOutlierSets } from './utils/outlier-utils';
import { ANALYZER_VERSION } from './utils/version';
import type { ComparableProperty, PropertyDetails, ARVResult } from '../shared/types';

interface FullAnalysisResult {
  address: string;
  coordinates: { lat: number; lon: number };
  propertyDetails: PropertyDetails;
  comparables: {
    original: ComparableProperty[];
    glaBucketed: ComparableProperty[];
    keptForARV: ComparableProperty[];
    excluded: Array<ComparableProperty & { reasonFlags: string[] }>;
  };
  arv: ARVResult;
  confidence: string;
  timestamp: string;
  metadata: {
    subjectSqft: number;
    version: string;
  };
}

class FullAnalysisService {
  private geocodingService: GeocodingService;
  private researchService: PropertyResearchService;
  private comparableService: ComparableSearchService;
  private arvService: ARVCalculationService;

  constructor() {
    this.geocodingService = new GeocodingService();
    this.researchService = new PropertyResearchService();
    this.comparableService = new ComparableSearchService();
    this.arvService = new ARVCalculationService();
  }

  async runFullAnalysis(address: string): Promise<FullAnalysisResult> {
    console.log(`\n🏠 FULL PROPERTY ANALYSIS`);
    console.log(`============================================================`);
    console.log(`📍 Analyzing: ${address}`);
    console.log(`⏰ Started: ${new Date().toISOString()}`);
    console.log(`============================================================`);

    try {
      // Step 1: Geocoding
      console.log(`\n📍 STEP 1: GEOCODING`);
      console.log(`============================================================`);
      const geocodingResult = await this.geocodingService.geocodeAddress(address);
      
      if (!geocodingResult.success) {
        throw new Error(`Geocoding failed: ${geocodingResult.error}`);
      }

      console.log(`✅ Coordinates: ${geocodingResult.lat}, ${geocodingResult.lon}`);

      // Step 2: Property Research (with retry logic)
      console.log(`\n🔍 STEP 2: PROPERTY RESEARCH`);
      console.log(`============================================================`);
      
      let propertyDetails: any = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          console.log(`🔍 Attempt ${retryCount + 1}/${maxRetries}...`);
          propertyDetails = await this.researchService.researchProperty(address);
          
          if (propertyDetails.success) {
            break; // Success, exit retry loop
          } else {
            throw new Error(`Property research failed: ${propertyDetails.error}`);
          }
        } catch (error) {
          retryCount++;
          console.log(`❌ Attempt ${retryCount} failed: ${error.message}`);
          
          if (retryCount < maxRetries) {
            const delaySeconds = retryCount * 5 + 5; // 5s, 10s, 15s delays
            console.log(`🔄 Retrying in ${delaySeconds} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
          } else {
            throw new Error(`Property research failed after ${maxRetries} attempts: ${error.message}. Cannot proceed with ARV calculation without property details.`);
          }
        }
      }
      
      if (!propertyDetails) {
        throw new Error(`Property research failed after ${maxRetries} attempts. Cannot proceed with ARV calculation without property details.`);
      }

      // Validate essential property details for ARV calculation
      if (!propertyDetails.sqft || propertyDetails.sqft <= 0) {
        throw new Error(`Missing or invalid square footage (${propertyDetails.sqft}). ARV calculation requires valid square footage.`);
      }

      console.log(`✅ Property Details:`);
      console.log(`   Square Feet: ${propertyDetails.sqft}`);
      console.log(`   Beds/Baths: ${propertyDetails.beds || 'Unknown'}/${propertyDetails.baths || 'Unknown'}`);
      console.log(`   Year Built: ${propertyDetails.yearBuilt || 'Unknown'}`);

      // Step 3: Find Comparables
      console.log(`\n🔍 STEP 3: FINDING COMPARABLES`);
      console.log(`============================================================`);
      const comparableResult = await this.comparableService.findComparables(
        address,
        geocodingResult.lat,
        geocodingResult.lon,
        1.0, // 1 mile radius
        10,  // max 10 results
        24,  // 24 months time window
        propertyDetails.beds,
        propertyDetails.baths,
        propertyDetails.sqft,
        propertyDetails.yearBuilt,
        propertyDetails.propertyType
      );

      if (!comparableResult.success) {
        console.log(`⚠️ Comparable search failed: ${comparableResult.error}`);
      }

      let comparables = comparableResult.comparables;
      console.log(`✅ Found ${comparables.length} comparable properties`);

      // Step 4: ARV Calculation
      console.log(`\n💰 STEP 4: ARV CALCULATION`);
      console.log(`============================================================`);
      
      const subjectSqft = propertyDetails.sqft ?? 0;
      const arvService = new ARVCalculationService();

      if (comparables.length === 0) {
        throw new Error(`No comparable properties found. Cannot calculate ARV without comparable sales data.`);
      }

      console.log(`📊 Calculating ARV using ${comparables.length} comparables`);
      const standardARV = arvService.calculateARV(comparables as ComparableProperty[], subjectSqft);

      // Build audit sets for transparency (kept/excluded with reasons)
      const sets = deriveOutlierSets(arvService, comparables as ComparableProperty[], subjectSqft);

      // Confidence mirrors the ARV result
      const confidence = standardARV.confidence;

      // Final Results
      console.log(`\n📋 FINAL ANALYSIS RESULTS`);
      console.log(`============================================================`);
      console.log(`🏠 Property: ${address}`);
      console.log(`📍 Location: ${geocodingResult.lat}, ${geocodingResult.lon}`);
      console.log(`📏 Details: ${propertyDetails.sqft || 'Unknown'} sqft, ${propertyDetails.beds || 'Unknown'}bd/${propertyDetails.baths || 'Unknown'}ba`);
      console.log(`📊 Comparables: ${comparables.length} found`);

      console.log(`\n💰 ARV Estimate`);
      console.log(`   Method: ${standardARV.method}`);
      console.log(`   Point : $${Math.round(standardARV.arv).toLocaleString()}`);
      if (typeof standardARV.low === "number" && typeof standardARV.high === "number") {
        console.log(`   Range : $${Math.round(standardARV.low).toLocaleString()} - $${Math.round(standardARV.high).toLocaleString()}`);
      }
      if (standardARV.coreComps?.length) {
        console.log(`\n🔎 Core Comps Used (${standardARV.coreComps.length})`);
        standardARV.coreComps.forEach((c, i) =>
          console.log(`   ${i + 1}. ${c.address} — $${c.ppsf.toFixed(2)}/sf → $${Math.round(c.indication).toLocaleString()} (score ${Math.round(c.score)})`)
        );
      }

      console.log(`\n🎯 Confidence: ${standardARV.confidence.toUpperCase()}`);
      console.log(`⏰ Completed: ${new Date().toISOString()}`);

      return {
        address,
        coordinates: { lat: geocodingResult.lat, lon: geocodingResult.lon },
        propertyDetails,
        comparables: {
          original: comparables as ComparableProperty[],
          glaBucketed: sets.glaBucketed,
          keptForARV: sets.keptForARV,
          excluded: sets.excluded
        },
        arv: { ...standardARV, version: ANALYZER_VERSION },
        confidence,
        timestamp: new Date().toISOString(),
        metadata: {
          subjectSqft,
          version: ANALYZER_VERSION
        }
      };

    } catch (error) {
      console.error(`❌ Analysis failed: ${error.message}`);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const address = process.env.ADDRESS;
  if (!address) {
    throw new Error('ADDRESS environment variable is required');
  }
  
  console.log(`🚀 Starting full property analysis...`);
  
  const analysisService = new FullAnalysisService();
  
  try {
    const result = await analysisService.runFullAnalysis(address);
    
    console.log(`\n✅ Analysis completed successfully!`);
    console.log(`📊 Summary: ${result.comparables.original.length} comps, ${result.confidence} confidence`);
    console.log(`💰 ARV: $${result.arv.arv.toLocaleString()}`);
    
  } catch (error) {
    console.error(`❌ Analysis failed: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { FullAnalysisService, main };
export type { FullAnalysisResult };
