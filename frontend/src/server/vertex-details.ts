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
async function parseFreeformWithLLM(text: string, sa: any, projectId: string, location: string, model: string): Promise<Partial<BasicDetails>> {
  console.log(`   🤖 Starting LLM extraction for property details...`);
  try {
    // Extract square footage using LLM - this solves the house vs lot size confusion
    const sqftPrompt = `What is the house square footage (interior/living space only, not lot size) in this text?

"${text}"

Give only the number, no commas or units.`;

    const sqftResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: sqftPrompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    const sqft = sqftResponse.match(/\d+/) ? Number(sqftResponse.replace(/[^\d]/g, '')) : null;

    // Extract bedrooms using LLM
    const bedsPrompt = `How many bedrooms are in this property?

"${text}"

Give only the number.`;

    const bedsResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: bedsPrompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    const beds = bedsResponse.match(/\d+/) ? Number(bedsResponse.replace(/[^\d]/g, '')) : null;

    // Extract bathrooms using LLM
    const bathsPrompt = `How many bathrooms (including half baths as 0.5) are in this property?

"${text}"

Give only the number (use decimals like 2.5).`;

    const bathsResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: bathsPrompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    const baths = bathsResponse.match(/[\d.]+/) ? Number(bathsResponse.match(/[\d.]+/)?.[0]) : null;

    // Extract year built using LLM
    const yearPrompt = `What year was this property built?

"${text}"

Give only the 4-digit year.`;

    const yearResponse = await vertexGenerate({
      sa, projectId, location, model,
      prompt: yearPrompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    const yearBuilt = yearResponse.match(/\b(19|20)\d{2}\b/) ? Number(yearResponse.match(/\b(19|20)\d{2}\b/)?.[0]) : null;

    // Try to extract subdivision/neighborhood from text
    let subdivision: string | null = null;
    try {
      const subPrompt = `From this text, what is the subdivision or neighborhood name of the property? If not present, answer UNKNOWN.\n\n"${text}"\n\nRespond with only the name or UNKNOWN.`;
      const subResp = await vertexGenerate({ sa, projectId, location, model, prompt: subPrompt, grounded: false, json: false, timeoutMs: 600000 });
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
      const typeResp = await vertexGenerate({ sa, projectId, location, model, prompt: typePrompt, grounded: false, json: false, timeoutMs: 600000 });
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

    console.log(`   🤖 LLM Extraction: SQFT=${sqft}, Beds=${beds}, Baths=${baths}, Built=${yearBuilt}${subdivision ? `, Subdivision=${subdivision}` : ''}${propertyType ? `, Type=${propertyType}` : ''}`);

    return { sqft, beds, baths, yearBuilt, lotSize: null, subdivision, propertyType };

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
    propertyDetails = await parseFreeformWithLLM(text, sa, projectId, location, model);
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
      const countyData = await parseFreeformWithLLM(countyText, sa, projectId, location, model);

      // Fill in missing critical data
      if (!propertyDetails.sqft && countyData.sqft) propertyDetails.sqft = countyData.sqft;
      if (!propertyDetails.beds && countyData.beds) propertyDetails.beds = countyData.beds;
      if (!propertyDetails.baths && countyData.baths) propertyDetails.baths = countyData.baths;
      if (!propertyDetails.yearBuilt && countyData.yearBuilt) propertyDetails.yearBuilt = countyData.yearBuilt;

      console.log(`   🔍 County records filled: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}`);

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
