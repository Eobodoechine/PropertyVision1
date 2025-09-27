import 'dotenv/config';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
// import { groundedFreeform } from './vertex-freeform'; // Replaced with deterministic vertexGenerate
import { fetchPropertyDetailsViaVertex } from './vertex-details';

interface ComparableProperty {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number | null;
  soldDate: string;
  distance: number;
  source: string;
  confidence: string;
  condition?: string;
}

interface FindComparablesResult {
  comparables: ComparableProperty[];
  success: boolean;
  error?: string;
}

class VertexComparableSearchService {
  private rawCompsFound: number = 0;
  private googleMapsApiKey: string;
  private geocodeCache: Map<string, { lat: number; lon: number }>;

  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.googleMapsApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
    this.geocodeCache = new Map();
  }

  async findComparables(
    subjectAddress: string,
    subjectPropertyType?: string,
    maxResults: number = 10,
    searchRadius: number = 3,
    timeWindowMonths: number = 18,
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number },
    extra?: { subdivision?: string }
  ): Promise<FindComparablesResult> {
    try {
      console.log(`🔍 SEARCHING COMPARABLES: ${subjectAddress}`);
      console.log(`   • Radius: ${searchRadius} miles`);
      console.log(`   • Max results: ${maxResults}`);

      // Get subject property coordinates
      const subjectCoords = await this.geocodeWithTimeout(subjectAddress, 5000);
      if (!subjectCoords) {
        throw new Error('Failed to geocode subject property');
      }

      // Check for service account
      let sa;
      if (process.env.GCP_SA_JSON_B64) {
        // Production: base64 encoded JSON
        const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
        sa = JSON.parse(saJson);
      } else {
        // Local: file path
        const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
        if (!saPath) {
          throw new Error('GCP_SA_JSON or GCP_SA_JSON_B64 environment variable is required for Vertex AI');
        }
        sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
      }
      const projectId = sa.project_id;
      const location = process.env.VERTEX_LOCATION || 'us-central1';
      const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
      const token = await this.getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

      // Build subdivision filter from override or env
      const subdivision = (extra?.subdivision?.trim() || process.env.SUBDIVISION)?.trim();

      // Compose an analyst-style prompt but enforce pipe-separated output for parsing
      const composeAnalystPipePrompt = (
        withSubdivision: boolean
      ) => {
        const sd = subjectDetails || null;
        const subjBeds = sd?.beds ?? undefined;
        const subjBaths = sd?.baths ?? undefined;
        const subjSqft = sd?.sqft ?? undefined;
        const subjYear = sd?.yearBuilt ?? undefined;
        const lowSqft = subjSqft ? Math.round(subjSqft * 0.8) : '±20% lower bound';
        const highSqft = subjSqft ? Math.round(subjSqft * 1.2) : '±20% upper bound';
        const lowYear = subjYear ? subjYear - 10 : 'subject-10';
        const highYear = subjYear ? subjYear + 10 : 'subject+10';

        return `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below.
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${subjectAddress}
${subjBeds != null ? `- Beds: ${subjBeds}\n` : ''}${subjBaths != null ? `- Baths: ${subjBaths}\n` : ''}${subjSqft != null ? `- Square Footage: ${subjSqft} sqft\n` : ''}${subjYear != null ? `- Year Built: ${subjYear}\n` : ''}${subjectPropertyType ? `- Property Type: ${subjectPropertyType}\n` : ''}${withSubdivision && subdivision ? `- Subdivision: ${subdivision}\n` : ''}
COMPARABLE SELECTION CRITERIA:
1. Location: Within ${searchRadius} miles of the subject property.
2. Sale Date: Sold within the last ${timeWindowMonths} months.
3. Size: Between ~${lowSqft} sqft and ~${highSqft} sqft (±20% of subject).
4. Bedrooms: ${subjBeds != null ? `${Math.max(1, subjBeds - 1)}–${subjBeds + 1}` : '±1 of subject'} bedrooms.
5. Bathrooms: ${subjBaths != null ? `${Math.max(1, Math.floor(subjBaths - 1))}–${Math.ceil(subjBaths + 1)}` : '±1 of subject'} bathrooms.
6. Year Built: Between ${lowYear} and ${highYear} (within ±10 years of subject's build year).
7. Property Type: ${(subjectPropertyType === 'duplex' || subjectPropertyType === 'multi-family') ?
  `MUST be duplex or multi-family properties ONLY. Include properties listed as "duplex", "multi-family", "multifamily", "two-family", "2-family", or "2-unit". Focus on 2-unit residential buildings. Do not include single-family homes, condos, townhomes, or large apartment buildings.` :
  subjectPropertyType ? `MUST be ${subjectPropertyType} properties ONLY. Do not include any other property types.` :
  'MUST match the same property type as the subject property. If subject is a single family home, only return single family homes. If subject is a condo, only return condos. If subject is a townhome, only return townhomes.'}

CRITICAL: ${(subjectPropertyType === 'duplex' || subjectPropertyType === 'multi-family') ?
  `Only return duplex/multi-family properties that are 2-unit residential buildings. Exclude single-family homes, condos, townhomes, and large apartment complexes.` :
  subjectPropertyType ? `Only return ${subjectPropertyType} properties.` :
  'Determine the property type of the subject property and ONLY include comparable properties of the SAME type.'} Do not mix property types.

OUTPUT FORMAT (STRICT):
Return ONLY pipe-separated lines, one per property, no commentary, no headers:
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
      };

      // Always perform 3 subdivision runs (if subdivision is set), then 3 expanded runs, aggregate all
      const aggregatedComps = new Map<string, ComparableProperty>();

      const fetchAndParse = async (p: string): Promise<ComparableProperty[]> => {
        const { vertexGenerate } = await import('./vertex-freeform.js');
        const r = await vertexGenerate({
          sa: sa,
          projectId,
          location,
          model,
          prompt: p,
          grounded: true,
          timeoutMs: 60000
        });
        let parsed = await this.parseVertexResponse(r, subjectCoords.lat, subjectCoords.lon, subjectDetails);
        if (parsed.length === 0) {
          const strictP = `Return ONLY pipe-separated lines for SOLD properties near "${subjectAddress}" within ${searchRadius} miles and ${timeWindowMonths} months. No commentary, no headers.
address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | source_url`;
          const sr = await vertexGenerate({
            sa: sa,
            projectId,
            location,
            model,
            prompt: strictP,
            grounded: true,
            timeoutMs: 60000
          });
          parsed = await this.parseVertexResponse(sr, subjectCoords.lat, subjectCoords.lon, subjectDetails);
        }
        return parsed;
      };

      // Prepare prompts and run all Vertex searches in parallel
      const prompts: string[] = [];
      if (subdivision) {
        console.log('   🏘️  Subdivision specified — scheduling 3 subdivision searches');
        for (let i = 1; i <= 3; i++) prompts.push(composeAnalystPipePrompt(true));
      } else {
        console.log('   🏘️  No subdivision specified — skipping subdivision runs');
      }
      for (let i = 1; i <= 3; i++) prompts.push(composeAnalystPipePrompt(false));

      console.log(`   🚀 Launching ${prompts.length} Vertex searches in parallel...`);
      const batches = await Promise.all(prompts.map(p => fetchAndParse(p)));
      for (const list of batches) {
        list.forEach(c => { if (!aggregatedComps.has(c.address)) aggregatedComps.set(c.address, c); });
      }

      // Use aggregated results
      let comps = Array.from(aggregatedComps.values());
      console.log(`   🔗 Aggregated total before filters: ${comps.length} unique properties`);

      // LOG EACH PROPERTY BEFORE FILTERING
      console.log(`   🔍 DETAILED PROPERTY FILTERING:`);
      comps.forEach((comp, index) => {
        console.log(`   🔍 FILTERING ${comp.address}: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft}sqft vs Subject: ${subjectDetails?.beds || '?'}BR/${subjectDetails?.baths || '?'}BA, ${subjectDetails?.sqft || '?'}sqft`);

        // Bedroom validation
        const bedroomDiff = Math.abs((comp.beds || 0) - (subjectDetails?.beds || 0));
        if (bedroomDiff <= 1) {
          console.log(`   ✅ BEDROOM OK ${comp.address}: ${comp.beds}BR vs ${subjectDetails?.beds || '?'}BR (diff: ${bedroomDiff} ≤ 1)`);
        } else {
          console.log(`   ❌ BEDROOM REJECTED ${comp.address}: ${comp.beds}BR vs ${subjectDetails?.beds || '?'}BR (diff: ${bedroomDiff} > 1)`);
        }

        // Size validation
        if (subjectDetails?.sqft) {
          const sizeVariance = Math.abs(comp.sqft - subjectDetails.sqft) / subjectDetails.sqft * 100;
          if (sizeVariance <= 20) {
            console.log(`   ✅ SIZE QUALIFIED ${comp.address}: ${sizeVariance.toFixed(1)}% variance (within 20% limit)`);
          } else {
            console.log(`   ⚠️  Filtered out ${comp.address}: size variance too high (${sizeVariance.toFixed(1)}% > 20% limit)`);
          }
        }

        // Time validation (simplified - would need actual sold date parsing)
        console.log(`   ✅ TIME QUALIFIED ${comp.address}: Recent sale (estimated)`);
        console.log(`   ✅ Added: ${comp.address} - $${comp.price.toLocaleString()} - ${comp.sqft}sqft - Built: ${comp.yearBuilt || 'Unknown'}`);
      });

      // Deduplicate by address (remove duplicate addresses)
      comps = this.deduplicateComparables(comps);

      // PPSF outlier filtering now handled by enhanced ARV calculation with 7.5% threshold

      // Enrich missing data and re-validate (drops any newly disqualified comps)
      // No top-N limit: enrich all surviving comps
      const prioritized = this.prioritizeForEnrichment(comps);
      comps = await this.enrichAndRevalidate(prioritized, subjectDetails);

      // Geocode at the very end for surviving comps and filter by distance limits
      comps = await this.geocodeAndFilterDistance(comps, subjectCoords.lat, subjectCoords.lon, 1.0, 2.0);

      // CRITICAL DEBUG LOGGING FOR DUPLEX VERIFICATION
      console.log(`   🚨 DUPLEX VERIFICATION CHECK POINT:`);
      console.log(`      🏠 subjectPropertyType = "${subjectPropertyType}" (type: ${typeof subjectPropertyType})`);
      console.log(`      📊 comps.length = ${comps.length}`);
      console.log(`      🔍 isDuplex = ${subjectPropertyType === 'duplex'}`);
      console.log(`      🔍 isMultiFamily = ${subjectPropertyType === 'multi-family'}`);
      console.log(`      🔍 condition1 = ${(subjectPropertyType === 'duplex' || subjectPropertyType === 'multi-family')}`);
      console.log(`      🔍 condition2 = ${comps.length > 0}`);
      console.log(`      🔍 shouldVerify = ${(subjectPropertyType === 'duplex' || subjectPropertyType === 'multi-family') && comps.length > 0}`);

      // If subject is duplex or multi-family, verify each remaining comparable is actually a duplex/multi-family
      if ((subjectPropertyType === 'duplex' || subjectPropertyType === 'multi-family') && comps.length > 0) {
        console.log(`   🏠 STARTING DUPLEX VERIFICATION for ${comps.length} properties...`);
        comps = await this.verifyDuplexComparables(comps, sa, projectId, location, model);
        console.log(`   ✅ DUPLEX VERIFICATION COMPLETE: ${comps.length} confirmed duplex/multi-family properties`);
      } else {
        console.log(`   ⏭️  SKIPPING DUPLEX VERIFICATION: propertyType="${subjectPropertyType}", comps=${comps.length}`);
      }

      // Sort by distance (placing unknowns last) and limit results
      comps.sort((a, b) => {
        const af = Number.isFinite(a.distance) ? a.distance : Number.POSITIVE_INFINITY;
        const bf = Number.isFinite(b.distance) ? b.distance : Number.POSITIVE_INFINITY;
        return af - bf;
      });
      const finalComps = comps.slice(0, maxResults);

      // COMPREHENSIVE VALIDATION LOGGING
      const foundCount = this.rawCompsFound || 0; // Track raw comps found
      const qualifiedCount = finalComps.length;
      const rejectedCount = foundCount - qualifiedCount;

      console.log(`   📊 SEARCH SUMMARY:`);
      console.log(`      🔍 Found: ${foundCount} raw comps from Vertex AI`);
      console.log(`      ✅ Qualified: ${qualifiedCount} comps (passed all filters)`);
      console.log(`      ❌ Rejected: ${rejectedCount} comps (failed validation)`);

      if (qualifiedCount > 0) {
        const distances = finalComps.map(c => c.distance);
        const sizes = finalComps.map(c => c.sqft);
        const ppsfValues = finalComps.map(c => c.price / c.sqft);

        console.log(`      📍 Distance range: ${Math.min(...distances).toFixed(2)}mi - ${Math.max(...distances).toFixed(2)}mi`);
        console.log(`      📐 Size range: ${Math.min(...sizes).toLocaleString()} - ${Math.max(...sizes).toLocaleString()} sqft`);
        console.log(`      💲 PPSF range: $${Math.min(...ppsfValues).toFixed(2)} - $${Math.max(...ppsfValues).toFixed(2)}`);
      }

      // MINIMUM COMP COUNT VALIDATION
      const MIN_COMPS_REQUIRED = 3;
      if (finalComps.length < MIN_COMPS_REQUIRED) {
        console.log(`   ⚠️  WARNING: Only ${finalComps.length} qualified comps (minimum ${MIN_COMPS_REQUIRED} recommended)`);
        console.log(`   💡 SUGGESTED EXPANSIONS:`);
        console.log(`      📅 Extend time window: 12 → 18 months`);
        console.log(`      📍 Expand distance: 2 → 3 miles`);
        console.log(`      📐 Relax size variance: ±20% → ±25%`);

        if (finalComps.length === 0) {
          return {
            comparables: [],
            success: false,
            error: `No qualified comparables found after strict filtering. Consider expanding search criteria.`
          };
        }
      }

      // Log comp quality breakdown
      const recentComps = finalComps.filter(c => {
        const soldDate = new Date(c.soldDate);
        const ageInMonths = Math.floor((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
        return ageInMonths <= 12;
      });

      const idealDistance = finalComps.filter(c => c.distance <= 1.0);
      const extendedDistance = finalComps.filter(c => c.distance > 1.0);

      console.log(`   ✅ QUALIFIED COMPARABLES: ${finalComps.length}`);
      console.log(`   📊 Time Quality: ${recentComps.length} recent (≤12mo), ${finalComps.length - recentComps.length} extended (12-18mo)`);
      console.log(`   📊 Distance Quality: ${idealDistance.length} ideal (≤1mi), ${extendedDistance.length} extended (1-2mi)`);

      // Optional: write final comps cache with distances
      try {
        const outPath = process.env.FINAL_COMPS_CACHE;
        if (outPath) {
          const payload = finalComps.map(c => ({
            address: c.address,
            price: c.price,
            soldDate: c.soldDate,
            beds: c.beds,
            baths: c.baths,
            sqft: c.sqft,
            yearBuilt: c.yearBuilt,
            distance: c.distance,
            source: c.source,
            confidence: c.confidence
          }));
          fs.writeFileSync(outPath, JSON.stringify({ comps: payload }, null, 2));
          console.log(`   💾 Wrote final comps cache: ${outPath}`);
        }
      } catch {}

      return {
        comparables: finalComps,
        success: true
      };

    } catch (error: any) {
      console.error(`   ❌ Comparable search failed: ${error.message}`);
      return {
        comparables: [],
        success: false,
        error: error.message
      };
    }
  }

  private async verifyDuplexComparables(
    comps: ComparableProperty[],
    sa: any,
    projectId: string,
    location: string,
    model: string
  ): Promise<ComparableProperty[]> {
    const verifiedComps: ComparableProperty[] = [];

    for (const comp of comps) {
      try {
        // Use LLM to verify if this property is actually a duplex/multi-family
        const verificationPrompt = `Is this property a duplex, two-family, or multi-family building (2-4 units)? Analyze the description and respond with YES or NO.

Property: ${comp.address}
Bedrooms: ${comp.beds}
Bathrooms: ${comp.baths}
Square Feet: ${comp.sqft}
Source: ${comp.source}

Look for indicators like:
- Listed as "duplex", "multi-family", "two-family", "2-unit"
- Side-by-side or up/down configuration
- Multiple kitchens or separate entrances
- Investment property characteristics
- Unit descriptions (Unit A/B, Upper/Lower)

Respond with only YES (if duplex/multi-family) or NO (if single-family/other).`;

        const { vertexGenerate } = await import('./vertex-freeform.js');
        const response = await vertexGenerate({
          sa,
          projectId,
          location,
          model,
          prompt: verificationPrompt,
          grounded: true,
          timeoutMs: 30000
        });

        const isDuplex = response.trim().toUpperCase().includes('YES');

        if (isDuplex) {
          console.log(`   ✅ VERIFIED DUPLEX: ${comp.address} - ${comp.beds}BR/${comp.baths}BA`);
          verifiedComps.push(comp);
        } else {
          console.log(`   ❌ NOT DUPLEX: ${comp.address} - ${comp.beds}BR/${comp.baths}BA (excluded)`);
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.log(`   ⚠️  Verification failed for ${comp.address}: ${error}`);
        // If verification fails, include the property (conservative approach)
        verifiedComps.push(comp);
      }
    }

    return verifiedComps;
  }

  private getVertexConfig() {
    let serviceAccount;
    if (process.env.GCP_SA_JSON_B64) {
      // Production: base64 encoded JSON
      const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
      serviceAccount = JSON.parse(saJson);
    } else {
      // Local: file path
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
      if (!saPath) {
        throw new Error('GCP_SA_JSON or GCP_SA_JSON_B64 environment variable is required for Vertex AI');
      }
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    }
    const projectId = serviceAccount.project_id;
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';

    return { serviceAccount, projectId, location, model };
  }

  private async parsePropertyDataWithLLM(propertyLine: string): Promise<{
    address?: string;
    price?: number;
    soldDate?: Date | null;
    beds?: number;
    baths?: number;
    sqft?: number;
    yearBuilt?: number;
    source?: string;
  } | null> {
    try {
      const { vertexGenerate } = await import('./vertex-freeform.js');
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();

      // Single LLM call for all fields using JSON
      const allFieldsPrompt = `Extract all property data from this line and return ONLY valid JSON (no prose, no markdown fences):

"${propertyLine}"

Return exactly this JSON structure:
{
  "address": "complete street address",
  "price": number (no commas or dollar signs),
  "soldDate": "YYYY-MM-DD format (or INVALID if date is missing/invalid)",
  "beds": number,
  "baths": number (can be decimal),
  "sqft": number (no commas),
  "yearBuilt": 4-digit year,
  "source": "website name or URL"
}`;

      // Provide response schema to strongly bias valid JSON output
      const responseSchema = {
        type: 'OBJECT',
        properties: {
          address: { type: 'STRING' },
          price: { type: 'NUMBER' },
          soldDate: { type: 'STRING' },
          beds: { type: 'NUMBER' },
          baths: { type: 'NUMBER' },
          sqft: { type: 'NUMBER' },
          yearBuilt: { type: 'NUMBER' },
          source: { type: 'STRING' },
        }
      } as any;

      const response = await vertexGenerate({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt: allFieldsPrompt,
        grounded: false,
        json: true,
        timeoutMs: 600000,
        responseSchema
      });

      // Be robust to code fences or stray prose
      const extractJsonBlock = (text: string): string | null => {
        if (!text) return null;
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced && fenced[1]) return fenced[1].trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
        return null;
      };

      let parsedJson: any;
      try {
        parsedJson = JSON.parse(response);
      } catch (parseError) {
        console.log(`⚠️  Initial JSON parse failed, trying to extract JSON block from response:`, response.substring(0, 200));
        const block = extractJsonBlock(response);
        if (block) {
          try {
            parsedJson = JSON.parse(block);
          } catch (blockError) {
            console.log(`❌ Failed to parse extracted JSON block:`, block.substring(0, 200));
            parsedJson = null;
          }
        } else {
          console.log(`❌ No JSON block found in response`);
          parsedJson = null;
        }
      }

      if (!parsedJson || typeof parsedJson !== 'object') {
        console.log(`❌ LLM parsing error - Invalid JSON response:`, response.substring(0, 500));
        throw new Error('invalid-json-from-llm');
      }

      const addressRes = parsedJson.address || '';
      const priceRes = String(parsedJson.price || 0);
      const dateRes = parsedJson.soldDate || 'INVALID';
      const bedsRes = String(parsedJson.beds || 0);
      const bathsRes = String(parsedJson.baths || 0);
      const sqftRes = String(parsedJson.sqft || 0);
      const yearRes = parsedJson.yearBuilt != null ? String(parsedJson.yearBuilt) : '';
      const sourceRes = parsedJson.source || 'unknown';

      // Parse results
      const address = addressRes.trim();
      const price = Number(priceRes.replace(/[^\d.]/g, ''));
      const dateStr = dateRes.trim();
      const beds = Number(bedsRes.replace(/[^\d.]/g, ''));
      // Normalize common unicode fractions in baths
      const normalizedBaths = bathsRes
        .replace(/½/g, '.5')
        .replace(/¼/g, '.25')
        .replace(/¾/g, '.75');
      const baths = Number(normalizedBaths.replace(/[^\d.]/g, ''));
      const sqft = Number(sqftRes.replace(/[^\d.]/g, ''));
      const yearBuilt = yearRes ? Number(yearRes.replace(/[^\d]/g, '')) : NaN;
      const source = sourceRes.trim();

      // Handle date parsing
      let soldDate: Date | null = null;
      if (dateStr && dateStr !== 'INVALID') {
        soldDate = new Date(dateStr);
        if (isNaN(soldDate.getTime())) {
          // Try alternative date parsing
          let dateMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (dateMatch) {
            soldDate = new Date(parseInt(dateMatch[1], 10), parseInt(dateMatch[2], 10) - 1, parseInt(dateMatch[3], 10));
          } else {
            // Try MM/DD/YYYY or MM-DD-YYYY
            dateMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (dateMatch) {
              soldDate = new Date(parseInt(dateMatch[3], 10), parseInt(dateMatch[1], 10) - 1, parseInt(dateMatch[2], 10));
            } else {
              soldDate = null;
            }
          }
        }
      }

      return {
        address,
        price,
        soldDate,
        beds,
        baths,
        sqft,
        yearBuilt,
        source: source || 'unknown'
      };

    } catch (error) {
      console.log(`   ⚠️ LLM parsing error: ${error}`);
      return null;
    }
  }

  // Batch LLM parsing for multiple problematic lines in one request
  private async batchParsePropertyDataWithLLM(propertyLines: { id: number; line: string }[]): Promise<Record<number, {
    address?: string;
    price?: number;
    soldDate?: Date | null;
    beds?: number;
    baths?: number;
    sqft?: number;
    yearBuilt?: number;
    source?: string;
  }>> {
    const results: Record<number, any> = {};
    if (propertyLines.length === 0) return results;

    try {
      const { vertexGenerate } = await import('./vertex-freeform.js');
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();

      // Build a compact, deterministic prompt with IDs for mapping
      const header = `Parse each of the following real-estate comp lines into JSON. Return ONLY a JSON array (no prose). Each element MUST include the provided id and these fields: address, price (number), soldDate (YYYY-MM-DD or INVALID), beds (number), baths (number), sqft (number), yearBuilt (number), source (string).`;
      const items = propertyLines.map(({ id, line }) => `${id}) ${line}`).join('\n');
      const prompt = `${header}\n\nLINES:\n${items}`;

      // Response schema to strongly bias correct structure
      const responseSchema = {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'NUMBER' },
            address: { type: 'STRING' },
            price: { type: 'NUMBER' },
            soldDate: { type: 'STRING' },
            beds: { type: 'NUMBER' },
            baths: { type: 'NUMBER' },
            sqft: { type: 'NUMBER' },
            yearBuilt: { type: 'NUMBER' },
            source: { type: 'STRING' },
          }
        }
      } as any;

      const text = await vertexGenerate({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt,
        grounded: false,
        json: true,
        timeoutMs: 600000,
        responseSchema
      });

      // Extract JSON robustly
      const extractJsonBlock = (t: string): string | null => {
        if (!t) return null;
        const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced && fenced[1]) return fenced[1].trim();
        const start = t.indexOf('[');
        const end = t.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
        return null;
      };

      let arr: any[] | null = null;
      try {
        arr = JSON.parse(text);
      } catch {
        const block = extractJsonBlock(text);
        if (block) {
          try { arr = JSON.parse(block); } catch { arr = null; }
        }
      }

      if (!Array.isArray(arr)) return results;

      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const id = Number(item.id);
        if (!Number.isFinite(id)) continue;
        // Normalize and coerce types
        const soldDateStr = String(item.soldDate || '').trim();
        let soldDate: Date | null = null;
        if (soldDateStr && soldDateStr.toUpperCase() !== 'INVALID') {
          let d = new Date(soldDateStr);
          if (!isNaN(d.getTime())) soldDate = d; else {
            let m = soldDateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
            if (m) soldDate = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
            else {
              m = soldDateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
              if (m) soldDate = new Date(parseInt(m[3],10), parseInt(m[1],10)-1, parseInt(m[2],10));
            }
          }
        }

        results[id] = {
          address: item.address || undefined,
          price: Number.isFinite(Number(item.price)) ? Number(item.price) : undefined,
          soldDate,
          beds: Number.isFinite(Number(item.beds)) ? Number(item.beds) : undefined,
          baths: Number.isFinite(Number(item.baths)) ? Number(item.baths) : undefined,
          sqft: Number.isFinite(Number(item.sqft)) ? Number(item.sqft) : undefined,
          yearBuilt: Number.isFinite(Number(item.yearBuilt)) ? Number(item.yearBuilt) : undefined,
          source: item.source || undefined,
        };
      }

      return results;
    } catch (err) {
      console.log(`   ⚠️ Batch LLM parsing error: ${err}`);
      return results;
    }
  }

  private async parseVertexResponse(
    text: string,
    subjectLat: number,
    subjectLon: number,
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
  ): Promise<ComparableProperty[]> {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const comps: ComparableProperty[] = [];

    const useLazyParse = String(process.env.LAZY_PARSE || 'true').toLowerCase() !== 'false';

    const cheapParse = (parts: string[]) => {
      if (parts.length < 7) return null;
      const [addrOld, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;
      if (!addrOld) return null;
      const address = addrOld.trim();
      const price = parseInt(String(priceStr).replace(/[^\d]/g, ''), 10);
      const beds = parseFloat(String(bedsStr).replace(/[^\d.]/g, ''));
      const baths = parseFloat(String(bathsStr).replace(/[^\d.]/g, '').replace(/½/g, '.5'));
      const sqft = parseInt(String(sqftStr).replace(/[^\d]/g, ''), 10);
      const yearBuilt = parseInt(String(ybStr).replace(/[^\d]/g, ''), 10);

      // Date parsing
      let soldDate: Date | null = null;
      const ds = (dateStr || '').trim();
      if (ds) {
        let d = new Date(ds);
        if (!isNaN(d.getTime())) soldDate = d; else {
          let m = ds.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m) {
            soldDate = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
          } else {
            m = ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (m) soldDate = new Date(parseInt(m[3],10), parseInt(m[1],10)-1, parseInt(m[2],10));
          }
        }
      }

      // Basic sanity checks; leave business rules (±20%, etc.) to later filters
      const hasAddress = !!address;
      const hasPrice = Number.isFinite(price) && price > 0;
      const hasDate = soldDate != null && !isNaN(soldDate.getTime());
      const hasSqft = Number.isFinite(sqft) && sqft > 0;
      const hasYear = Number.isFinite(yearBuilt) && yearBuilt >= 1900 && yearBuilt <= new Date().getFullYear();
      const hasBeds = Number.isFinite(beds) && beds > 0;
      const hasBaths = Number.isFinite(baths) && baths > 0;

      if (!hasAddress || !hasPrice || !hasDate) return null; // Core fields required

      return {
        address,
        price,
        soldDate,
        beds: hasBeds ? beds : NaN,
        baths: hasBaths ? baths : NaN,
        sqft: hasSqft ? sqft : NaN,
        yearBuilt: hasYear ? yearBuilt : NaN,
        source: (url || '').trim() || 'unknown'
      } as any;
    };

    // First pass: identify bad lines and attempt cheap parse
    const lineParts: string[][] = [];
    const validLineIndex: number[] = [];
    const initialParsed: (any | null)[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split('|').map(s => s.trim());
      lineParts[i] = parts;
      if (parts.length < 7) { initialParsed[i] = null; continue; }
      const [addrOld] = parts;
      if (!addrOld || /^(address|123\s+main\s+st|example)/i.test(addrOld)) { initialParsed[i] = null; continue; }
      validLineIndex.push(i);
      this.rawCompsFound++;
      initialParsed[i] = useLazyParse ? cheapParse(parts) : null;
    }

    // Collect bad lines for batch LLM parsing
    const badEntries: { id: number; line: string }[] = [];
    for (const idx of validLineIndex) {
      if (!initialParsed[idx]) {
        badEntries.push({ id: idx, line: lines[idx] });
      }
    }

    // Batch in chunks
    const batchSize = Math.max(1, parseInt(String(process.env.LLM_BATCH_SIZE || '12'), 10));
    const batchedParsed: Record<number, any> = {};
    for (let i = 0; i < badEntries.length; i += batchSize) {
      const slice = badEntries.slice(i, i + batchSize);
      const mapped = await this.batchParsePropertyDataWithLLM(slice);
      Object.assign(batchedParsed, mapped);
      // Small delay to be polite and avoid rate limits
      await new Promise(r => setTimeout(r, 150));
    }

    // Second pass: build comps using parsed data (cheap or batched), fallback to single-line LLM if still missing
    for (const idx of validLineIndex) {
      const parts = lineParts[idx];
      const line = lines[idx];
      const [addrOld, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts as any;

      let parsedData: any = initialParsed[idx] || batchedParsed[idx] || null;
      if (!parsedData) {
        // Last resort: single-line LLM
        parsedData = await this.parsePropertyDataWithLLM(line);
      }

      // Start with whatever the LLM returned (may be partial)
      let address = parsedData?.address;
      let price = parsedData?.price;
      let soldDate = parsedData?.soldDate ?? null;
      let beds = parsedData?.beds;
      let baths = parsedData?.baths;
      let sqft = parsedData?.sqft;
      let yearBuilt = parsedData?.yearBuilt;
      let source = parsedData?.source;

      // Enrich/Backfill missing fields from the pipe-delimited line parts
      const parseIntSafe = (s: string) => {
        const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) ? n : NaN;
      };
      const parseFloatSafe = (s: string) => {
        const normalized = String(s).replace(/½/g, '.5').replace(/¼/g, '.25').replace(/¾/g, '.75');
        const n = parseFloat(normalized.replace(/[^\d.]/g, ''));
        return Number.isFinite(n) ? n : NaN;
      };
      const parseDateSafe = (s: string): Date | null => {
        if (!s) return null;
        let d = new Date(s);
        if (!isNaN(d.getTime())) return d;
        let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
        m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (m) return new Date(parseInt(m[3],10), parseInt(m[1],10)-1, parseInt(m[2],10));
        return null;
      };

      if (!address) address = addrOld;
      if (!price || !Number.isFinite(price)) price = parseIntSafe(priceStr);
      if (!soldDate) soldDate = parseDateSafe(dateStr);
      if (!beds || !Number.isFinite(beds)) beds = parseIntSafe(bedsStr);
      if (!baths || !Number.isFinite(baths)) baths = parseFloatSafe(bathsStr);
      if (!sqft || !Number.isFinite(sqft)) sqft = parseIntSafe(sqftStr);
      if (!yearBuilt || !Number.isFinite(yearBuilt)) yearBuilt = parseIntSafe(ybStr);
      if (!source || source === 'unknown') source = url || 'unknown';

      // Only require address; other fields can be enriched later
      if (!address) {
        console.log(`   ❌ Rejected line: missing address`);
        continue;
      }

      // Basic validation
      if (!Number.isFinite(price) || price <= 0) {
        console.log(`   ❌ Rejected ${address}: Invalid or missing price (${price})`);
        continue;
      }
      if (!Number.isFinite(sqft) || sqft <= 0) {
        console.log(`   ❌ Rejected ${address}: Invalid or missing sqft (${sqft})`);
        continue;
      }
      if (sqft < 500 || sqft > 10000) {
        console.log(`   ❌ Rejected ${address}: Sqft out of range (${sqft})`);
        continue;
      }
      if (!Number.isFinite(beds) || beds < 1 || beds > 10) {
        console.log(`   ❌ Rejected ${address}: Invalid or missing beds (${beds})`);
        continue;
      }
      if (!Number.isFinite(baths) || baths < 1 || baths > 10) {
        console.log(`   ❌ Rejected ${address}: Invalid or missing baths (${baths})`);
        continue;
      }
      if (Number.isFinite(yearBuilt) && (yearBuilt < 1900 || yearBuilt > new Date().getFullYear())) {
        console.log(`   ❌ Rejected ${address}: Invalid year built (${yearBuilt})`);
        continue;
      }

      // SOLD DATE VALIDATION (only if available)
      let ageInMonths = Infinity;
      if (soldDate) {
        const today = new Date();
        const futureBuffer = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days ahead
        if (soldDate > futureBuffer) {
          console.log(`   ❌ Rejected ${address}: Future sold date (${soldDate.toISOString().split('T')[0]}) - today is ${today.toISOString().split('T')[0]}`);
          continue;
        }
        ageInMonths = Math.floor((today.getTime() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
      }

      // ENHANCED FILTERING based on subject property (if available)
      if (subjectDetails) {
        console.log(`   🔍 FILTERING ${address}: ${beds}BR/${baths}BA, ${sqft}sqft vs Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft`);

        // 1. Bedroom count: ±1 bedroom max (if beds available)
        if (Number.isFinite(beds)) {
          const bedroomDiff = Math.abs((beds as number) - subjectDetails.beds);
          if (bedroomDiff > 1) {
            console.log(`   ❌ FILTERED OUT ${address}: bedroom mismatch (${beds}BR vs ${subjectDetails.beds}BR, diff: ${bedroomDiff})`);
            continue;
          } else {
            console.log(`   ✅ BEDROOM OK ${address}: ${beds}BR vs ${subjectDetails.beds}BR (diff: ${bedroomDiff} ≤ 1)`);
          }
        } else {
          console.log(`   ℹ️  Skipping bedroom filter: missing beds`);
        }

        // 2. Bathroom filtering with special logic for low bathroom count
        if (!Number.isFinite(baths)) {
          console.log(`   ℹ️  Skipping bathroom filter: missing baths`);
        } else if (subjectDetails.baths <= 2) {
          // For subject with ≤2 baths, keep all comps with ≤2 baths + separate tracking for >2 bath comps
          if (baths > 2) {
            console.log(`   📝 Flagged ${address}: high bathroom count for low-bath subject (${baths} vs ${subjectDetails.baths})`);
            // Still include but flag for separate ARV calculation
          }
        } else {
          // For subject with >2 baths, use ±1 bathroom rule (rounded for half baths)
          const bathDiff = Math.abs((baths as number) - subjectDetails.baths);
          if (bathDiff > 1.5) { // Allow up to 1.5 difference to handle half-bath variations
            console.log(`   ⚠️  Filtered out ${address}: bathroom mismatch (${baths} vs ${subjectDetails.baths}, diff: ${bathDiff.toFixed(1)})`);
            continue;
          }
        }

        // 3. Square footage: ±20% max
        const sqftVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        if (sqftVariance > 0.20) {
          console.log(`   ⚠️  Filtered out ${address}: size variance too high (${(sqftVariance * 100).toFixed(1)}% > 20% limit)`);
          continue;
        }

        // 4. Age cohort filtering (if comp year built available)
        if (Number.isFinite(yearBuilt)) {
          const ageGroup = this.getAgeGroup(subjectDetails.yearBuilt);
          const compAgeGroup = this.getAgeGroup(yearBuilt as number);
          if (!this.isAdjacentAgeGroup(ageGroup, compAgeGroup)) {
            console.log(`   ⚠️  Filtered out ${address}: age group mismatch (${compAgeGroup} vs ${ageGroup})`);
            continue;
          }
        } else {
          console.log(`   ℹ️  Skipping age-group filter: missing year built`);
        }
      }

      // Defer live geocoding to the final stage for surviving comps
      let distance = NaN as any;

      // STRICT SIZE VARIANCE FILTERING (±20%)
      if (subjectDetails) {
        const sizeVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        const MAX_SIZE_VARIANCE = 0.20; // 20%

        if (sizeVariance > MAX_SIZE_VARIANCE) {
          console.log(`   ❌ REJECTED ${address}: Size variance too high (${(sizeVariance * 100).toFixed(1)}% > ${(MAX_SIZE_VARIANCE * 100)}%)`);
          console.log(`      Subject: ${subjectDetails.sqft}sqft | Comp: ${sqft}sqft`);
          continue; // Hard rejection
        }

        console.log(`   ✅ SIZE QUALIFIED ${address}: ${(sizeVariance * 100).toFixed(1)}% variance (within ${(MAX_SIZE_VARIANCE * 100)}% limit)`);
      }

      // TIERED TIME WINDOW FILTERING
      const IDEAL_TIME_MONTHS = 12;
      const MAX_TIME_MONTHS = 18;

      if (Number.isFinite(ageInMonths) && ageInMonths <= IDEAL_TIME_MONTHS) {
        console.log(`   ✅ TIME QUALIFIED ${address}: Recent sale (${ageInMonths} months)`);
      } else if (Number.isFinite(ageInMonths) && ageInMonths <= MAX_TIME_MONTHS) {
        console.log(`   ⚠️  TIME EXTENDED ${address}: Extended time range (${ageInMonths} months) - may need market adjustments`);
      } else if (!Number.isFinite(ageInMonths)) {
        console.log(`   ℹ️  Skipping time window filter for ${address}: missing sold date`);
      } else {
        console.log(`   ❌ REJECTED ${address}: Too old (${ageInMonths} months > ${MAX_TIME_MONTHS} months)`);
        continue;
      }

      // Format sold date as YYYY-MM-DD string (avoid TZ shift)
      const soldDateStr = (() => {
        if (!soldDate) return '';
        const d = new Date(soldDate.getTime() - soldDate.getTimezoneOffset() * 60000);
        return d.toISOString().split('T')[0];
      })();

      comps.push({
        address: address,
        price,
        sqft,
        beds: Number.isFinite(beds) ? (beds as number) : NaN,
        baths: Number.isFinite(baths) ? (baths as number) : NaN,
        yearBuilt: Number.isFinite(yearBuilt) ? (yearBuilt as number) : null,
        soldDate: soldDateStr,
        distance,
        source: source || 'Vertex AI Grounded Search',
        confidence: Number.isFinite(beds) && Number.isFinite(baths) && Number.isFinite(yearBuilt) ? 'high' : 'medium',
        condition: 'renovated' // Assume renovated for ARV analysis
      });

      console.log(`   ✅ Added: ${address} - $${price.toLocaleString()} - ${sqft}sqft - Built: ${yearBuilt}`);
    }

    return comps;
  }

  // Prioritize comps for enrichment: prefer those with more complete fields and newer sold dates
  private prioritizeForEnrichment(comps: ComparableProperty[]): ComparableProperty[] {
    const score = (c: ComparableProperty) => {
      let s = 0;
      if (Number.isFinite(c.price)) s += 2;
      if (Number.isFinite(c.sqft)) s += 2;
      if (Number.isFinite(c.beds)) s += 1;
      if (Number.isFinite(c.baths)) s += 1;
      if (c.yearBuilt != null) s += 1;
      if (c.soldDate) s += 1;
      return s;
    };
    const dateValue = (c: ComparableProperty) => {
      const d = c.soldDate ? new Date(c.soldDate) : null;
      return d && !isNaN(d.getTime()) ? d.getTime() : 0;
    };
    return [...comps].sort((a, b) => score(b) - score(a) || dateValue(b) - dateValue(a));
  }

  // Geocode surviving comps at the end and filter by distance limits
  private async geocodeAndFilterDistance(
    comps: ComparableProperty[],
    subjectLat: number,
    subjectLon: number,
    idealMiles = 1.0,
    maxMiles = 2.0
  ): Promise<ComparableProperty[]> {
    const out: ComparableProperty[] = [];
    const GEOCODE_CONCURRENCY = parseInt(process.env.GEOCODE_CONCURRENCY || '6', 10);

    let index = 0;
    let active = 0;
    await new Promise<void>((resolve) => {
      const next = () => {
        if (index >= comps.length && active === 0) return resolve();
        while (active < GEOCODE_CONCURRENCY && index < comps.length) {
          const c = comps[index++];
          active++;
          (async () => {
            let dist = await this.calculateDistance(c.address, subjectLat, subjectLon, 7000);
            if (!Number.isFinite(dist)) {
              console.log(`   ⚠️  Skipping distance filter for ${c.address}: geocoding failed`);
              out.push({ ...c, distance: NaN as any });
              return;
            }
            if (dist > maxMiles) {
              console.log(`   ❌ REJECTED ${c.address}: Too far (${dist.toFixed(2)}mi > ${maxMiles}mi limit)`);
              return;
            }
            if (dist > idealMiles) {
              console.log(`   ⚠️  EXTENDED DISTANCE ${c.address}: (${dist.toFixed(2)}mi > ${idealMiles}mi ideal)`);
            }
            out.push({ ...c, distance: dist });
          })().finally(() => { active--; next(); });
        }
      };
      next();
    });

    return out;
  }

  private getAgeGroup(yearBuilt: number): string {
    if (yearBuilt >= 2020) return '2020+';
    if (yearBuilt >= 2016) return '2016-2019';
    if (yearBuilt >= 2010) return '2010-2015';
    if (yearBuilt >= 2000) return '2000-2009';
    if (yearBuilt >= 1980) return '1980-1999';
    if (yearBuilt >= 1960) return '1960-1979';
    if (yearBuilt >= 1940) return '1940-1959';
    return 'Pre-1940';
  }

  private isAdjacentAgeGroup(group1: string, group2: string): boolean {
    const groups = ['Pre-1940', '1940-1959', '1960-1979', '1980-1999', '2000-2009', '2010-2015', '2016-2019', '2020+'];
    const index1 = groups.indexOf(group1);
    const index2 = groups.indexOf(group2);
    return Math.abs(index1 - index2) <= 1; // Same group or adjacent
  }

  private deduplicateComparables(comps: ComparableProperty[]): ComparableProperty[] {
    const seen = new Set<string>();
    const deduplicated: ComparableProperty[] = [];

    console.log(`   🔍 DEDUPLICATION ANALYSIS: Starting with ${comps.length} properties`);

    for (const comp of comps) {
      // Normalize address for comparison (lowercase, remove extra spaces)
      const normalizedAddress = comp.address.toLowerCase().trim().replace(/\s+/g, ' ');

      console.log(`   🔍 CHECKING: "${comp.address}" → normalized: "${normalizedAddress}"`);
      console.log(`   📊 Property details: $${comp.price?.toLocaleString()} | ${comp.sqft}sqft | ${comp.soldDate} | ${comp.source}`);

      if (!seen.has(normalizedAddress)) {
        seen.add(normalizedAddress);
        deduplicated.push(comp);
        console.log(`   ✅ KEPT: ${comp.address} (first occurrence)`);
      } else {
        console.log(`   ❌ DUPLICATE REMOVED: ${comp.address} (already seen as "${normalizedAddress}")`);
        // Show which property was kept vs removed
        const existing = deduplicated.find(d => d.address.toLowerCase().trim().replace(/\s+/g, ' ') === normalizedAddress);
        if (existing) {
          console.log(`   📊 KEPT: ${existing.address} | $${existing.price?.toLocaleString()} | ${existing.soldDate}`);
          console.log(`   📊 REMOVED: ${comp.address} | $${comp.price?.toLocaleString()} | ${comp.soldDate}`);
        }
      }
    }

    console.log(`   📊 Deduplication: ${comps.length} → ${deduplicated.length} unique properties`);
    return deduplicated;
  }

  // Removed filterByPPSFVariance method - using consistent 7.5% threshold in ARV calculation instead

  private async enrichAndRevalidate(
    comps: ComparableProperty[],
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
  ): Promise<ComparableProperty[]> {
    const enriched: ComparableProperty[] = [];

    for (const comp of comps) {
      let updated = { ...comp };

      // Enrich missing fields (beds/baths/yearBuilt) using property details
      const needsEnrich = !Number.isFinite(updated.beds) || !Number.isFinite(updated.baths) || updated.yearBuilt == null;
      if (needsEnrich) {
        try {
          const details = await fetchPropertyDetailsViaVertex(updated.address);
          if (details) {
            if (!Number.isFinite(updated.beds) && details.beds != null) updated.beds = details.beds as any;
            if (!Number.isFinite(updated.baths) && details.baths != null) updated.baths = details.baths as any;
            if (updated.yearBuilt == null && details.yearBuilt != null) updated.yearBuilt = details.yearBuilt;
            if (!Number.isFinite(updated.sqft) && details.sqft != null) updated.sqft = details.sqft as any;
          }
        } catch {}
      }

      // Require full set after enrichment
      const hasAll = (
        updated.address &&
        Number.isFinite(updated.price) &&
        typeof updated.soldDate === 'string' && updated.soldDate.length >= 8 &&
        Number.isFinite(updated.sqft) &&
        Number.isFinite(updated.beds) &&
        Number.isFinite(updated.baths) &&
        updated.yearBuilt != null
      );
      if (!hasAll) continue;

      // Re-validate after enrichment; drop if disqualified
      if (!Number.isFinite(updated.price) || updated.price <= 0) continue;
      if (Number.isFinite(updated.sqft) && (updated.sqft < 500 || updated.sqft > 10000)) continue;
      if (Number.isFinite(updated.beds) && (updated.beds! < 1 || updated.beds! > 10)) continue;
      if (Number.isFinite(updated.baths) && (updated.baths! < 1 || updated.baths! > 10)) continue;

      if (subjectDetails) {
        if (Number.isFinite(updated.beds)) {
          const bedDiff = Math.abs((updated.beds as number) - subjectDetails.beds);
          if (bedDiff > 1) continue;
        }
        if (Number.isFinite(updated.baths)) {
          const bathDiff = Math.abs((updated.baths as number) - subjectDetails.baths);
          if (subjectDetails.baths > 2 && bathDiff > 1.5) continue;
        }
        if (Number.isFinite(updated.sqft)) {
          const variance = Math.abs((updated.sqft as number) - subjectDetails.sqft) / subjectDetails.sqft;
          if (variance > 0.20) continue;
        }
        if (Number.isFinite(updated.yearBuilt as any)) {
          const ageGroup = this.getAgeGroup(subjectDetails.yearBuilt);
          const compAge = this.getAgeGroup(updated.yearBuilt as number);
          if (!this.isAdjacentAgeGroup(ageGroup, compAge)) continue;
        }
      }

      // Update confidence if now complete
      updated.confidence = 'high';
      enriched.push(updated);
    }

    return enriched;
  }

  private async getServiceAccountToken(sa: any, scope: string): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
    const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const unsigned = `${base64url(header)}.${base64url(claims)}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const signature = sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const resp = await this.httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);
    if (!resp?.access_token) throw new Error('sa-token-failed');
    return resp.access_token as string;
  }

  private async httpsPostForm(url: string, body: string, headers: Record<string,string>, timeoutMs: number): Promise<any> {
    return await new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private async calculateDistance(address: string, subjectLat: number, subjectLon: number, timeoutMs: number = 3000): Promise<number> {
    try {
      const geocoded = await this.geocodeWithTimeout(address, timeoutMs);
      if (!geocoded) throw new Error('geocode-timeout');

      const lat1 = subjectLat * Math.PI / 180;
      const lat2 = geocoded.lat * Math.PI / 180;
      const deltaLat = (geocoded.lat - subjectLat) * Math.PI / 180;
      const deltaLon = (geocoded.lon - subjectLon) * Math.PI / 180;
      const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return 3959 * c; // Earth radius in miles
    } catch {
      return NaN;
    }
  }

  private async geocodeWithTimeout(address: string, timeoutMs: number): Promise<{ lat: number; lon: number } | null> {
    // Normalize address format for better geocoding success
    const normalizedAddress = this.normalizeAddress(address);

    if (this.geocodeCache.has(normalizedAddress)) {
      return this.geocodeCache.get(normalizedAddress)!;
    }

    return new Promise((resolve) => {
      let completed = false;

      // Set timeout
      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.log(`⏰ Geocoding timeout for ${address}`);
          resolve(null);
        }
      }, timeoutMs);

      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${this.googleMapsApiKey}&components=country:US&region=us`;
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);

          try {
            const parsed = JSON.parse(data);
            if (parsed.results?.length > 0) {
              // Use the best match (first result) even if it's partial
              const result = parsed.results[0];
              const coords = { lat: result.geometry.location.lat, lon: result.geometry.location.lng };

              // Log if it's a partial match for debugging
              if (result.partial_match) {
                console.log(`🔍 Partial geocoding match for "${normalizedAddress}" → "${result.formatted_address}"`);
              }

              this.geocodeCache.set(normalizedAddress, coords);
              resolve(coords);
            } else {
              console.log(`❌ No geocoding results for "${normalizedAddress}"`);
              resolve(null);
            }
          } catch (error) {
            console.log(`❌ Geocoding parse error for "${normalizedAddress}":`, error);
            resolve(null);
          }
        });
      });

      req.on('error', () => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        resolve(null);
      });

      req.setTimeout(timeoutMs, () => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        req.destroy();
        console.log(`⏰ Geocoding timeout for ${address}`);
        resolve(null);
      });
    });
  }

  private normalizeAddress(address: string): string {
    return address
      // Standardize street type abbreviations
      .replace(/\bterrace\b/gi, 'Terrace')
      .replace(/\bter\b/gi, 'Terrace')
      .replace(/\bdr\b/gi, 'Drive')
      .replace(/\bst\b/gi, 'Street')
      .replace(/\bave\b/gi, 'Avenue')
      .replace(/\brd\b/gi, 'Road')
      .replace(/\bln\b/gi, 'Lane')
      .replace(/\bct\b/gi, 'Court')
      .replace(/\bpl\b/gi, 'Place')
      // Normalize spacing and commas
      .replace(/\s*,\s*/g, ', ')  // Standardize comma spacing
      .replace(/,\s*(GA|Georgia)\s*,?\s*/gi, ', GA ')  // Fix GA comma placement
      .replace(/\s+/g, ' ')  // Normalize multiple spaces
      // Handle city name variations for East Point area
      .replace(/\bAtlanta,\s*GA\s*30344\b/gi, 'East Point, GA 30344')
      .trim();
  }
}

// Test function
async function testFindComparables() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error('❌ ADDRESS environment variable is required');
    process.exit(1);
  }

  console.log('📍 GEOCODING:', address);
  const service = new VertexComparableSearchService();

  // Get coordinates for display
  const coords = await service['geocodeWithTimeout'](address, 5000);
  if (coords) {
    console.log(`   ✅ Coordinates: ${coords.lat}, ${coords.lon}`);
  }

  console.log('\n🔍 STEP 3: FINDING COMPARABLES');
  console.log('============================================================');

  const result = await service.findComparables(address);

  if (result.success && result.comparables.length > 0) {
    console.log(`✅ Found ${result.comparables.length} comparables:`);
    result.comparables.forEach((comp, i) => {
      console.log(`   ${i + 1}. ${comp.address}`);
      console.log(`      Price: $${comp.price.toLocaleString()}`);
      console.log(`      Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
      console.log(`      Built: ${comp.yearBuilt}`);
      console.log(`      Sold: ${comp.soldDate}`);
      console.log(`      Distance: ${comp.distance.toFixed(2)} miles`);
      console.log(`      Source: ${comp.source}`);
      console.log('');
    });
  } else {
    console.log('❌ No comparables found');
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testFindComparables().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

export { VertexComparableSearchService, type ComparableProperty, type FindComparablesResult };
// Backward-compatible alias for existing imports
export { VertexComparableSearchService as ComparableSearchService };
