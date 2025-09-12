import { GeocodingService } from './step1-geocoding';
import { PropertyResearchService } from './step2-property-research';
import { ComparableSearchService } from './step3-find-comparables';
import { ARVCalculationService } from './step4-arv-calculation';

interface FullAnalysisResult {
  address: string;
  coordinates: { lat: number; lon: number };
  propertyDetails: any;
  comparables: any[];
  arv: {
    standard: any;
    weighted: any;
  };
  confidence: string;
  timestamp: string;
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

      // Step 2: Property Research
      console.log(`\n🔍 STEP 2: PROPERTY RESEARCH`);
      console.log(`============================================================`);
      const propertyDetails = await this.researchService.researchProperty(address);
      
      if (!propertyDetails.success) {
        throw new Error(`Property research failed: ${propertyDetails.error}. Cannot proceed with ARV calculation without property details.`);
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
        10   // max 10 results
      );

      if (!comparableResult.success) {
        console.log(`⚠️ Comparable search failed: ${comparableResult.error}`);
      }

      const comparables = comparableResult.comparables;
      console.log(`✅ Found ${comparables.length} comparable properties`);

      // Step 4: ARV Calculation
      console.log(`\n💰 STEP 4: ARV CALCULATION`);
      console.log(`============================================================`);
      
      let standardARV = null;
      let weightedARV = null;
      let confidence = 'low';

      if (comparables.length === 0) {
        throw new Error(`No comparable properties found. Cannot calculate ARV without comparable sales data.`);
      }

      console.log(`📊 Calculating ARV using ${comparables.length} comparables`);
      standardARV = this.arvService.calculateARV(comparables, propertyDetails.sqft);
      weightedARV = this.arvService.calculateWeightedARV(comparables, propertyDetails.sqft);
      
      // Determine overall confidence
      if (comparables.length >= 4 && Math.max(standardARV.r2, weightedARV.r2) >= 0.8) {
        confidence = 'high';
      } else if (comparables.length >= 3 && Math.max(standardARV.r2, weightedARV.r2) >= 0.6) {
        confidence = 'medium';
      }

      // Final Results
      console.log(`\n📋 FINAL ANALYSIS RESULTS`);
      console.log(`============================================================`);
      console.log(`🏠 Property: ${address}`);
      console.log(`📍 Location: ${geocodingResult.lat}, ${geocodingResult.lon}`);
      console.log(`📏 Details: ${propertyDetails.sqft || 'Unknown'} sqft, ${propertyDetails.beds || 'Unknown'}bd/${propertyDetails.baths || 'Unknown'}ba`);
      console.log(`📊 Comparables: ${comparables.length} found`);
      
      if (standardARV && weightedARV) {
        console.log(`💰 ARV Estimates:`);
        console.log(`   Standard Regression: $${standardARV.arv.toLocaleString()} (R²: ${standardARV.r2.toFixed(3)})`);
        console.log(`   Distance-Weighted: $${weightedARV.arv.toLocaleString()} (R²: ${weightedARV.r2.toFixed(3)})`);
        console.log(`   Recommended: $${weightedARV.arv.toLocaleString()}`);
      }
      
      console.log(`🎯 Confidence: ${confidence.toUpperCase()}`);
      console.log(`⏰ Completed: ${new Date().toISOString()}`);

      return {
        address,
        coordinates: { lat: geocodingResult.lat, lon: geocodingResult.lon },
        propertyDetails,
        comparables,
        arv: {
          standard: standardARV,
          weighted: weightedARV
        },
        confidence,
        timestamp: new Date().toISOString()
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
    console.log(`📊 Summary: ${result.comparables.length} comps, ${result.confidence} confidence`);
    
    if (result.arv.weighted) {
      console.log(`💰 ARV: $${result.arv.weighted.arv.toLocaleString()}`);
    }
    
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
