import { GoogleGenAI } from '@google/genai';
import { fetchPropertyDetailsViaVertex } from './vertex-details';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { groundedFreeform } from './vertex-freeform';

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
      // If REQUIRE_GROUNDED is set, use grounded freeform details (no fallback)
      if (process.env.REQUIRE_GROUNDED === '1') {
        const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
        if (!saPath) throw new Error('Set GCP_SA_JSON to your service account JSON path');
        const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8')) as any;
        // Mint access token (JWT flow)
        const iat = Math.floor(Date.now() / 1000), exp = iat + 3600;
        const header = { alg: 'RS256', typ: 'JWT' } as any;
        const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri, exp, iat } as any;
        const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
        const unsigned = `${b64(header)}.${b64(claims)}`;
        const sign = (crypto as any).createSign('RSA-SHA256');
        sign.update(unsigned);
        const assertion = `${unsigned}.${sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_')}`;
        const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
        const u = new URL(sa.token_uri);
        const tok: any = await new Promise((resolve, reject) => {
          const rq = (https as any).request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form).toString() } }, (rr: any) => {
            let data = '';
            rr.on('data', (c: any) => data += c);
            rr.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
          });
          rq.on('error', reject);
          rq.write(form);
          rq.end();
        });
        if (!tok?.access_token) throw new Error('sa-token-failed');
        const accessToken = tok.access_token as string;

        const projectId = sa.project_id;
        const location = process.env.VERTEX_LOCATION || 'us-central1';
        const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
        const prompt = `Facts only. No valuation or advice. Provide subject property facts with source links for: ${address}.\nFields: sqft, beds, baths, year built, lot size, subdivision (if known).`;
        const { text, response } = await groundedFreeform({ accessToken, projectId, location, model, prompt, maxOutputTokens: 1500 });
        // Parse minimal fields from freeform text
        const clean = (s: string) => s.replace(/,/g, '').trim();
        const num = (m: RegExpMatchArray | null) => (m ? Number(clean(m[1])) : null);
        // Capture numbers with optional commas, prefer non-lot context
        const sqftCandidates = Array.from(text.matchAll(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,5})\s*(?:sq\s*ft|sqft)/gi))
          .map((m: any) => ({ idx: m.index as number, val: Number(clean(m[1])) }));
        let sqft: number | null = null;
        for (const c of sqftCandidates) {
          const ctx = text.slice(Math.max(0, c.idx - 15), c.idx).toLowerCase();
          if (!/lot\s*size|\blot\b/.test(ctx)) { sqft = c.val; break; }
        }
        if (sqft == null && sqftCandidates.length) sqft = sqftCandidates[0].val;
        const beds = num(text.match(/\b(?:bedrooms?|beds?)\D*([0-9]{1,2})\b/i));
        const baths = (() => { const m = text.match(/\b(?:bathrooms?|baths?)\D*([0-9]+(?:\.[0-9]+)?)/i); return m ? Number(clean(m[1])) : null; })();
        const yearBuilt = num(text.match(/\b(?:year\s*built|built)\D*((?:19|20)[0-9]{2})\b/i));
        const lotSize = (() => {
          const m = text.match(/\b(?:lot\s*size|lot)\D*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,6})\s*(?:sq\s*ft|sqft)\b/i);
          return m ? Number(clean(m[1])) : null;
        })();
        // Infer property type from text
        const type = (() => {
          const t = text.toLowerCase();
          if (/town\s*house|townhome|row\s*house/.test(t)) return 'townhome';
          if (/single[-\s]*family|detached/.test(t)) return 'single_family';
          if (/condo|minium/.test(t)) return 'condo';
          if (/multi[-\s]*family|duplex|triplex|fourplex/.test(t)) return 'multi_family';
          return null;
        })();
        const details: PropertyDetails = { address, sqft, beds, baths, yearBuilt, lotSize, propertyType: type, success: true };
        console.log('   ✅ Grounded freeform details:', details);
        return details;
      }
      // Prefer Vertex multi-strategy retriever when SA is configured (legacy path)
      try {
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
      } catch {}
      
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

      // Fallback: Gemini with Google Search grounding (SDK)
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
      // Square footage patterns - handles both "sq ft" and "sqft"
      const sqftPatterns = [
        /\*\s+\*\*Square\s*Footage\s*\(sqft\):\*\*\s*(\d{1,3}(?:,\d{3})*)\s*sq\s*ft/gi,
        /Square\s*Footage[:\s]*(\d{1,3}(?:,\d{3})*)\s*sq\s*ft/gi,
        /(\d{1,3}(?:,\d{3})*)\s*sq\s*ft/gi
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
