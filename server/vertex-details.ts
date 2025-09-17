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
  success: boolean;
};

function hasServiceAccount(): boolean {
  const p = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
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
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
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
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
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
    generationConfig: { temperature: 0, maxOutputTokens: 1500, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
  };
  // Use legacy grounding tool name expected by this project
  if (opts.grounded) payload.tools = [ { google_search: {} } as any ];
  if (opts.responseSchema) (payload.generationConfig as any).responseSchema = opts.responseSchema;
  const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
  const text = res?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
  return text;
}

function parseFreeform(text: string): Partial<BasicDetails> {
  const clean = (s: string) => s.replace(/[,\s]/g, '').trim();
  const num = (m: RegExpMatchArray | null) => (m ? Number(clean(m[1])) : null);

  // Enhanced square footage parsing with multiple patterns
  const sqftCandidates = [
    text.match(/(?:square\s*feet?|sq\s*ft|sqft)[:\s]*([0-9,]+)/i),
    text.match(/([0-9,]+)\s*(?:square\s*feet?|sq\s*ft|sqft)/i),
    text.match(/(?:living\s*area|floor\s*area)[:\s]*([0-9,]+)/i),
    text.match(/size[:\s]*([0-9,]+)\s*(?:sq|square)/i)
  ];
  let sqft = null;
  for (const candidate of sqftCandidates) {
    if (candidate) {
      const val = Number(clean(candidate[1]));
      if (val >= 500 && val <= 10000) { // Reasonable range
        sqft = val;
        break;
      }
    }
  }

  // Enhanced bedroom parsing with more patterns
  const bedsCandidates = [
    text.match(/(?:bedrooms?|beds?)[:\s]*([0-9]{1,2})/i),
    text.match(/([0-9]{1,2})\s*(?:bedroom|bed)\b/i),
    text.match(/(?:\b|\*)([0-9]{1,2})\s*(?:br|bd)\b/i),
    text.match(/([0-9]{1,2})\s*bed\s*[/\-]\s*[0-9]/i),
    text.match(/([0-9]{1,2})\s*BR/i),
    text.match(/\b([0-9]{1,2})\s*(?:bed|BR|bedroom)/i),
    text.match(/bed(?:room)?s?\D*?([0-9]{1,2})/i)
  ];
  let beds = null;
  for (const candidate of bedsCandidates) {
    if (candidate) {
      const val = Number(candidate[1]);
      if (val >= 1 && val <= 10) { // Reasonable range
        beds = val;
        break;
      }
    }
  }

  // Enhanced bathroom parsing with more patterns
  const bathsCandidates = [
    text.match(/(?:bathrooms?|baths?)[:\s]*([0-9]+(?:\.[0-9]+)?)/i),
    text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bathroom|bath)\b/i),
    text.match(/(?:\b|\*)([0-9]+(?:\.[0-9]+)?)\s*(?:ba|bath)\b/i),
    text.match(/([0-9]+(?:\.[0-9]+)?)\s*ba\s*\b/i),
    text.match(/([0-9]+(?:\.[0-9]+)?)\s*BA\b/i),
    text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:bath|BA|bathroom)/i),
    text.match(/bath(?:room)?s?\D*?([0-9]+(?:\.[0-9]+)?)/i),
    text.match(/[0-9]\s*bed\s*[/\-]\s*([0-9]+(?:\.[0-9]+)?)\s*bath/i)
  ];
  let baths = null;
  for (const candidate of bathsCandidates) {
    if (candidate) {
      const val = Number(candidate[1]);
      if (val >= 1 && val <= 10) { // Reasonable range
        baths = val;
        break;
      }
    }
  }

  // Enhanced year built parsing with more patterns
  const yearCandidates = [
    text.match(/(?:year\s*built|built\s*in?|constructed)[:\s]*([12][0-9]{3})/i),
    text.match(/([12][0-9]{3})\s*(?:build|built|construction)/i),
    text.match(/(?:from|circa|c\.)\s*([12][0-9]{3})/i),
    text.match(/built[:\s]*([12][0-9]{3})/i),
    text.match(/([12][0-9]{3})\s*built/i),
    text.match(/year[:\s]*([12][0-9]{3})/i),
    text.match(/([12][0-9]{3})\s*year/i),
    text.match(/\b([12][0-9]{3})\b/g)?.find(match => {
      const year = Number(match[1]);
      const currentYear = new Date().getFullYear();
      return year >= 1900 && year <= currentYear;
    })
  ].filter(Boolean);

  let yearBuilt = null;
  for (const candidate of yearCandidates) {
    if (candidate) {
      const val = Number(candidate[1]);
      const currentYear = new Date().getFullYear();
      if (val >= 1800 && val <= currentYear) { // Reasonable range
        yearBuilt = val;
        break;
      }
    }
  }

  // If still no year found, look for any 4-digit number that could be a year
  if (!yearBuilt) {
    const allFourDigits = text.match(/\b(19[0-9]{2}|20[0-9]{2})\b/g);
    if (allFourDigits) {
      const currentYear = new Date().getFullYear();
      for (const yearStr of allFourDigits) {
        const year = Number(yearStr);
        if (year >= 1900 && year <= currentYear) {
          yearBuilt = year;
          break;
        }
      }
    }
  }

  // Enhanced lot size parsing
  const lotCandidates = [
    text.match(/(?:lot\s*size)[:\s]*([0-9,]+(?:\.[0-9]+)?)\s*(?:sq\s*ft|square\s*feet)/i),
    text.match(/(?:lot)[:\s]*([0-9,]+(?:\.[0-9]+)?)\s*(?:acres?)/i),
    text.match(/([0-9,]+(?:\.[0-9]+)?)\s*(?:acre|ac)\s*lot/i)
  ];
  let lotSize = null;
  for (const candidate of lotCandidates) {
    if (candidate) {
      const val = Number(clean(candidate[1]));
      // Convert acres to square feet if needed
      if (text.toLowerCase().includes('acre') && val < 10) {
        lotSize = Math.round(val * 43560); // acres to sq ft
      } else if (val >= 1000 && val <= 500000) { // sq ft range
        lotSize = val;
      }
      if (lotSize) break;
    }
  }

  return { sqft, beds, baths, yearBuilt, lotSize };
}

export async function fetchPropertyDetailsViaVertex(address: string): Promise<BasicDetails | null> {
  if (!hasServiceAccount()) return null;
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const timeoutMs = Number(process.env.VERTEX_TIMEOUT_MS || '45000');

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

    propertyDetails = parseFreeform(text);
    console.log(`   📊 Parsed data: sqft=${propertyDetails.sqft}, beds=${propertyDetails.beds}, baths=${propertyDetails.baths}, yearBuilt=${propertyDetails.yearBuilt}`);

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
      const countyData = parseFreeform(countyText);

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
    success: true,
  };
}
