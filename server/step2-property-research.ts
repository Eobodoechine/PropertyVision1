import 'dotenv/config';
import { fetchPropertyDetailsViaVertex } from './vertex-details';

interface PropertyDetails {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  subdivision?: string | null;
  propertyType?: string | null;
  success: boolean;
  error?: string;
}

class VertexPropertyResearchService {
  constructor() {
    // Verify service account is available
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
    if (!saPath) {
      throw new Error('GCP_SA_JSON environment variable is required for Vertex AI');
    }
  }

  async researchProperty(address: string): Promise<PropertyDetails> {
    try {

      // Use Vertex AI details fetcher
      const viaVertex = await fetchPropertyDetailsViaVertex(address);
      if (viaVertex) {
        const details: PropertyDetails = {
          address,
          sqft: viaVertex.sqft,
          beds: viaVertex.beds,
          baths: viaVertex.baths,
          yearBuilt: viaVertex.yearBuilt,
          lotSize: viaVertex.lotSize,
          subdivision: viaVertex.subdivision ?? null,
          success: true,
        };
        return details;
      }

      // If Vertex fails, return error
      return {
        address,
        sqft: null,
        beds: null,
        baths: null,
        yearBuilt: null,
        lotSize: null,
        success: false,
        error: 'Vertex AI research failed'
      };

    } catch (error: any) {
      return {
        address,
        sqft: null,
        beds: null,
        baths: null,
        yearBuilt: null,
        lotSize: null,
        success: false,
        error: error.message
      };
    }
  }
}

// Test function
async function testPropertyResearch() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error('❌ ADDRESS environment variable is required');
    process.exit(1);
  }


  const service = new VertexPropertyResearchService();
  const result = await service.researchProperty(address);

  if (result.success) {
  } else {
    if (result.error) {
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testPropertyResearch().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

export { VertexPropertyResearchService, type PropertyDetails };
// Backward-compatible alias to match existing imports
export { VertexPropertyResearchService as PropertyResearchService };
