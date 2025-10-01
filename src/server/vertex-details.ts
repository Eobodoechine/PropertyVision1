import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

export type BasicDetails = {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;
  subdivision: string | null;
  propertyType: string | null;
  success: boolean;
};

function hasServiceAccount(): boolean {
  const p = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON || process.env.GCP_SA_JSON_B64;
  return Boolean(p && p.trim().length > 0);
}

async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
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
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);
  if (!resp?.access_token) throw new Error('sa-token-failed');
  return resp.access_token as string;
}

async function httpsPostForm(url: string, body: string, headers: Record<string,string>, timeoutMs: number): Promise<any> {
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

async function httpsPostJson(url: string, payload: any, headers: Record<string,string>, timeoutMs: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function vertexGenerate(opts: {
  sa: any;
  projectId: string;
  location: string;
  model: string;
  prompt: string;
  grounded: boolean;
  json: boolean;
  timeoutMs: number;
  responseSchema?: any;
}): Promise<string> {
  const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
  const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
  const payload: any = {
    contents: [ { role: 'user', parts: [ { text: opts.prompt } ] } ],
    generationConfig: {
      temperature: 0,           // Maximum determinism
      seed: 12345,             // Fixed seed for reproducibility
      maxOutputTokens: 1500,
      ...(opts.json ? { responseMimeType: 'application/json' } : {})
    },
  };
  // Use legacy grounding tool name expected by this project
  if (opts.grounded) payload.tools = [ { google_search: {} } as any ];
  if (opts.responseSchema) (payload.generationConfig as any).responseSchema = opts.responseSchema;
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
  return text;
}

// LLM-based parsing to replace problematic regex
async function parseFreeformWithLLM(text: string, sa: any, projectId: string, location: string, model: string, address?: string): Promise<Partial<BasicDetails>> {
  console.log(`   🤖 Starting LLM extraction for property details...`);
  try {
    // STEP 1: Validation extraction - send raw data back for clean parsing
    console.log(`   🔍 Step 1: Validation extraction from raw data...`);
    const validationPrompt = `Extract property details from this text. You MUST provide ALL five values - if any value is not found, write "UNKNOWN":

"${text}"

Find these details:
- Square footage (house living area only, not lot size)
- Number of bedrooms
- Number of bathrooms (including half baths as decimals like 1.5)
- Year built
- Property type (single-family detached, townhome, condo, duplex, multi-family)

Respond in this EXACT format (provide ALL five lines):
SQFT: [number or UNKNOWN]
BEDS: [number or UNKNOWN]
BATHS: [number or UNKNOWN]
YEAR: [4-digit year or UNKNOWN]
TYPE: [property type or UNKNOWN]`;

    const validationResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: validationPrompt,
      grounded: true,
      json: false,
      timeoutMs: 10000
    });

    console.log(`   🔍 Validation response: "${validationResponse}"`);
    const validationData = parsePropertyResponse(validationResponse);
    console.log(`   🔍 Validation extracted: sqft=${validationData.sqft}, beds=${validationData.beds}, baths=${validationData.baths}, year=${validationData.yearBuilt}`);

    // Check if validation got all critical fields - but continue to verify with fallback
    const hasAllCriticalFields = validationData.sqft && validationData.beds && validationData.baths && validationData.yearBuilt;
    if (hasAllCriticalFields) {
      console.log(`   ✅ Validation found all critical fields - but continuing to verify with fallback for accuracy`);
      // Don't return early - continue to fallback to verify/improve the data
    }

    console.log(`   🔍 Continuing with original extraction for comparison and verification...`);

    // STEP 2: Original LLM extraction logic for comparison and verification
    console.log(`   🔍 Step 2: Original extraction logic for comparison...`);

    // Extract square footage using LLM - ask for clean number only
    const sqftPrompt = `Extract the house square footage (interior living space only, not lot size) from this text. Return ONLY the number with no commas, units, or other text:

"${text}"`;

    const sqftResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: sqftPrompt,
      grounded: true,
      json: false,
      timeoutMs: 10000
    });

    console.log(`   🔍 Original sqft response: "${sqftResponse}"`);
    const sqft = sqftResponse && sqftResponse.trim() ? Number(sqftResponse.trim()) : null;
    console.log(`   🔍 Original sqft parsed: ${sqft}`);

    // Extract bedrooms using LLM
    const bedsPrompt = `Extract the number of bedrooms from this text. Return ONLY the number:

"${text}"`;

    const bedsResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: bedsPrompt,
      grounded: true,
      json: false,
      timeoutMs: 10000
    });

    console.log(`   🔍 Original beds response: "${bedsResponse}"`);
    const beds = bedsResponse && bedsResponse.trim() ? Number(bedsResponse.trim()) : null;
    console.log(`   🔍 Original beds parsed: ${beds}`);

    // Extract bathrooms using LLM
    const bathsPrompt = `Extract the number of bathrooms (including half baths as 0.5) from this text. Return ONLY the number (use decimals like 2.5):

"${text}"`;

    const bathsResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: bathsPrompt,
      grounded: true,
      json: false,
      timeoutMs: 10000
    });

    console.log(`   🔍 Original baths response: "${bathsResponse}"`);
    const baths = bathsResponse && bathsResponse.trim() ? Number(bathsResponse.trim()) : null;
    console.log(`   🔍 Original baths parsed: ${baths}`);

    // Extract year built using LLM
    const yearPrompt = `Extract the year this property was built from this text. Return ONLY the 4-digit year:

"${text}"`;

    const yearResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: yearPrompt,
      grounded: true,
      json: false,
      timeoutMs: 10000
    });

    console.log(`   🔍 Original year response: "${yearResponse}"`);
    const yearBuilt = yearResponse && yearResponse.trim() ? Number(yearResponse.trim()) : null;
    console.log(`   🔍 Original year parsed: ${yearBuilt}`);

    // Try to extract subdivision/neighborhood from text
    let subdivision: string | null = null;
    try {
      const subPrompt = `From this text, what is the subdivision or neighborhood name of the property? If not present, answer UNKNOWN.\n\n"${text}"\n\nRespond with only the name or UNKNOWN.`;
      const subResp = await vertexGenerate({ sa, projectId, location, model, prompt: subPrompt, grounded: true, json: false, timeoutMs: 600000 });
      const cleaned = (subResp || '').trim();
      if (cleaned && !/^unknown$/i.test(cleaned)) {
        subdivision = cleaned.replace(/^[-\s:]+/, '').trim();
      }
    } catch {}

    // Try to extract property type from text
    let propertyType: string | null = null;
    try {
      console.log(`   🏠 Extracting property type from text...`);
      const typePrompt = `From this text, what is the property type? Answer with one of: single-family detached, townhome, condo, duplex, multi-family, or UNKNOWN.\n\n"${text}"\n\nRespond with only one of those exact terms.`;
      const typeResp = await vertexGenerate({ sa, projectId, location, model, prompt: typePrompt, grounded: true, json: false, timeoutMs: 600000 });
      console.log(`   🏠 Raw property type response: "${typeResp}"`);
      const cleaned = (typeResp || '').trim().toLowerCase();
      if (cleaned && !/^unknown$/i.test(cleaned)) {
        // Normalize property type terms
        if (cleaned.includes('duplex')) propertyType = 'duplex';
        else if (cleaned.includes('multi-family') || cleaned.includes('multifamily')) propertyType = 'multi-family';
        else if (cleaned.includes('condo')) propertyType = 'condo';
        else if (cleaned.includes('townhome') || cleaned.includes('townhouse')) propertyType = 'townhome';
        else if (cleaned.includes('single-family') || cleaned.includes('single family')) propertyType = 'single-family detached';
        console.log(`   🏠 Normalized property type: "${propertyType}"`);
      } else {
        console.log(`   🏠 Property type extraction returned: "${cleaned}" (treating as unknown)`);
      }
    } catch (error) {
      console.log(`   ❌ Property type extraction failed: ${error}`);
    }

    const originalData = { sqft, beds, baths, yearBuilt, lotSize: null, subdivision, propertyType };
    console.log(`   🤖 Original LLM Extraction: SQFT=${sqft}, Beds=${beds}, Baths=${baths}, Built=${yearBuilt}${subdivision ? `, Subdivision=${subdivision}` : ''}${propertyType ? `, Type=${propertyType}` : ''}`);

    // STEP 3: Enrich validation data with original extraction for missing fields only
    console.log(`   🔄 Step 3: Enriching validation data with original extraction...`);

    const finalData = { ...validationData };

    // Only use original data to fill missing fields from validation
    if (!finalData.sqft && sqft) {
      finalData.sqft = sqft;
      console.log(`   ✅ ENRICHED: Added sqft from original extraction: ${sqft}`);
    }
    if (!finalData.beds && beds) {
      finalData.beds = beds;
      console.log(`   ✅ ENRICHED: Added beds from original extraction: ${beds}`);
    }
    if (!finalData.baths && baths) {
      finalData.baths = baths;
      console.log(`   ✅ ENRICHED: Added baths from original extraction: ${baths}`);
    }
    if (!finalData.yearBuilt && yearBuilt) {
      finalData.yearBuilt = yearBuilt;
      console.log(`   ✅ ENRICHED: Added yearBuilt from original extraction: ${yearBuilt}`);
    }
    if (!finalData.subdivision && subdivision) {
      finalData.subdivision = subdivision;
      console.log(`   ✅ ENRICHED: Added subdivision from original extraction: ${subdivision}`);
    }
    if (!finalData.propertyType && propertyType) {
      finalData.propertyType = propertyType;
      console.log(`   ✅ ENRICHED: Added propertyType from original extraction: ${propertyType}`);
    }

    finalData.lotSize = null; // Always null for now

    // Check if we have critical missing fields after both extractions
    const missingCriticalFields = [];
    if (!finalData.sqft || finalData.sqft <= 0) missingCriticalFields.push('sqft');
    if (!finalData.beds || finalData.beds <= 0) missingCriticalFields.push('beds');
    if (!finalData.baths || finalData.baths <= 0) missingCriticalFields.push('baths');
    if (!finalData.yearBuilt) missingCriticalFields.push('yearBuilt');

    if (missingCriticalFields.length > 0) {
      console.log(`   ⚠️  Still missing critical fields after validation+original: ${missingCriticalFields.join(', ')}`);
      console.log(`   🔄 Step 4: Enhanced fallback detection for missing fields...`);

      // Try the existing fallback detection for ALL fields to get complete data
      console.log(`   🔍 Requesting complete fallback data for all fields to ensure accuracy...`);
      const fallbackData = address ? await fallbackPropertyDetection(address, sa, projectId, location, model, ['sqft', 'beds', 'baths', 'yearBuilt', 'propertyType']) : {};

      // Fill in any missing critical fields from fallback
      missingCriticalFields.forEach(field => {
        if (field === 'sqft' && fallbackData.sqft && (!finalData.sqft || finalData.sqft <= 0)) {
          finalData.sqft = fallbackData.sqft;
          console.log(`   ✅ Enhanced fallback: Found sqft = ${fallbackData.sqft}`);
        }
        if (field === 'beds' && fallbackData.beds && (!finalData.beds || finalData.beds <= 0)) {
          finalData.beds = fallbackData.beds;
          console.log(`   ✅ Enhanced fallback: Found beds = ${fallbackData.beds}`);
        }
        if (field === 'baths' && fallbackData.baths && (!finalData.baths || finalData.baths <= 0)) {
          finalData.baths = fallbackData.baths;
          console.log(`   ✅ Enhanced fallback: Found baths = ${fallbackData.baths}`);
        }
        if (field === 'yearBuilt' && fallbackData.yearBuilt && !finalData.yearBuilt) {
          finalData.yearBuilt = fallbackData.yearBuilt;
          console.log(`   ✅ Enhanced fallback: Found yearBuilt = ${fallbackData.yearBuilt}`);
        }
      });

      // VERIFICATION: If fallback found different values, do verification search to pick supported data
      if (fallbackData.yearBuilt && fallbackData.propertyType) {
        const hasConflicts =
          (finalData.yearBuilt && fallbackData.yearBuilt !== finalData.yearBuilt) ||
          (finalData.propertyType && fallbackData.propertyType !== finalData.propertyType);

        if (hasConflicts) {
          console.log(`   🔍 CONFLICT DETECTED: Verification search needed`);
          console.log(`   📊 Current: yearBuilt=${finalData.yearBuilt}, propertyType=${finalData.propertyType}`);
          console.log(`   📊 Fallback: yearBuilt=${fallbackData.yearBuilt}, propertyType=${fallbackData.propertyType}`);

          try {
            const verificationPrompt = `Search multiple real estate sources to verify conflicting property data for: ${address}

CONFLICTING DATA TO VERIFY:
- Year built: ${finalData.yearBuilt} vs ${fallbackData.yearBuilt}
- Property type: ${finalData.propertyType} vs ${fallbackData.propertyType}

Search these sources for consensus:
- site:zillow.com "${address}" year built property type
- site:redfin.com "${address}" year built property type
- site:realtor.com "${address}" year built property type
- "${address}" county records year built property type
- "${address}" tax assessor year built property type

Find which values have the most supporting evidence across multiple sources.

Respond in this exact format:
YEAR_BUILT: [the year with most evidence]
PROPERTY_TYPE: [the type with most evidence: single-family detached, multi-family, duplex, etc.]
EVIDENCE: [brief summary of which sources support the chosen values]`;

            const verificationResult = await vertexGenerate({
              sa, projectId, location, model,
              prompt: verificationPrompt,
              grounded: true,
              json: false,
              timeoutMs: 30000
            });

            console.log(`   🔍 Verification result: ${verificationResult}`);

            // Parse verification result
            const yearMatch = verificationResult.match(/YEAR_BUILT:\s*(\d{4})/i);
            const typeMatch = verificationResult.match(/PROPERTY_TYPE:\s*([^\n]+)/i);

            if (yearMatch) {
              const verifiedYear = parseInt(yearMatch[1]);
              finalData.yearBuilt = verifiedYear;
              console.log(`   ✅ VERIFIED: Using year built = ${verifiedYear}`);
            }

            if (typeMatch) {
              const verifiedType = typeMatch[1].trim();
              finalData.propertyType = verifiedType;
              console.log(`   ✅ VERIFIED: Using property type = ${verifiedType}`);
            }

          } catch (error) {
            console.log(`   ⚠️  Verification search failed, using fallback data: ${error}`);
            if (fallbackData.yearBuilt) finalData.yearBuilt = fallbackData.yearBuilt;
            if (fallbackData.propertyType) finalData.propertyType = fallbackData.propertyType;
          }
        }
      }

      // Final check - if still missing critical fields, one more attempt
      const stillMissing = [];
      if (!finalData.sqft || finalData.sqft <= 0) stillMissing.push('sqft');
      if (!finalData.beds || finalData.beds <= 0) stillMissing.push('beds');
      if (!finalData.baths || finalData.baths <= 0) stillMissing.push('baths');
      if (!finalData.yearBuilt) stillMissing.push('yearBuilt');

      if (stillMissing.length > 0) {
        console.log(`   🆘 Step 5: Last resort - manual extraction for: ${stillMissing.join(', ')}`);
        console.log(`   ❌ EXTRACTION FAILED: Could not find ${stillMissing.join(', ')} after all attempts`);
      } else {
        console.log(`   🎉 Enhanced fallback SUCCESS: All critical fields now found!`);
      }
    }

    // CONFLICT RESOLUTION: Use existing fallback data to resolve conflicts with validation data
    console.log(`   🔍 Conflict resolution: Using Step 2 fallback to validate Step 1 data...`);

    // We already have fallbackData from the enhanced fallback detection above
    // Let's also get the original validation conflicts we saw earlier
    const hasConflictingData = originalData.yearBuilt !== validationData.yearBuilt ||
                               originalData.propertyType !== validationData.propertyType;

    if (hasConflictingData) {
      console.log(`   🔍 CONFLICT DETECTED between validation and original extraction:`);
      console.log(`   📊 Validation: yearBuilt=${validationData.yearBuilt}, propertyType=${validationData.propertyType}`);
      console.log(`   📊 Original: yearBuilt=${originalData.yearBuilt}, propertyType=${originalData.propertyType}`);

      // Use the more complete dataset - prefer original extraction data when it has both fields
      if (originalData.yearBuilt && originalData.propertyType) {
        console.log(`   ✅ CONFLICT RESOLVED: Using original extraction data (more complete)`);
        finalData.yearBuilt = originalData.yearBuilt;
        finalData.propertyType = originalData.propertyType;
        console.log(`   ✅ RESOLVED: yearBuilt=${originalData.yearBuilt}, propertyType=${originalData.propertyType}`);
      } else if (validationData.yearBuilt && validationData.propertyType) {
        console.log(`   ✅ CONFLICT RESOLVED: Using validation data (more complete)`);
        finalData.yearBuilt = validationData.yearBuilt;
        finalData.propertyType = validationData.propertyType;
      }
    } else {
      console.log(`   ✅ No conflicts detected between validation and original data`);
    }

    console.log(`   📊 Final combined result: SQFT=${finalData.sqft}, Beds=${finalData.beds}, Baths=${finalData.baths}, Built=${finalData.yearBuilt}${finalData.subdivision ? `, Subdivision=${finalData.subdivision}` : ''}${finalData.propertyType ? `, Type=${finalData.propertyType}` : ''}`);

    return finalData;

  } catch (error) {
    console.log(`   ❌ LLM parsing completely failed, falling back to regex: ${error}`);
    console.log(`   📄 Text that caused LLM parsing failure: ${text.substring(0, 300)}...`);
    return parseFreeformRegex(text);
  }
}

