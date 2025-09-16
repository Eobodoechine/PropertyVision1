import { GoogleGenAI } from '@google/genai';
import { LLaMAParser } from './llama-parser.js';
import { GeminiParser } from './gemini-parser.js';

interface ComparableProperty {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
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

class ComparableSearchService {
  private client: GoogleGenAI;
  private googleMapsApiKey: string;
  private llamaParser: LLaMAParser;
  private geminiParser: GeminiParser;
  // Simple in-memory geocode cache for comp addresses across stages
  private geocodeCache: Map<string, { lat: number; lon: number }>; 

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.client = new GoogleGenAI({ apiKey });
    
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.googleMapsApiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }
    
    this.llamaParser = new LLaMAParser();
    this.geminiParser = new GeminiParser();
    this.geocodeCache = new Map();
  }

  async findComparables(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number,
    maxResults: number = 10,
    timeWindowMonths: number = 24,
    subjectBeds?: number,
    subjectBaths?: number,
    subjectSqft?: number,
    subjectYearBuilt?: number,
    subjectPropertyType?: string
  ): Promise<FindComparablesResult> {
    try {
      // Grounded freeform pathway (parse text), restrict to subdivision if available via env
      if (process.env.REQUIRE_GROUNDED === '1') {
        try {
          const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
          if (!saPath) throw new Error('Set GCP_SA_JSON');
          const sa = JSON.parse((await import('fs')).default.readFileSync(saPath, 'utf-8')) as any;
          const https = await import('https');
          const crypto = await import('crypto');
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
          const subdivision = process.env.SUBDIVISION?.trim();
          const subLine = subdivision ? `Only include properties in subdivision "${subdivision}".` : '';
          const typeWanted = (subjectPropertyType || process.env.SUBJECT_TYPE || '').toLowerCase();
          const typeLine = typeWanted ? `Only include property type: ${typeWanted} (use synonyms: townhome/townhouse/rowhouse for townhome).` : '';
          const prompt = `Facts only. No valuation. List RECENTLY SOLD (closed) comps near "${subjectAddress}" within ${searchRadius} miles over the last ${timeWindowMonths} months. ${subLine} ${typeLine}\nFor each comp, include: address, sold price, sold date (YYYY-MM-DD), beds, baths, sqft, year built, and a source URL. Include the property type token (e.g., townhome/townhouse/rowhouse) in the line text.\nFormat: one comp per line using pipe separators: address | sold_price | sold_date | beds | baths | sqft | year_built | source_url`;
          const { groundedFreeform } = await import('./vertex-freeform.js');
          const { text } = await groundedFreeform({ accessToken, projectId, location, model, prompt, maxOutputTokens: 1800 });
          const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          const comps: ComparableProperty[] = [];
          const missingSqft: { addr: string; price: number; dateStr: string; beds: number; baths: number; yearBuilt: number; url: string }[] = [];
          const typeMatch = (want: string, lineLower: string) => {
            if (!want) return true;
            if (/townhome|townhouse|rowhouse|row\s*house/.test(want))
              return /(town\s*house|townhome|row\s*house)/.test(lineLower);
            if (/single[_-]?family|detached/.test(want))
              return /(single[-\s]*family|detached)/.test(lineLower);
            if (/condo|minium/.test(want)) return /(condo|minium)/.test(lineLower);
            if (/multi[_-]?family|duplex|triplex|fourplex/.test(want)) return /(multi[-\s]*family|duplex|triplex|fourplex)/.test(lineLower);
            return true;
          };
          for (const line of lines) {
            const parts = line.split('|').map(s => s.trim());
            if (parts.length < 8) continue;
            const [addr, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;
            // Reject placeholders or empties
            if (!addr || /^(address|123\s+main\s+st|example)/i.test(addr)) continue;
            const lineLower = line.toLowerCase();
            if (!typeMatch(typeWanted, lineLower)) continue;
            const price = Number(priceStr.replace(/[^0-9.]/g, ''));
            const sqft = Number(sqftStr.replace(/[^0-9.]/g, ''));
            const beds = Number(bedsStr);
            const baths = Number(bathsStr);
            const yearBuilt = Number(ybStr);
            // Reasonable checks (nationwide wholesaling range)
            if (!Number.isFinite(price) || price < 20000 || price > 10000000) continue;
            // Require sold_date in YYYY-MM-DD and within time window
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) continue;
            const dt = new Date(dateStr as string);
            if (isNaN(dt.getTime())) continue;
            const threshold = new Date();
            threshold.setMonth(threshold.getMonth() - timeWindowMonths);
            if (dt < threshold) continue;
            // Enforce sold signal and reject rentals (best-effort)
            const urlLower = String(url || '').toLowerCase();
            if (/rent|for-rent|forrent/.test(urlLower)) continue;
            if (!/(sold|recently[_-]?sold|closed)/.test(lineLower) && !/(sold|recently[_-]?sold|closed)/.test(urlLower)) continue;
            // If sqft present, keep; otherwise collect for enrichment later
            if (!Number.isFinite(sqft) || sqft <= 0) {
              missingSqft.push({ addr, price, dateStr: dateStr as string, beds: Number.isFinite(beds)?beds:0, baths: Number.isFinite(baths)?baths:0, yearBuilt: Number.isFinite(yearBuilt)?yearBuilt:0, url: url || '' });
              continue;
            }
            // Compute distance via geocode
            const dist = await this.calculateDistance(addr, subjectLat, subjectLon, 3000);
            if (!Number.isFinite(dist) || dist > searchRadius + 0.3) continue;
            comps.push({
              address: addr,
              price,
              sqft: Number.isFinite(sqft) ? sqft : 0,
              beds: Number.isFinite(beds) ? beds : 0,
              baths: Number.isFinite(baths) ? baths : 0,
              yearBuilt: Number.isFinite(yearBuilt) ? yearBuilt : 0,
              soldDate: dateStr || '',
              distance: dist,
              source: url || '',
              confidence: 'medium'
            });
          }
          console.log(`   ✅ Parsed ${comps.length} grounded comps (freeform)`);
          if (comps.length >= 3) {
            return { comparables: comps, success: true };
          }
          // If not enough comps, retry without subdivision restriction
          const prompt2 = `Facts only. No valuation. List RECENTLY SOLD (closed) comps near "${subjectAddress}" within ${searchRadius} miles over the last ${timeWindowMonths} months. ${typeLine}\nFor each comp, include: address, sold price, sold date (YYYY-MM-DD), beds, baths, sqft, year built, and a source URL. Include the property type token (e.g., townhome/townhouse/rowhouse) in the line text.\nFormat: one comp per line using pipe separators: address | sold_price | sold_date | beds | baths | sqft | year_built | source_url`;
          const { text: text2 } = await groundedFreeform({ accessToken, projectId, location, model, prompt: prompt2, maxOutputTokens: 1800 });
          const comps2: ComparableProperty[] = [];
          const missingSqft2: typeof missingSqft = [];
          for (const line of text2.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
            const parts = line.split('|').map(s => s.trim());
            if (parts.length < 8) continue;
            const [addr, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;
            if (!addr || /^(address|123\s+main\s+st|example)/i.test(addr)) continue;
            const price = Number(priceStr.replace(/[^0-9.]/g, ''));
            const sqft = Number(sqftStr.replace(/[^0-9.]/g, ''));
            const beds = Number(bedsStr);
            const baths = Number(bathsStr);
            const yearBuilt = Number(ybStr);
            if (!Number.isFinite(price) || price < 20000 || price > 10000000) continue;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) continue;
            const dt = new Date(dateStr as string);
            if (isNaN(dt.getTime())) continue;
            const threshold = new Date();
            threshold.setMonth(threshold.getMonth() - timeWindowMonths);
            if (dt < threshold) continue;
            const lineLower = line.toLowerCase();
            const urlLower = String(url || '').toLowerCase();
            if (/rent|for-rent|forrent/.test(urlLower)) continue;
            if (!/(sold|recently[_-]?sold|closed)/.test(lineLower) && !/(sold|recently[_-]?sold|closed)/.test(urlLower)) continue;
            if (!Number.isFinite(sqft) || sqft <= 0) { missingSqft2.push({ addr, price, dateStr: dateStr as string, beds: Number.isFinite(beds)?beds:0, baths: Number.isFinite(baths)?baths:0, yearBuilt: Number.isFinite(yearBuilt)?yearBuilt:0, url: url || '' }); continue; }
            const dist = await this.calculateDistance(addr, subjectLat, subjectLon, 3000);
            if (!Number.isFinite(dist) || dist > searchRadius + 0.3) continue;
            comps2.push({ address: addr, price, sqft, beds: Number.isFinite(beds)?beds:0, baths: Number.isFinite(baths)?baths:0, yearBuilt: Number.isFinite(yearBuilt)?yearBuilt:0, soldDate: dateStr || '', distance: dist, source: url || '', confidence: 'medium' });
          }
          let merged = [...comps, ...comps2];
          console.log(`   ✅ Parsed ${merged.length} grounded comps (with non-subdivision)`);
          if (merged.length >= 3) return { comparables: merged, success: true };
          // Enrich missing sqft via grounded schema (county records)
          const toEnrich = [...missingSqft, ...missingSqft2];
          const urlGen = (addr: string) => `Return ONLY JSON: {"sqft": number|null}. Prefer county/assessor records. Address: ${addr}`;
          for (const m of toEnrich) {
            try {
              const schema = { type: 'OBJECT', properties: { sqft: { type: 'NUMBER', nullable: true } } } as any;
              const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
              const payload: any = { contents: [{ role: 'user', parts: [{ text: urlGen(m.addr) }]}], generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: 'application/json', responseSchema: schema }, tools: [{ google_search: {} } as any] };
              const enriched: any = await new Promise((resolve, reject) => {
                const u = new URL(endpoint);
                const body = JSON.stringify(payload);
                const httpsMod = (https as any).default ? (https as any).default : (https as any);
                const req = httpsMod.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), Authorization: `Bearer ${accessToken}` } }, (r: any) => {
                  let data = '';
                  r.on('data', c => data += c);
                  r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
                });
                req.on('error', reject);
                req.write(body);
                req.end();
              });
              const textJson = enriched?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              const obj = textJson ? JSON.parse(textJson) : null;
              const sqft = obj?.sqft != null ? Number(obj.sqft) : NaN;
              if (!Number.isFinite(sqft) || sqft <= 0) continue;
              const dist = await this.calculateDistance(m.addr, subjectLat, subjectLon, 3000);
              if (!Number.isFinite(dist) || dist > searchRadius + 0.3) continue;
              merged.push({ address: m.addr, price: m.price, sqft, beds: m.beds, baths: m.baths, yearBuilt: m.yearBuilt, soldDate: m.dateStr, distance: dist, source: m.url, confidence: 'low' });
              if (merged.length >= 3) break;
            } catch {}
          }
          return { comparables: merged, success: merged.length >= 3, error: merged.length >= 3 ? undefined : 'not-enough-grounded-comps' };
        } catch (e: any) {
          console.log(`   ⚠️ Grounded comps failed: ${e?.message || e}`);
          return { comparables: [], success: false, error: e?.message || 'grounded-failed' };
        }
      }
      console.log(`🔍 SEARCHING COMPARABLES: ${subjectAddress}`);
      console.log(`   • Radius: ${searchRadius} miles`);
      console.log(`   • Max results: ${maxResults}`);

      const searchPrompt = this.createSearchPrompt(
        subjectAddress,
        subjectLat,
        subjectLon,
        searchRadius,
        maxResults,
        timeWindowMonths,
        subjectBeds,
        subjectBaths,
        subjectSqft,
        subjectYearBuilt,
        subjectPropertyType
      );

      // Configure Gemini with Google Search grounding
      const useMinimal = process.env.MINIMAL === '1';
      const groundingTool = { googleSearch: {} } as const;
      const config = {
        tools: useMinimal ? [] : [groundingTool],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 800,
          candidateCount: 1,
        }
      } as const;

      // Helper: wrap a promise with a timeout (configurable; 0/negative disables)
      const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
        if (!(ms > 0)) return p;
        return await Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('gen-timeout')), ms))
        ]);
      };

      // Allow overriding the generation timeout via env; default preserves prior 10s behavior
      const genTimeoutMs = Number(process.env.COMPS_GEN_TIMEOUT_MS ?? '10000');

      // Helper: run a single attempt with model fallback for 5xx only
      const runAttempt = async (): Promise<any> => {
        const models = useMinimal ? (["gemini-1.5-flash"] as const) : (["gemini-2.5-flash", "gemini-1.5-flash"] as const);
        let lastErr: any;
        for (const model of models) {
          try {
            const result: any = await withTimeout(
              this.client.models.generateContent({
                model,
                contents: [{ parts: [{ text: searchPrompt }] }],
                config,
              }),
              genTimeoutMs
            );
            return result;
          } catch (err: any) {
            lastErr = err;
            // If this was a timeout or 4xx, do not try fallback model
            const msg = String(err?.message || '');
            const code = (err as any)?.error?.code as number | undefined;
            const status = (err as any)?.error?.status as string | undefined;
            const is5xx = (typeof code === 'number' && code >= 500 && code < 600) || /UNAVAILABLE|INTERNAL|RESOURCE_EXHAUSTED|503/.test(msg) || /UNAVAILABLE|INTERNAL|RESOURCE_EXHAUSTED/.test(String(status||''));
            if (!is5xx) throw err; // fast-fail on timeout/4xx/parse
            // else loop to fallback model
          }
        }
        throw lastErr;
      };

      // Retry logic: only for transient 5xx. No retry for timeout/4xx.
      let lastError: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`   🔄 Attempt ${attempt}/3...`);
          const result: any = await runAttempt();
          console.log(`   📊 Gemini response received`);
          const preview = result?.text ? String(result.text).slice(0, 200) : 'No text';
          console.log(`   📄 Response preview: ${preview}...`);

          const comparables = await this.extractComparablesFromResponse(
            result,
            subjectAddress,
            subjectLat,
            subjectLon,
            searchRadius
          );
          console.log(`   ✅ Found ${comparables.length} comparables`);
          return { comparables, success: true };
        } catch (error: any) {
          lastError = error;
          const msg = String(error?.message || '');
          const code = (error as any)?.error?.code as number | undefined;
          const status = (error as any)?.error?.status as string | undefined;
          const is5xx = (typeof code === 'number' && code >= 500 && code < 600) || /UNAVAILABLE|INTERNAL|RESOURCE_EXHAUSTED|503/.test(msg) || /UNAVAILABLE|INTERNAL|RESOURCE_EXHAUSTED/.test(String(status||''));
          console.log(`   ⚠️ Attempt ${attempt} failed: ${msg || status || code}`);
          if (!is5xx) break; // do not retry on timeout/4xx/parse
          if (attempt < 3) {
            const base = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
            const jitter = Math.floor(Math.random() * 1000); // +0-1s
            const delay = Math.min(10000, base + jitter);
            console.log(`   ⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All attempts exhausted or non-5xx error encountered
      throw lastError;

    } catch (error) {
      console.error(`❌ Comparable search failed: ${error.message}`);
      return {
        comparables: [],
        success: false,
        error: error.message
      };
    }
  }

  private createSearchPrompt(
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number,
    maxResults: number,
    timeWindowMonths: number = 24,
    subjectBeds?: number,
    subjectBaths?: number,
    subjectSqft?: number,
    subjectYearBuilt?: number,
    subjectPropertyType?: string
  ): string {
    const minimal = process.env.MINIMAL === '1';
    const city = subjectAddress.split(',')[1]?.trim() || 'properties';
    const streetAddress = subjectAddress.split(',')[0]?.trim() || subjectAddress;
    
    // Calculate date range for search
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(endDate.getMonth() - timeWindowMonths);
    const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const endDateStr = endDate.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Determine property era for year built filtering
    let yearBuiltFilter = '';
    if (subjectYearBuilt) {
      if (subjectYearBuilt < 1960) {
        yearBuiltFilter = 'Pre-1960: match era + effective age; ignore strict ± years\n  * Prefer properties built 1940-1970 (same era/construction style)\n  * Minimum year requirement can be dropped if not enough comps found';
      } else if (subjectYearBuilt >= 1960 && subjectYearBuilt < 1990) {
        yearBuiltFilter = '1960-1990 stock: ±10–15 yrs (same era)\n  * Prefer properties built 1950-2000 (same construction style)\n  * Allow some flexibility for comparable scarcity';
      } else if (subjectYearBuilt >= 1990 && subjectYearBuilt < 2000) {
        yearBuiltFilter = '1990s construction: ±5–10 yrs\n  * Prefer properties built 1985-2005\n  * Focus on similar construction methods and materials';
      } else if (subjectYearBuilt >= 2000) {
        yearBuiltFilter = '2000s–present suburbs: ±5–10 yrs\n  * Prefer properties built 1995-present\n  * Modern construction standards apply';
      }
    }

    // Calculate size range based on subject sqft
    const sizeRange = subjectSqft ? 
      `size roughly 0.8×–1.2× subject sqft (${Math.round(subjectSqft * 0.8)}-${Math.round(subjectSqft * 1.2)} sqft)` :
      'similar size range to subject property';

    if (minimal) {
      return `Return ONLY JSON (no prose, no markdown). Find up to ${maxResults} RECENTLY SOLD single-family comps within ${searchRadius} miles of "${subjectAddress}", sold between ${startDateStr} and ${endDateStr}. Prefer renovated/updated/move-in ready; avoid obvious as-is. Output array of at most 3 best comps.

[
  {
    "address": "full street, city, state ZIP",
    "sold_price": 0,
    "sold_date": "YYYY-MM-DD",
    "beds": 0,
    "baths": 0,
    "sqft": 0,
    "year_built": 0,
    "distance_miles": 0,
    "ppsf": 0,
    "source_url": "",
    "source_site": "",
    "condition": "updated|renovated|remodeled|original|fixer|unknown"
  }
]
`;
    }

    return `TASK: Find RECENTLY SOLD (closed) comparable properties appropriate for ARV (after-repair value) analysis, up to a maximum of ${maxResults}. Prioritize RENOVATED/UPDATED or move-in ready homes; avoid obvious fixers/"as-is" unless necessary.

METHODOLOGY:
1. Use Google Search with the provided queries.
2. Prioritize results from Redfin, Realtor.com, Zillow, and local county/assessor records.
3. Validate all data points, especially 'sold' status and sale price, through multiple sources when possible.

SUBJECT PROPERTY DETAILS:
- Address: ${subjectAddress}
- Type: ${subjectPropertyType || 'Single-family home'}
- Beds/Baths: ${subjectBeds || 'Unknown'}/${subjectBaths || 'Unknown'}
- Square Feet: ${subjectSqft || 'Unknown'}
- Year Built: ${subjectYearBuilt || 'Unknown'}

SEARCH CRITERIA:
- Time Window: ${startDateStr} to ${endDateStr} (${timeWindowMonths} months)
- Distance: Within ${searchRadius} miles from subject property.
- Property Type: Only ${subjectPropertyType || 'Single-family home'}.
- Size Range: Square footage must be within a ${sizeRange || '20%'} range of the subject property's square footage.
- Bathroom Count: When possible, match the exact bathroom count. Prioritize properties with a similar number of full and half baths. ${subjectBaths === 1 ? 'Prefer comps with <2 baths' : 'Match bathroom count when possible'}
- Year Built: Prefer properties built within a ${yearBuiltFilter || 'Match era when possible'} year range of the subject property.
- Geographic Priority: 1. Same city/subdivision. 2. Same municipality. 3. Same school district.

SEARCH QUERIES:
- "recently sold ${city} properties" site:redfin.com OR site:realtor.com OR site:zillow.com
- "${streetAddress}" sold property
- "${city} single family home sales" ${startDateStr} to ${endDateStr}
- "${city} property sales records" county assessor

REQUIREMENTS:
- Only include properties that have been verified as SOLD/CLOSED.
- Do not include pending sales, active listings, or withdrawn properties.
 - Each comparable property must have complete data: address, sold_price, sold_date, beds, baths, sqft, and year_built.
 - Return a list of up to ${maxResults} comps.
 - Prefer properties described as "updated", "renovated", "remodeled", or "move-in ready"; avoid "as-is", "needs TLC", "investor special", or distressed unless insufficient comps.

OUTPUT FORMAT:
Provide the output as a JSON object formatted as follows. If any data is unavailable for a property, use \`null\`.

[
  {
    "address": "Full street address",
    "sold_price": "Exact sale price as a number",
    "sold_date": "YYYY-MM-DD",
    "beds": "Number of bedrooms",
    "baths": "Number of bathrooms",
    "sqft": "Square footage as a number",
    "year_built": "Construction year as a number",
    "distance_miles": "Approximate distance as a number",
    "ppsf": "Price per square foot as a number",
    "source_url": "Direct link to listing",
    "source_site": "Platform name (e.g., redfin, realtor, zillow, county)",
    "condition": "renovated | updated | remodeled | original | fixer | unknown"
  },
  ... (additional comparables)
]`;
  }

  private async extractComparablesFromResponse(
    response: any,
    subjectAddress: string,
    subjectLat: number,
    subjectLon: number,
    searchRadius: number
  ): Promise<ComparableProperty[]> {
    try {
      // Get the response text
      const responseText = response.text || '';
      console.log(`   📄 Response text length: ${responseText.length} characters`);
      
      // Check for grounding metadata
      if (response.candidates && response.candidates[0] && response.candidates[0].groundingMetadata) {
        console.log(`   🔍 Grounding metadata found - using real-time search results`);
        const metadata = response.candidates[0].groundingMetadata;
        if (metadata.webSearchQueries) {
          console.log(`   🔍 Search queries used: ${metadata.webSearchQueries.join(', ')}`);
        }
        if (metadata.groundingChunks) {
          console.log(`   📊 Found ${metadata.groundingChunks.length} web sources`);
        }
      }

      // Use Gemini parser to extract comparables
      console.log(`   🤖 Using Gemini parser to extract comparables`);
      // Keep logs light to reduce overhead
      console.log(`   📄 Trimming verbose response logs (performance)`);
      const parsedComparables = await this.geminiParser.parseComparables(responseText, subjectAddress);

      // Parallel geocoding for distances with cache and 3s timeout
      const distancePromises = parsedComparables.map(async (parsed: any) => {
        try {
          // Prefer model-reported distance if provided
          let dist: number | null = null;
          const dRaw = (parsed as any).distance ?? (parsed as any).distance_miles;
          if (dRaw != null) {
            const dNum = typeof dRaw === 'number' ? dRaw : parseFloat(String(dRaw).toString().replace(/[^0-9.]/g, ''));
            if (Number.isFinite(dNum)) dist = dNum as number;
          }
          if (dist == null) {
            dist = await this.calculateDistance(parsed.address, subjectLat, subjectLon, 3000);
          }
          return { parsed, distance: dist } as const;
        } catch {
          return { parsed, distance: Number.POSITIVE_INFINITY } as const;
        }
      });

      const settled = await Promise.allSettled(distancePromises);
      const comparables: ComparableProperty[] = [];

      for (const s of settled) {
        if (s.status !== 'fulfilled') continue;
        const { parsed, distance } = s.value;
        console.log(`   🔍 Distance for ${parsed.address}: ${Number.isFinite(distance) ? distance.toFixed(2) : 'timeout'} miles`);
        if (!Number.isFinite(distance) || distance > searchRadius) {
          console.log(`   ❌ Filtering out ${parsed.address} (distance: ${distance} > ${searchRadius})`);
          continue;
        }
        const comparable: ComparableProperty = {
          address: (parsed as any).address,
          price: parseInt((parsed as any).price),
          sqft: (parsed as any).sqft,
          beds: (parsed as any).beds,
          baths: (parsed as any).baths,
          yearBuilt: (parsed as any).yearBuilt || 0,
          soldDate: (parsed as any).soldDate,
          distance,
          source: 'Gemini Search + LLaMA',
          confidence: 'high',
          condition: typeof (parsed as any).condition === 'string' ? (parsed as any).condition.toLowerCase() : undefined
        };
        comparables.push(comparable);
        console.log(`   ✅ Added: ${comparable.address} - $${comparable.price.toLocaleString()} - ${comparable.sqft}sqft - Built: ${comparable.yearBuilt || 'Unknown'}`);
      }

      // LLaMA parser completed successfully
      console.log(`   🦙 LLaMA parser completed successfully`);

      return comparables;

    } catch (error) {
      console.error(`❌ Error extracting comparables: ${error.message}`);
      return [];
    }
  }

  private async calculateDistance(address: string, subjectLat: number, subjectLon: number, timeoutMs: number = 3000): Promise<number> {
    try {
      let coords = this.geocodeCache.get(address);
      if (!coords) {
        const geocoded = await this.geocodeWithTimeout(address, timeoutMs);
        if (!geocoded) throw new Error('geocode-timeout');
        coords = geocoded;
        this.geocodeCache.set(address, coords);
      }
      return this.haversineDistance(subjectLat, subjectLon, coords.lat, coords.lon);
    } catch (error: any) {
      console.warn(`⚠️ Distance calc failed for ${address}: ${error?.message || error}`);
      return Number.POSITIVE_INFINITY; // Treat as out-of-range
    }
  }

  private async geocodeWithTimeout(address: string, timeoutMs: number): Promise<{ lat: number; lon: number } | null> {
    const https = await import('https');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`;
    return await new Promise((resolve) => {
      const req = https.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.status === 'OK' && data.results && data.results.length > 0) {
              const loc = data.results[0].geometry.location;
              resolve({ lat: loc.lat, lon: loc.lng });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(timeoutMs, () => {
        try { req.destroy(new Error('timeout')); } catch {}
        resolve(null);
      });
    });
  }

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    return distance * 0.621371; // Convert to miles
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }
}

// Test function
async function testFindComparables() {
  const address = process.env.ADDRESS;
  if (!address) {
    throw new Error('ADDRESS environment variable is required');
  }
  
  // Import and use geocoding service to get real coordinates
  const { GeocodingService } = await import('./step1-geocoding.js');
  const geocodingService = new GeocodingService();
  const geocodingResult = await geocodingService.geocodeAddress(address);
  
  if (!geocodingResult.success) {
    throw new Error(`Geocoding failed: ${geocodingResult.error}`);
  }
  
  const lat = geocodingResult.lat;
  const lon = geocodingResult.lon;
  const radius = 1.0; // Default radius for testing
  
  console.log(`\n🔍 STEP 3: FINDING COMPARABLES`);
  console.log(`============================================================`);
  
  const searchService = new ComparableSearchService();
  const result = await searchService.findComparables(address, lat, lon, radius, 10);
  
  if (result.success) {
    console.log(`✅ Found ${result.comparables.length} comparables:`);
    result.comparables.forEach((comp, index) => {
      const soldDate = new Date(comp.soldDate).toLocaleDateString();
      console.log(`   ${index + 1}. ${comp.address}`);
      console.log(`      Price: $${comp.price.toLocaleString()}`);
      console.log(`      Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
      console.log(`      Built: ${comp.yearBuilt || 'Unknown'}`);
      console.log(`      Sold: ${soldDate}`);
      console.log(`      Distance: ${comp.distance.toFixed(2)} miles`);
      console.log(`      Source: ${comp.source}`);
    });
  } else {
    console.log(`❌ Comparable search failed: ${result.error}`);
  }
  
  return result;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testFindComparables().catch(console.error);
}

export { ComparableSearchService, testFindComparables };
export type { ComparableProperty, FindComparablesResult };
