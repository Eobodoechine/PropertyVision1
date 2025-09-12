import { GoogleGenAI } from '@google/genai';

interface PropertyDetails {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  success: boolean;
  error?: string;
}

class PropertyResearchService {
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.client = new GoogleGenAI({ apiKey });
  }

  async researchProperty(address: string): Promise<PropertyDetails> {
    try {
      console.log(`🔍 RESEARCHING: ${address}`);
      
      const prompt = `Research the following property and provide detailed information:

Property Address: ${address}

Please provide the following information in a clear, structured format:
- Square Footage (sqft)
- Number of Bedrooms
- Number of Bathrooms  
- Year Built
- Lot Size (if available)

Use Google Search to find current, accurate information from reliable sources like:
- Zillow
- Realtor.com
- Redfin
- County assessor records
- MLS listings

Format your response clearly with each detail on a separate line.`;

      // Configure Gemini with Google Search grounding
      const groundingTool = {
        googleSearch: {},
      };

      const config = {
        tools: [groundingTool]
      };

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API call timeout after 30 seconds')), 30000);
      });

      const apiPromise = this.client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        config,
      });

      const result = await Promise.race([apiPromise, timeoutPromise]) as any;

      console.log(`   📡 Gemini response received`);
      const responseText = result.text;
      console.log(`   📄 Response length: ${responseText.length} characters`);
      
      // Parse the response
      const details = this.parsePropertyDetails(responseText, address);
      
      if (details.success) {
        console.log(`   ✅ Found property details:`, details);
      } else {
        console.log(`   ❌ Failed to parse property details: ${details.error}`);
      }
      
      return details;

    } catch (error) {
      console.error(`❌ Error researching property: ${error.message}`);
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

  private parsePropertyDetails(text: string, address: string): PropertyDetails {
    console.log(`   🔍 DEBUG: Parsing text: ${text.substring(0, 200)}...`);
    
    let sqft: number | null = null;
    let beds: number | null = null;
    let baths: number | null = null;
    let yearBuilt: number | null = null;
    let lotSize: number | null = null;

    try {
      // Square footage patterns
      const sqftPatterns = [
        /\*\s+\*\*Square\s*Footage\s*\(sqft\):\*\*\s*(\d{1,3}(?:,\d{3})*)\s*sqft/gi,
        /Square\s*Footage[:\s]*(\d{1,3}(?:,\d{3})*)\s*sqft/gi,
        /(\d{1,3}(?:,\d{3})*)\s*sqft/gi
      ];

      for (const pattern of sqftPatterns) {
        const match = pattern.exec(text);
        if (match) {
          sqft = parseInt(match[1].replace(/,/g, ''));
          console.log(`   🔍 DEBUG: Found sqft: ${sqft} from pattern: ${pattern}`);
          break;
        }
      }

      // Bedrooms patterns
      const bedPatterns = [
        /\*\s+\*\*Number\s*of\s*Bedrooms:\*\*\s*(\d+)/gi,
        /Bedrooms?[:\s]*(\d+)/gi,
        /(\d+)\s*bed/gi
      ];

      for (const pattern of bedPatterns) {
        const match = pattern.exec(text);
        if (match) {
          beds = parseInt(match[1]);
          console.log(`   🔍 DEBUG: Found beds: ${beds} from pattern: ${pattern}`);
          break;
        }
      }

      // Bathrooms patterns
      const bathPatterns = [
        /\*\s+\*\*Number\s*of\s*Bathrooms:\*\*\s*(\d+(?:\.\d+)?)/gi,
        /Bathrooms?[:\s]*(\d+(?:\.\d+)?)/gi,
        /(\d+(?:\.\d+)?)\s*bath/gi
      ];

      for (const pattern of bathPatterns) {
        const match = pattern.exec(text);
        if (match) {
          baths = parseFloat(match[1]);
          console.log(`   🔍 DEBUG: Found baths: ${baths} from pattern: ${pattern}`);
          break;
        }
      }

      // Year built patterns
      const yearPatterns = [
        /\*\s+\*\*Year\s*Built:\*\*\s*(\d{4})/gi,
        /Year\s*Built[:\s]*(\d{4})/gi,
        /Built[:\s]*(\d{4})/gi
      ];

      for (const pattern of yearPatterns) {
        const match = pattern.exec(text);
        if (match) {
          yearBuilt = parseInt(match[1]);
          console.log(`   🔍 DEBUG: Found yearBuilt: ${yearBuilt} from pattern: ${pattern}`);
          break;
        }
      }

      // Lot size patterns
      const lotPatterns = [
        /\*\s+\*\*Lot\s*Size:\*\*\s*(\d{1,3}(?:,\d{3})*)\s*sqft/gi,
        /Lot\s*Size[:\s]*(\d{1,3}(?:,\d{3})*)\s*sqft/gi
      ];

      for (const pattern of lotPatterns) {
        const match = pattern.exec(text);
        if (match) {
          lotSize = parseInt(match[1].replace(/,/g, ''));
          console.log(`   🔍 DEBUG: Found lotSize: ${lotSize} from pattern: ${pattern}`);
          break;
        }
      }

      return {
        address,
        sqft,
        beds,
        baths,
        yearBuilt,
        lotSize,
        success: true
      };

    } catch (error) {
      console.error(`❌ Error parsing property details: ${error.message}`);
      return {
        address,
        sqft,
        beds,
        baths,
        yearBuilt,
        lotSize,
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
    throw new Error('ADDRESS environment variable is required');
  }
  
  console.log(`\n🔍 STEP 2: RESEARCHING SUBJECT PROPERTY`);
  console.log(`============================================================`);
  
  const researchService = new PropertyResearchService();
  const result = await researchService.researchProperty(address);
  
  if (result.success) {
    console.log(`✅ Property research successful:`);
    console.log(`   Address: ${result.address}`);
    console.log(`   Square Feet: ${result.sqft || 'Unknown'}`);
    console.log(`   Beds/Baths: ${result.beds || 'Unknown'}/${result.baths || 'Unknown'}`);
    console.log(`   Year Built: ${result.yearBuilt || 'Unknown'}`);
    console.log(`   Lot Size: ${result.lotSize || 'Unknown'}`);
  } else {
    console.log(`❌ Property research failed: ${result.error}`);
  }
  
  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testPropertyResearch().catch(console.error);
}

export { PropertyResearchService, testPropertyResearch };
export type { PropertyDetails };