// Keep original regex as fallback
function parseFreeformRegex(text: string): Partial<BasicDetails> {
  const clean = (s: string) => s.replace(/[,\s]/g, '').trim();

  // Simplified square footage parsing (keeping the problematic logic for fallback only)
  const sqftMatch = text.match(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet)/i);
  let sqft = null;
  if (sqftMatch) {
    const val = Number(clean(sqftMatch[1]));
    if (val >= 500 && val <= 10000) {
      sqft = val;
    }
  }

  // Simplified bedroom parsing for fallback
  const bedsMatch = text.match(/([0-9]{1,2})\s*(?:bedroom|bed|BR)/i);
  const beds = bedsMatch ? Number(bedsMatch[1]) : null;

  // Simplified bathroom parsing for fallback
  const bathsMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bathroom|bath|BA)/i);
  const baths = bathsMatch ? Number(bathsMatch[1]) : null;

  // Simplified year parsing for fallback
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const yearBuilt = yearMatch ? Number(yearMatch[0]) : null;

  return { sqft, beds, baths, yearBuilt, lotSize: null, subdivision: null, propertyType: null };
}

/**
 * Comprehensive fallback property detection for all missing critical fields
 */
async function fallbackPropertyDetection(
  address: string,
  sa: any,
  projectId: string,
  location: string,
  model: string,
  missingFields: string[]
): Promise<Partial<BasicDetails>> {
  console.log(`   🔍 Enhanced Fallback Detection for fields: ${missingFields.join(', ')}`);

  try {
    // Import vertexGenerate here to avoid circular dependency
    const { vertexGenerate } = await import('./vertex-freeform.js');

    // Strategy 1: Comprehensive property search targeting missing fields
    const fieldList = missingFields.map(field => {
      switch (field) {
        case 'sqft': return 'exact square footage (living area)';
        case 'beds': return 'number of bedrooms';
        case 'baths': return 'number of bathrooms (including half baths)';
        case 'yearBuilt': return 'year built';
        case 'propertyType': return 'property type (single-family, duplex, multi-family, townhome, condo)';
        default: return field;
      }
    }).join(', ');

    const comprehensiveSearch = `Search for detailed property information about "${address}". I need these specific details: ${fieldList}.

Look in:
- MLS listings with complete property details
- County assessor records with official specifications
- Real estate websites (Zillow, Redfin, Realtor.com) with verified data
- Public records and tax assessor databases

Respond with ONLY the specific information requested in this exact format:
SQFT: [exact square footage number]
BEDS: [number of bedrooms]
BATHS: [number of bathrooms including half baths as decimals]
YEAR: [4-digit year built]
TYPE: [single-family detached, townhome, condo, duplex, or multi-family]`;

    const result1 = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: comprehensiveSearch,
      grounded: true,
      timeoutMs: 60000
    });

    console.log(`   📋 Fallback Strategy 1 response: "${result1}"`);
    const parsed1 = parsePropertyResponse(result1);
    if (hasRequiredFields(parsed1, missingFields)) {
      console.log(`   ✅ Fallback Strategy 1 success: Found all missing fields`);
      return parsed1;
    }

    console.log(`   🔍 Fallback Strategy 2: County records focus...`);

    // Strategy 2: County records and official sources
    const countySearch = `Search official county assessor records and public property databases for "${address}". Find:
- Official property specifications from tax assessor
- Building permits with construction details
- County property records with exact measurements
- Official property classification codes

Return the official property data in this format:
SQFT: [square footage]
BEDS: [bedrooms]
BATHS: [bathrooms]
YEAR: [year built]
TYPE: [property type]`;

    const result2 = await vertexGenerate({
      sa,
      projectId,
      location,
      model,
      prompt: countySearch,
      grounded: true,
      timeoutMs: 60000
    });

    console.log(`   📋 Fallback Strategy 2 response: "${result2}"`);
    const parsed2 = parsePropertyResponse(result2);
    if (hasRequiredFields(parsed2, missingFields)) {
      console.log(`   ✅ Fallback Strategy 2 success: Found all missing fields`);
      return parsed2;
    }

    // Return partial results if we found some fields
    const combinedResults = { ...parsed1, ...parsed2 };
    if (Object.keys(combinedResults).length > 0) {
      console.log(`   ⚡ Partial fallback success: Found ${Object.keys(combinedResults).join(', ')}`);
      return combinedResults;
    }

    console.log(`   ❌ All fallback strategies failed to find missing fields`);
    return {};

  } catch (error) {
    console.log(`   ❌ Fallback property detection failed: ${error}`);
    return {};
  }
}

