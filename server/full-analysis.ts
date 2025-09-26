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

    try {
      // Step 1: Geocoding
      const geocodingResult = await this.geocodingService.geocodeAddress(address);
      
      if (!geocodingResult.success) {
        throw new Error(`Geocoding failed: ${geocodingResult.error}`);
      }


      // Step 2: Property Research (with retry logic)
      
      let propertyDetails: any = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          propertyDetails = await this.researchService.researchProperty(address);
          
          if (propertyDetails.success) {
            break; // Success, exit retry loop
          } else {
            throw new Error(`Property research failed: ${propertyDetails.error}`);
          }
        } catch (error) {
          retryCount++;
          
          if (retryCount < maxRetries) {
            const delaySeconds = retryCount * 5 + 5; // 5s, 10s, 15s delays
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


      // Step 3: Find Comparables (with staged escalation per user spec)

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
        const subjectDetails = (propertyDetails?.sqft && propertyDetails?.beds && propertyDetails?.baths && propertyDetails?.yearBuilt)
          ? { sqft: propertyDetails.sqft, beds: propertyDetails.beds, baths: propertyDetails.baths, yearBuilt: propertyDetails.yearBuilt }
          : undefined;

        const res = await this.comparableService.findComparables(
          address,
          propertyDetails?.propertyType || undefined,
          50,                // max results to allow enough candidates
          step.radius,       // search radius (mi)
          step.months,       // time window (months)
          subjectDetails
        );

        if (!res.success) {
          lastSuccessError = res.error;
          continue;
        }


        // Merge into accumulator (carry forward across stages)
        for (const c of res.comparables) {
          if (!compMap.has(c.address)) compMap.set(c.address, c);
        }

        // Proceed as soon as aggregate meets threshold (≥3)
        if (compMap.size >= 3) {
          break;
        }
      }

      const comparables = Array.from(compMap.values());
      if (comparables.length === 0) {
        const msg = lastSuccessError || 'No comparable properties found after staged expansion.';
        throw new Error(`${msg} Cannot calculate ARV without comparable sales data.`);
      }


      // Step 4: ARV Calculation
      
      let standardARV: any = null;
      let weightedARV: any = null;
      let confidence = 'low';

      standardARV = this.arvService.calculateARV(
        comparables,
        propertyDetails.sqft,
        propertyDetails.baths ?? null
      );

      // With staged comparable search completed, no additional ARV escalation needed here
      
      // Determine overall confidence based on ARV calculation result
      confidence = standardARV.confidence;

      // Final Results
      
      if (standardARV) {
      }
      // Print comparables for verification
      try {
        comparables.forEach((c, i) => {
        });
      } catch {}
      

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
  
  
  const analysisService = new FullAnalysisService();
  
  try {
    const result = await analysisService.runFullAnalysis(address);
    
    
    if (result.arv.weighted) {
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
