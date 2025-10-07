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
  confidence?: Partial<Record<'sqft'|'beds'|'baths'|'yearBuilt'|'propertyType'|'subdivision', number>>;
  source?: 'primary' | 'county' | 'reconciled';
};

// SPD Timeout Configuration (VPC-aware)
const SPD_PRIMARY_TIMEOUT_MS = Number(process.env.SPD_PRIMARY_TIMEOUT_MS ?? 25000);  // 25s for VPC overhead
const SPD_COUNTY_TIMEOUT_MS = Number(process.env.SPD_COUNTY_TIMEOUT_MS ?? 25000);    // 25s for VPC overhead
const SPD_PARSE_TIMEOUT_MS = Number(process.env.SPD_PARSE_TIMEOUT_MS ?? 15000);      // 15s for non-grounded parsing
const SPD_GRACE_WINDOW_MS = Number(process.env.SPD_GRACE_WINDOW_MS ?? 1500);         // 1.5s grace for reconciliation

function hasServiceAccount(): boolean {
  const gcpSaJson = process.env.GCP_SA_JSON;
  const serviceAccountJson = process.env.SERVICE_ACCOUNT_JSON;
  const gcpSaJsonB64 = process.env.GCP_SA_JSON_B64;

  console.log(`🔍 ENV CHECK: GCP_SA_JSON=${gcpSaJson ? 'SET' : 'NOT_SET'}`);
  console.log(`🔍 ENV CHECK: SERVICE_ACCOUNT_JSON=${serviceAccountJson ? 'SET' : 'NOT_SET'}`);
  console.log(`🔍 ENV CHECK: GCP_SA_JSON_B64=${gcpSaJsonB64 ? 'SET' : 'NOT_SET'}`);

  const p = gcpSaJson || serviceAccountJson || gcpSaJsonB64;
  const result = Boolean(p && p.trim().length > 0);
  console.log(`🔍 hasServiceAccount() returning: ${result}`);
  return result;
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

/**
 * Parse grounded text into structured JSON using non-grounded LLM
 * This replaces multiple grounded extraction calls with a single non-grounded parse
 */
async function parseTextToJSON(
  text: string,
  ctx: { sa: any; projectId: string; location: string; model: string }
): Promise<Partial<BasicDetails>> {
  const startTime = Date.now();

  const prompt = `You are a precise property data extractor. Extract property details from the text below.

CRITICAL RULES:
- Use ONLY the information provided in the text
- Never invent or assume values
- If a field is not found or unclear, omit it from the response
- Return valid JSON only

Extract these fields:
- sqft: interior living area square footage (integer)
- beds: number of bedrooms (integer)
- baths: number of bathrooms including half baths (float, e.g., 2.5)
- yearBuilt: year the property was built (integer)
- propertyType: one of: "single-family detached", "townhome", "condo", "duplex", "multi-family"
- subdivision: subdivision or neighborhood name (string)
- confidence: for each field, estimate confidence 0.0-1.0 based on source clarity

TEXT TO PARSE:
${text}

Return JSON with this structure:
{
  "sqft": <number>,
  "beds": <number>,
  "baths": <number>,
  "yearBuilt": <number>,
  "propertyType": "<type>",
  "subdivision": "<name>",
  "confidence": {
    "sqft": <0.0-1.0>,
    "beds": <0.0-1.0>,
    "baths": <0.0-1.0>,
    "yearBuilt": <0.0-1.0>,
    "propertyType": <0.0-1.0>,
    "subdivision": <0.0-1.0>
  }
}`;

  try {
    console.log(`   🔍 Calling non-grounded Vertex AI for JSON parsing (timeout: ${SPD_PARSE_TIMEOUT_MS}ms)...`);
    const responseText = await vertexGenerate({
      ...ctx,
      prompt,
      grounded: false,  // CRITICAL: No web search, just parse the provided text
      json: true,       // Request JSON output
      timeoutMs: SPD_PARSE_TIMEOUT_MS,
    });

    const duration = Date.now() - startTime;
    console.log(`   ✅ Vertex AI response received in ${duration}ms (${responseText.length} chars)`);

    try {
      const parsed = JSON.parse(responseText);
      console.log(`   ✅ JSON.parse() successful: parsed ${Object.keys(parsed).length} fields`);
      console.log(`   ⚡ Non-grounded JSON parse completed in ${duration}ms`);
      return parsed;
    } catch (jsonError) {
      console.error(`   ❌ JSON.parse() failed after ${duration}ms:`, jsonError);
      console.error(`   📄 Response text that failed to parse (first 500 chars): "${responseText.substring(0, 500)}"`);
      return {};
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`   ❌ Vertex AI call failed after ${duration}ms:`, error);
    if (error instanceof Error) {
      console.error(`   📋 Error message: ${error.message}`);
      console.error(`   📋 Error stack: ${error.stack?.split('\n')[0]}`);
    }
    return {};
  }
}

/**
 * Reconcile primary and county results with authority preference
 * County is authoritative for sqft/yearBuilt, primary for other fields
 */
function reconcileResults(
  primary: Partial<BasicDetails>,
  county: Partial<BasicDetails>,
  primaryWon: boolean
): BasicDetails {
  console.log(`   🔄 Reconciling: primary (${primaryWon ? 'winner' : 'loser'}) vs county (${primaryWon ? 'loser' : 'winner'})`);
  console.log(`   📊 Primary data: sqft=${primary.sqft}, beds=${primary.beds}, baths=${primary.baths}, yearBuilt=${primary.yearBuilt}, type=${primary.propertyType}`);
  console.log(`   📊 County data: sqft=${county.sqft}, beds=${county.beds}, baths=${county.baths}, yearBuilt=${county.yearBuilt}, type=${county.propertyType}`);

  const winner = primaryWon ? primary : county;
  const loser = primaryWon ? county : primary;

  // Authority preference: county for sqft/yearBuilt, winner for others
  const reconciled: Partial<BasicDetails> = {
    // Prefer county for authoritative fields (tax assessor data)
    sqft: county.sqft || primary.sqft,
    yearBuilt: county.yearBuilt || primary.yearBuilt,

    // Prefer winner for other fields (faster, less critical)
    beds: winner.beds || loser.beds,
    baths: winner.baths || loser.baths,
    propertyType: winner.propertyType || loser.propertyType,
    subdivision: winner.subdivision || loser.subdivision,

    // Merge confidence scores
    confidence: {
      sqft: Math.max(county.confidence?.sqft ?? 0, primary.confidence?.sqft ?? 0),
      beds: Math.max(winner.confidence?.beds ?? 0, loser.confidence?.beds ?? 0),
      baths: Math.max(winner.confidence?.baths ?? 0, loser.confidence?.baths ?? 0),
      yearBuilt: Math.max(county.confidence?.yearBuilt ?? 0, primary.confidence?.yearBuilt ?? 0),
      propertyType: Math.max(winner.confidence?.propertyType ?? 0, loser.confidence?.propertyType ?? 0),
      subdivision: Math.max(winner.confidence?.subdivision ?? 0, loser.confidence?.subdivision ?? 0),
    },

    source: 'reconciled' as const,
  };

  console.log(`   ✅ Reconciliation complete:`);
  console.log(`      - sqft=${reconciled.sqft} (from ${county.sqft ? 'county' : 'primary'})`);
  console.log(`      - yearBuilt=${reconciled.yearBuilt} (from ${county.yearBuilt ? 'county' : 'primary'})`);
  console.log(`      - beds=${reconciled.beds} (from ${primaryWon ? 'primary' : 'county'})`);
  console.log(`      - baths=${reconciled.baths} (from ${primaryWon ? 'primary' : 'county'})`);
  console.log(`      - type=${reconciled.propertyType} (from ${primaryWon ? 'primary' : 'county'})`);

  return reconciled as BasicDetails;
}

/**
 * Sleep promise for grace window timeout
 */
function sleep(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('grace window expired')), ms));
}