/**
 * Parse structured property response from fallback detection
 */
function parsePropertyResponse(response: string): Partial<BasicDetails> {
  if (!response) return {};

  const result: Partial<BasicDetails> = {};
  const lines = response.split('\n').map(line => line.trim());

  for (const line of lines) {
    if (line.toUpperCase().startsWith('SQFT:')) {
      const value = line.split(':')[1]?.trim();
      if (value && value !== 'UNKNOWN') {
        result.sqft = Number(value);
        console.log(`   🔧 Parsed sqft: ${result.sqft}`);
      }
    }

    if (line.toUpperCase().startsWith('BEDS:')) {
      const value = line.split(':')[1]?.trim();
      if (value && value !== 'UNKNOWN') {
        result.beds = Number(value);
        console.log(`   🔧 Parsed beds: ${result.beds}`);
      }
    }

    if (line.toUpperCase().startsWith('BATHS:')) {
      const value = line.split(':')[1]?.trim();
      if (value && value !== 'UNKNOWN') {
        result.baths = Number(value);
        console.log(`   🔧 Parsed baths: ${result.baths}`);
      }
    }

    if (line.toUpperCase().startsWith('YEAR:')) {
      const value = line.split(':')[1]?.trim();
      if (value && value !== 'UNKNOWN') {
        result.yearBuilt = Number(value);
        console.log(`   🔧 Parsed yearBuilt: ${result.yearBuilt}`);
      }
    }

    if (line.toUpperCase().startsWith('TYPE:')) {
      const value = line.split(':')[1]?.trim();
      if (value && value !== 'UNKNOWN') {
        result.propertyType = normalizePropertyType(value);
        console.log(`   🔧 Parsed propertyType: ${result.propertyType}`);
      }
    }
  }

  return result;
}

