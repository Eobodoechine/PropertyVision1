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

      // Step 3: Find Comparables (with staged escalation per user spec)
      console.log(`\n🔍 STEP 3: FINDING COMPARABLES`);
      console.log(`============================================================`);

      // Escalation sequence:
      // 6mo@1mi → 12mo@1mi → 12mo@2mi → 24mo@1mi → 24mo@2mi → 24mo@3mi
      const searchPlan: Array<{ months: number; radius: number; label: string }> = [
        { months: 6, radius: 1.0, label: '6 months @ 1 mile' },
        { months: 12, radius: 1.0, label: '12 months @ 1 mile' },
        { months: 12, radius: 2.0, label: '12 months @ 2 miles' },
        { months: 24, radius: 1.0, label: '24 months @ 1 mile' },
        { months: 24, radius: 2.0, label: '24 months @ 2 miles' },
        { months: 24, radius: 3.0, label: '24 months @ 3 miles' },
      ];

      // Accumulate unique comps across stages by address
      const compMap: Map<string, any> = new Map();
      let lastSuccessError: string | undefined;

      for (const step of searchPlan) {
        console.log(`\n🔎 Attempting search: ${step.label}`);
        const res = await this.comparableService.findComparables(
          address,
          geocodingResult.lat,
          geocodingResult.lon,
          step.radius,
          10,              // max results
          step.months,     // time window
          propertyDetails.beds,
          propertyDetails.baths,
          propertyDetails.sqft,
          propertyDetails.yearBuilt,
          propertyDetails.propertyType
        );

        if (!res.success) {
          lastSuccessError = res.error;
          console.log(`   ⚠️ Search failed: ${res.error}`);
          continue;
        }

        console.log(`   ✅ Found ${res.comparables.length} comparables at ${step.label}`);

        // Merge into accumulator (carry forward across stages)
        for (const c of res.comparables) {
          if (!compMap.has(c.address)) compMap.set(c.address, c);
        }

        // Proceed as soon as aggregate meets threshold (≥3)
        if (compMap.size >= 3) {
          console.log(`   🎯 Threshold met (≥3 comps). Proceeding with ARV.`);
          break;
        }
      }

      const comparables = Array.from(compMap.values());
      if (comparables.length === 0) {
        const msg = lastSuccessError || 'No comparable properties found after staged expansion.';
        throw new Error(`${msg} Cannot calculate ARV without comparable sales data.`);
      }

      console.log(`✅ Final comparable set size (aggregated): ${comparables.length}`);

      // Step 4: ARV Calculation
      console.log(`\n💰 STEP 4: ARV CALCULATION`);
      console.log(`============================================================`);
      
      let standardARV: any = null;
      let weightedARV: any = null;
      let confidence = 'low';

      console.log(`📊 Calculating ARV using ${comparables.length} comparables`);
      standardARV = this.arvService.calculateARV(
        comparables,
        propertyDetails.sqft,
        propertyDetails.baths ?? null
      );

      // With staged comparable search completed, no additional ARV escalation needed here
      
      // Determine overall confidence based on ARV calculation result
      confidence = standardARV.confidence;

      // Final Results
      console.log(`\n📋 FINAL ANALYSIS RESULTS`);
      console.log(`============================================================`);
      console.log(`🏠 Property: ${address}`);
      console.log(`📍 Location: ${geocodingResult.lat}, ${geocodingResult.lon}`);
      console.log(`📏 Details: ${propertyDetails.sqft || 'Unknown'} sqft, ${propertyDetails.beds || 'Unknown'}bd/${propertyDetails.baths || 'Unknown'}ba`);
      console.log(`📊 Comparables: ${comparables.length} found`);
      
      if (standardARV) {
        console.log(`💰 ARV Estimate:`);
        console.log(`   ${standardARV.method}: $${standardARV.arv.toLocaleString()}`);
        console.log(`   Recommended: $${standardARV.arv.toLocaleString()}`);
      }
      // Print comparables for verification
      try {
        console.log(`\n=== COMPARABLES USED ===`);
        comparables.forEach((c, i) => {
          console.log(`${i + 1}. ${c.address} | $${Number(c.price).toLocaleString()} | ${c.sqft || 'N/A'} sqft | ${c.beds}bd/${c.baths}ba | Built ${c.yearBuilt || 'N/A'} | ${c.soldDate || 'N/A'} | ${typeof c.distance === 'number' ? c.distance.toFixed(2) + ' mi' : 'N/A'} | ${c.source || ''}`);
        });
      } catch {}
      
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
