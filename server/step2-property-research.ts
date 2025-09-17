import 'dotenv/config';
import { fetchPropertyDetailsViaVertex } from './vertex-details';

interface PropertyDetails {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
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
      console.log(`🔍 RESEARCHING: ${address}`);

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
          success: true,
        };
        console.log('   ✅ Vertex details:', details);
        return details;
      }

      // If Vertex fails, return error
      console.log('   ❌ Vertex AI research failed');
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
      console.log(`   ❌ Research failed: ${error.message}`);
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

  console.log('\n🔍 STEP 2: PROPERTY RESEARCH');
  console.log('============================================================');

  const service = new VertexPropertyResearchService();
  const result = await service.researchProperty(address);

  if (result.success) {
    console.log('✅ Property research completed successfully');
    console.log('Property Details:');
    console.log(`   Address: ${result.address}`);
    console.log(`   Square Feet: ${result.sqft || 'Unknown'}`);
    console.log(`   Bedrooms: ${result.beds || 'Unknown'}`);
    console.log(`   Bathrooms: ${result.baths || 'Unknown'}`);
    console.log(`   Year Built: ${result.yearBuilt || 'Unknown'}`);
    console.log(`   Lot Size: ${result.lotSize || 'Unknown'}`);
    console.log(`   Property Type: ${result.propertyType || 'Unknown'}`);
  } else {
    console.log('❌ Property research failed');
    if (result.error) {
      console.log(`   Error: ${result.error}`);
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