/**
 * Check if required fields were found in fallback data
 */
function hasRequiredFields(data: Partial<BasicDetails>, missingFields: string[]): boolean {
  for (const field of missingFields) {
    if (field === 'sqft' && (!data.sqft || data.sqft <= 0)) return false;
    if (field === 'beds' && (!data.beds || data.beds <= 0)) return false;
    if (field === 'baths' && (!data.baths || data.baths <= 0)) return false;
    if (field === 'yearBuilt' && !data.yearBuilt) return false;
    if (field === 'propertyType' && !data.propertyType) return false;
  }
  return true;
}

/**
 * Normalize property type response to standard values
 */
function normalizePropertyType(response: string): string | null {
  if (!response) return null;

  const cleaned = response.toLowerCase().trim();
  console.log(`   🔧 Normalizing property type response: "${cleaned}"`);

  if (cleaned.includes('duplex')) return 'duplex';
  if (cleaned.includes('multi-family') || cleaned.includes('multifamily')) return 'multi-family';
  if (cleaned.includes('condo')) return 'condo';
  if (cleaned.includes('townhome') || cleaned.includes('townhouse')) return 'townhome';
  if (cleaned.includes('single-family') || cleaned.includes('single family')) return 'single-family detached';

  console.log(`   ⚠️  Could not normalize property type: "${cleaned}"`);
  return null;
}