// [DEPRECATED] Old sequential parsing function - replaced by parseTextToJSON
// Keeping below for reference only, not used in optimized SPD flow
/*
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

    // **FAST-FAIL: Check if LLM extraction found ZERO critical data**
    // If all critical fields are missing, the address is likely invalid - fail immediately
    const allCriticalFieldsMissing = !sqft && !beds && !baths && !yearBuilt;

    if (allCriticalFieldsMissing) {
      console.error(`   ❌ FAST-FAIL: Initial LLM extraction found ZERO critical property data`);
      console.error(`      sqft=${sqft}, beds=${beds}, baths=${baths}, yearBuilt=${yearBuilt}`);
      console.error(`      This indicates an invalid or incomplete address - failing immediately without fallback strategies`);
      throw new Error(`Invalid address - no property data found. Please verify the address is complete and correct.`);
    }

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
    // Re-throw fast-fail errors immediately - don't fallback to regex
    if (error instanceof Error && error.message.includes('Invalid address - no property data found')) {
      throw error;
    }

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
*/

// [DEPRECATED] Removed old sequential parsing helper functions (fallbackPropertyDetection, parsePropertyResponse,
// hasRequiredFields, normalizePropertyType) - replaced by parallel SPD with parseTextToJSON in optimized flow

export async function fetchPropertyDetailsViaVertex(address: string): Promise<BasicDetails | null> {
  const totalStartTime = Date.now();

  console.log(`🔍 SPD ENTRY: fetchPropertyDetailsViaVertex called for ${address}`);
  const hasSA = hasServiceAccount();
  console.log(`🔍 SPD SERVICE ACCOUNT CHECK: ${hasSA}`);

  if (!hasSA) {
    console.log(`❌ SPD ABORTED: No service account found - returning null`);
    return null;
  }

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

  const ctx = { sa, projectId, location, model };

  console.log(`\n🚀 OPTIMIZED SPD: Parallel Primary + County fetch for: ${address}`);

  // ===== STEP 1: Parallel Grounded Fetch (Primary + County) =====
  const primaryPrompt = `Use Google Search grounding with authoritative real estate sources (Zillow, Redfin, Realtor.com, county records) to find COMPLETE property details for: ${address}

CRITICAL REQUIRED DATA (must find all):
- Exact square footage (living area only, not lot size)
- Number of bedrooms (exact count)
- Number of bathrooms (including half baths as 0.5)
- Year built (exact year)
- Property type (single-family detached, townhome, condo, duplex)

ADDITIONAL HELPFUL DATA:
- Subdivision/neighborhood name
- Lot size in square feet or acres

Search specific sites:
- site:zillow.com "${address}"
- site:redfin.com "${address}"
- site:realtor.com "${address}"
- "${address}" county records property details

Provide specific facts with numbers and source URLs.`;

  const countyPrompt = `Use Google Search grounding to find property data from county records and tax assessor for: ${address}

Search county assessor and tax records:
- "${address}" tax assessor records
- "${address}" property tax records
- "${address}" county property details
- "${address}" square feet bedrooms bathrooms year built

Focus on official county/tax data. Provide exact numbers and source URLs.`;

  const primaryStart = Date.now();
  const countyStart = Date.now();

  const primaryPromise = vertexGenerate({ ...ctx, prompt: primaryPrompt, grounded: true, json: false, timeoutMs: SPD_PRIMARY_TIMEOUT_MS })
    .then(text => {
      const duration = Date.now() - primaryStart;
      console.log(`   ✅ Primary grounded search completed in ${duration}ms`);
      return { text, source: 'primary' as const, duration, error: null };
    })
    .catch(err => {
      const duration = Date.now() - primaryStart;
      console.error(`   ❌ Primary grounded search failed after ${duration}ms:`, err.message || err);
      return { text: null, source: 'primary' as const, duration, error: err };
    });

  const countyPromise = vertexGenerate({ ...ctx, prompt: countyPrompt, grounded: true, json: false, timeoutMs: SPD_COUNTY_TIMEOUT_MS })
    .then(text => {
      const duration = Date.now() - countyStart;
      console.log(`   ✅ County grounded search completed in ${duration}ms`);
      return { text, source: 'county' as const, duration, error: null };
    })
    .catch(err => {
      const duration = Date.now() - countyStart;
      console.error(`   ❌ County grounded search failed after ${duration}ms:`, err.message || err);
      return { text: null, source: 'county' as const, duration, error: err };
    });

  // Race to get the first winner
  const winnerResult = await Promise.race([primaryPromise, countyPromise]);
  console.log(`   🏆 Winner: ${winnerResult.source} (${winnerResult.duration}ms)`);

  if (!winnerResult.text) {
    console.error(`   ❌ Winner ${winnerResult.source} failed after ${winnerResult.duration}ms:`, winnerResult.error?.message || winnerResult.error);
    // Wait for the other one
    console.log(`   🔄 Waiting for ${winnerResult.source === 'primary' ? 'county' : 'primary'} to complete...`);
    const [p, c] = await Promise.all([primaryPromise, countyPromise]);
    const loserResult = winnerResult.source === 'primary' ? c : p;

    if (!loserResult.text) {
      console.error(`   ❌ Loser ${loserResult.source} also failed after ${loserResult.duration}ms:`, loserResult.error?.message || loserResult.error);
      console.error(`   🛑 FATAL: Both primary and county searches failed - cannot retrieve SPD`);
      return null;
    }

    console.log(`   🔄 Using fallback: ${loserResult.source} (${loserResult.duration}ms)`);
    // Parse the loser
    try {
      const parseStart = Date.now();
      const parsed = await parseTextToJSON(loserResult.text, ctx);
      const parseDuration = Date.now() - parseStart;
      console.log(`   ✅ Fallback parse completed in ${parseDuration}ms`);
      return normalize(address, { ...parsed, source: loserResult.source, lotSize: null, success: true });
    } catch (err) {
      console.error(`   ❌ Fallback parse failed:`, err);
      return null;
    }
  }

  // ===== STEP 2: Parse Winner Immediately =====
  console.log(`   🔍 Parsing winner (${winnerResult.source})...`);
  let parsedWinner: Partial<BasicDetails>;
  try {
    const parseStart = Date.now();
    parsedWinner = await parseTextToJSON(winnerResult.text, ctx);
    const parseDuration = Date.now() - parseStart;
    console.log(`   ✅ Winner parsed in ${parseDuration}ms: sqft=${parsedWinner.sqft}, beds=${parsedWinner.beds}, baths=${parsedWinner.baths}, yearBuilt=${parsedWinner.yearBuilt}`);
  } catch (err) {
    console.error(`   ❌ Winner parse failed:`, err);
    console.log(`   🔄 Waiting for loser to complete...`);
    // Try the loser
    const loserPromise = winnerResult.source === 'primary' ? countyPromise : primaryPromise;
    const loserResult = await loserPromise;
    if (!loserResult.text) {
      console.error(`   ❌ Loser also failed - cannot retrieve SPD`);
      return null;
    }
    try {
      const parseStart = Date.now();
      parsedWinner = await parseTextToJSON(loserResult.text, ctx);
      const parseDuration = Date.now() - parseStart;
      console.log(`   ✅ Loser parsed in ${parseDuration}ms (used as fallback)`);
      return normalize(address, { ...parsedWinner, source: loserResult.source, lotSize: null, success: true });
    } catch (err2) {
      console.error(`   ❌ Loser parse also failed:`, err2);
      return null;
    }
  }

  // ===== STEP 3: Grace Window for Loser (for reconciliation) =====
  console.log(`   ⏱️  Waiting ${SPD_GRACE_WINDOW_MS}ms for ${winnerResult.source === 'primary' ? 'county' : 'primary'} (grace window)...`);
  let parsedLoser: Partial<BasicDetails> | null = null;
  try {
    const loserPromise = winnerResult.source === 'primary' ? countyPromise : primaryPromise;
    const loserResult = await Promise.race([
      loserPromise,
      sleep(SPD_GRACE_WINDOW_MS)
    ]);

    if (loserResult && loserResult.text) {
      console.log(`   ✅ Loser arrived in grace window: ${loserResult.source} (${loserResult.duration}ms)`);
      try {
        const parseStart = Date.now();
        parsedLoser = await parseTextToJSON(loserResult.text, ctx);
        const parseDuration = Date.now() - parseStart;
        console.log(`   ✅ Loser parsed in ${parseDuration}ms: sqft=${parsedLoser.sqft}, beds=${parsedLoser.beds}, baths=${parsedLoser.baths}, yearBuilt=${parsedLoser.yearBuilt}`);
      } catch (err) {
        console.error(`   ❌ Loser parse failed:`, err);
        parsedLoser = null;
      }
    } else if (loserResult && !loserResult.text) {
      console.error(`   ❌ Loser ${loserResult.source} failed in grace window after ${loserResult.duration}ms:`, loserResult.error?.message || loserResult.error);
    }
  } catch (err) {
    console.log(`   ⏱️  Grace window expired (${SPD_GRACE_WINDOW_MS}ms) - using winner only`);
  }

  // ===== STEP 4: Reconcile if we have both =====
  let finalDetails: Partial<BasicDetails>;

  if (parsedLoser) {
    const primaryWon = winnerResult.source === 'primary';
    const primaryData = primaryWon ? parsedWinner : parsedLoser;
    const countyData = primaryWon ? parsedLoser : parsedWinner;

    console.log(`   🔄 Reconciling: primary=${primaryWon ? 'winner' : 'loser'}, county=${primaryWon ? 'loser' : 'winner'}`);
    finalDetails = reconcileResults(primaryData, countyData, primaryWon);
  } else {
    console.log(`   📋 Using winner only (no reconciliation): ${winnerResult.source}`);
    finalDetails = { ...parsedWinner, source: winnerResult.source };
  }

  // ===== STEP 5: Final Validation =====
  console.log(`   🔍 Validating final details...`);
  const hasCriticalData = finalDetails.sqft && finalDetails.beds && finalDetails.baths && finalDetails.yearBuilt;

  if (!hasCriticalData) {
    const missing = [];
    if (!finalDetails.sqft) missing.push('sqft');
    if (!finalDetails.beds) missing.push('beds');
    if (!finalDetails.baths) missing.push('baths');
    if (!finalDetails.yearBuilt) missing.push('yearBuilt');

    console.error(`   ❌ Validation failed - Missing critical fields: ${missing.join(', ')}`);
    console.error(`   📊 Partial data: sqft=${finalDetails.sqft}, beds=${finalDetails.beds}, baths=${finalDetails.baths}, yearBuilt=${finalDetails.yearBuilt}`);
    console.error(`   🛑 FATAL: Cannot proceed - insufficient data for SPD`);
    return null;
  }

  const totalDuration = Date.now() - totalStartTime;
  console.log(`   ✅ Validation passed - All critical fields present`);
  console.log(`   ✅ SPD Complete in ${totalDuration}ms (${(totalDuration/1000).toFixed(1)}s)`);
  console.log(`   📊 Final: sqft=${finalDetails.sqft}, beds=${finalDetails.beds}, baths=${finalDetails.baths}, yearBuilt=${finalDetails.yearBuilt}, type=${finalDetails.propertyType}, source=${finalDetails.source}`);

  return normalize(address, { ...finalDetails, lotSize: null, success: true });
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