export async function fetchPropertyDetailsViaVertex(address: string): Promise<BasicDetails | null> {
  if (!hasServiceAccount()) return null;

  let sa;
  if (process.env.GCP_SA_JSON_B64) {
    // Production: base64 encoded JSON
    const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
    sa = JSON.parse(saJson);
  } else {
    // Local: file path
    const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
    sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  }
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const timeoutMs = Number(process.env.VERTEX_TIMEOUT_MS || '600000');

  // PRIMARY: Comprehensive grounded search for CRITICAL data
  let propertyDetails: Partial<BasicDetails> = {};

  try {
    const prompt = `Use Google Search grounding with authoritative real estate sources (Zillow, Redfin, Realtor.com, county records) to find COMPLETE property details for: ${address}

CRITICAL REQUIRED DATA (must find all):
- Exact square footage (living area only, not lot size)
- Number of bedrooms (exact count)
- Number of bathrooms (including half baths as 0.5)
- Year built (exact year)
- Property type (single-family detached, townhome, condo, duplex)

ADDITIONAL HELPFUL DATA:
- Lot size in square feet or acres
- Subdivision/neighborhood name
- Garage/parking spaces
- Stories/levels
- Special features (pool, basement, etc.)

Search specific sites:
- site:zillow.com "${address}"
- site:redfin.com "${address}"
- site:realtor.com "${address}"
- "${address}" county records property details

Provide specific facts with numbers. If any critical data is missing, clearly state "MISSING" for that field.`;

    const text = await vertexGenerate({ sa, projectId, location, model, prompt, grounded: true, json: false, timeoutMs });
    console.log(`   📄 Primary search response: ${text.substring(0, 200)}...`);

    console.log(`   🔄 Calling parseFreeformWithLLM for detailed extraction...`);
    propertyDetails = await parseFreeformWithLLM(text, sa, projectId, location, model, address);
    console.log(`   📊 Parsed data: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}, propertyType=${propertyDetails.propertyType}`);

  } catch (err) {
    console.log(`   ⚠️  Primary grounded search failed: ${err}`);
  }

  // CRITICAL DATA VALIDATION - Stop if missing essential fields
  const hasCriticalData = propertyDetails.sqft && propertyDetails.beds && propertyDetails.baths && propertyDetails.yearBuilt;

  if (!hasCriticalData) {
    console.log(`   🛑 MISSING CRITICAL DATA - Attempting targeted fallback searches...`);

    // FALLBACK: County records search for missing data
    const missingFields = [];
    if (!propertyDetails.sqft) missingFields.push('square footage');
    if (!propertyDetails.beds) missingFields.push('bedrooms');
    if (!propertyDetails.baths) missingFields.push('bathrooms');
    if (!propertyDetails.yearBuilt) missingFields.push('year built');

    try {
      const countyPrompt = `Use Google Search grounding to find missing property data from county records and tax assessor for: ${address}

MISSING FIELDS TO FIND: ${missingFields.join(', ')}

Search county assessor and tax records:
- "${address}" tax assessor records
- "${address}" property tax records
- "${address}" county property details
- "${address}" square feet bedrooms bathrooms

Focus only on finding: ${missingFields.join(', ')}. Provide exact numbers.`;

      const countyText = await vertexGenerate({ sa, projectId, location, model, prompt: countyPrompt, grounded: true, json: false, timeoutMs });
      const countyData = await parseFreeformWithLLM(countyText, sa, projectId, location, model, address);

      // Fill in missing critical data
      if (!propertyDetails.sqft && countyData.sqft) propertyDetails.sqft = countyData.sqft;
      if (!propertyDetails.beds && countyData.beds) propertyDetails.beds = countyData.beds;
      if (!propertyDetails.baths && countyData.baths) propertyDetails.baths = countyData.baths;
      if (!propertyDetails.yearBuilt && countyData.yearBuilt) propertyDetails.yearBuilt = countyData.yearBuilt;

      // OVERRIDE: If county data is more complete, use it for ALL fields including property type
      if (countyData.sqft && countyData.beds && countyData.baths && countyData.yearBuilt && countyData.propertyType) {
        console.log(`   🔄 County records provided complete data - using ALL county values for accuracy`);
        propertyDetails.sqft = countyData.sqft;
        propertyDetails.beds = countyData.beds;
        propertyDetails.baths = countyData.baths;
        propertyDetails.yearBuilt = countyData.yearBuilt;
        propertyDetails.propertyType = countyData.propertyType;
        console.log(`   ✅ OVERRIDE: Using complete county data - sqft=${countyData.sqft}, beds=${countyData.beds}, baths=${countyData.baths}, yearBuilt=${countyData.yearBuilt}, propertyType=${countyData.propertyType}`);
      } else {
        console.log(`   🔍 County records filled: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}`);
      }

    } catch (err) {
      console.log(`   ⚠️  County records search failed: ${err}`);
    }
  }

  // FINAL VALIDATION - Must have ALL critical data to proceed
  const finalValidation = propertyDetails.sqft && propertyDetails.beds && propertyDetails.baths && propertyDetails.yearBuilt;

  // Skip grounded JSON lookup for subdivision; leave as-is if missing

  if (!finalValidation) {
    const stillMissing = [];
    if (!propertyDetails.sqft) stillMissing.push('square footage');
    if (!propertyDetails.beds) stillMissing.push('bedrooms');
    if (!propertyDetails.baths) stillMissing.push('bathrooms');
    if (!propertyDetails.yearBuilt) stillMissing.push('year built');

    console.log(`   ❌ ANALYSIS STOPPED - Missing critical data: ${stillMissing.join(', ')}`);
    console.log(`   🛑 Cannot proceed with ARV analysis without complete property details`);
    return null;
  }

  console.log(`   ✅ All critical data found - Proceeding with analysis`);

  // FALLBACK: Enhanced detection for any missing critical fields
  const missingFields = [];
  if (!propertyDetails.sqft || propertyDetails.sqft <= 0) missingFields.push('sqft');
  if (!propertyDetails.beds || propertyDetails.beds <= 0) missingFields.push('beds');
  if (!propertyDetails.baths || propertyDetails.baths <= 0) missingFields.push('baths');
  if (!propertyDetails.yearBuilt) missingFields.push('yearBuilt');
  if (!propertyDetails.propertyType) missingFields.push('propertyType');

  if (missingFields.length > 0) {
    console.log(`   🔄 Missing critical fields: ${missingFields.join(', ')} - running enhanced fallback detection...`);
    const fallbackData = await fallbackPropertyDetection(address, sa, projectId, location, model, missingFields);

    // OVERRIDE: If final fallback is more complete, use it for ALL fields
    if (fallbackData.sqft && fallbackData.beds && fallbackData.baths && fallbackData.yearBuilt && fallbackData.propertyType) {
      console.log(`   🔄 Final fallback provided complete data - using ALL fallback values for accuracy`);
      propertyDetails.sqft = fallbackData.sqft;
      propertyDetails.beds = fallbackData.beds;
      propertyDetails.baths = fallbackData.baths;
      propertyDetails.yearBuilt = fallbackData.yearBuilt;
      propertyDetails.propertyType = fallbackData.propertyType;
      console.log(`   ✅ OVERRIDE: Using complete fallback data - sqft=${fallbackData.sqft}, beds=${fallbackData.beds}, baths=${fallbackData.baths}, yearBuilt=${fallbackData.yearBuilt}, propertyType=${fallbackData.propertyType}`);
    } else {
      // Fill in missing fields from fallback data
      if (fallbackData.sqft && (!propertyDetails.sqft || propertyDetails.sqft <= 0)) {
        propertyDetails.sqft = fallbackData.sqft;
        console.log(`   ✅ Fallback: Found sqft = ${fallbackData.sqft}`);
      }
      if (fallbackData.beds && (!propertyDetails.beds || propertyDetails.beds <= 0)) {
        propertyDetails.beds = fallbackData.beds;
        console.log(`   ✅ Fallback: Found beds = ${fallbackData.beds}`);
      }
      if (fallbackData.baths && (!propertyDetails.baths || propertyDetails.baths <= 0)) {
        propertyDetails.baths = fallbackData.baths;
        console.log(`   ✅ Fallback: Found baths = ${fallbackData.baths}`);
      }
      if (fallbackData.yearBuilt && !propertyDetails.yearBuilt) {
        propertyDetails.yearBuilt = fallbackData.yearBuilt;
        console.log(`   ✅ Fallback: Found yearBuilt = ${fallbackData.yearBuilt}`);
      }
      if (fallbackData.propertyType && !propertyDetails.propertyType) {
        propertyDetails.propertyType = fallbackData.propertyType;
        console.log(`   ✅ Fallback: Found propertyType = ${fallbackData.propertyType}`);
      }
    }
  }

  return normalize(address, propertyDetails);
}

function normalize(address: string, obj: any): BasicDetails {
  return {
    address,
    sqft: obj?.sqft != null && Number.isFinite(Number(obj.sqft)) ? Number(obj.sqft) : null,
    beds: obj?.beds != null && Number.isFinite(Number(obj.beds)) ? Number(obj.beds) : null,
    baths: obj?.baths != null ? Number(obj.baths) : null,
    yearBuilt: obj?.yearBuilt != null && Number.isFinite(Number(obj.yearBuilt)) ? Number(obj.yearBuilt) : null,
    lotSize: obj?.lotSize != null && Number.isFinite(Number(obj.lotSize)) ? Number(obj.lotSize) : null,
    subdivision: typeof obj?.subdivision === 'string' && obj.subdivision.trim().length > 0 ? obj.subdivision.trim() : null,
    propertyType: typeof obj?.propertyType === 'string' && obj.propertyType.trim().length > 0 ? obj.propertyType.trim() : null,
    success: true,
  };
}

