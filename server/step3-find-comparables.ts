import 'dotenv/config';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import { groundedFreeform } from './vertex-freeform';

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
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
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
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
      if (!saPath) {
        throw new Error('GCP_SA_JSON environment variable is required for Vertex AI');
      }

      const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
      const projectId = sa.project_id;
      const location = process.env.VERTEX_LOCATION || 'us-central1';
      const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
      const token = await this.getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

      // Build subdivision filter if specified
      const subdivision = process.env.SUBDIVISION?.trim();
      const subLine = subdivision ? `Only include properties in subdivision "${subdivision}".` : '';

      const typeWanted = (subjectPropertyType || process.env.SUBJECT_TYPE || '').toLowerCase();
      const typeLine = typeWanted ? `Only include property type: ${typeWanted} (use synonyms: townhome/townhouse/rowhouse for townhome).` : '';

      const prompt = `REAL ESTATE COMPARABLE SEARCH - VERTEX AI GROUNDED ANALYSIS

Use Google Search grounding with authoritative MLS data sources to find recently SOLD comparable properties.

TARGET PROPERTY: ${subjectAddress}

SEARCH CRITERIA (STRICT REQUIREMENTS):
- Location: Within ${searchRadius} miles of ${subjectAddress}
- Time frame: Sold within last ${timeWindowMonths} months (SOLD properties only, not listings)
- Property type: Single-family homes, townhomes, condos
${subLine ? `- Subdivision: ${subLine}` : ''}
${typeLine ? `- Type filter: ${typeLine}` : ''}

SEARCH METHODOLOGY FOR CONSISTENT RESULTS:
1. Query multiple authoritative sources in this order:
   - MLS data via Zillow, Redfin, Realtor.com
   - County records for verification
   - Real estate databases
2. Use consistent search terms: "recently sold" + "${subjectAddress.split(',').slice(1).join(',').trim()}"
3. Filter for properties with complete sale data only

REQUIRED DATA FOR EACH PROPERTY:
- Complete street address with city, state, ZIP
- Actual sale price (not listing price)
- Sale date in YYYY-MM-DD format
- Bedrooms and bathrooms (exact numbers)
- Square footage (living area)
- Year built
- Source website (Zillow, Redfin, Realtor.com, etc.)

SEARCH SOURCES:
Use authoritative real estate sources like:
- site:zillow.com "${subjectAddress.split(',')[1]?.trim() || ''}" recently sold
- site:redfin.com "${subjectAddress.split(',')[1]?.trim() || ''}" sold
- site:realtor.com "${subjectAddress.split(',')[1]?.trim() || ''}" sold properties

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url

Example:
123 Main St, Fayetteville, GA 30215 | 425000 | 2024-03-15 | 4 | 3 | 2100 | 1998 | zillow.com

Find ${maxResults} best comparable properties with complete, verified data.`;

      console.log(`   🔄 Attempting Vertex AI grounded search...`);

      const result = await groundedFreeform({
        accessToken: token,
        projectId,
        location,
        model,
        prompt,
        maxOutputTokens: 2500
      });

      console.log(`   📊 Vertex response received`);

      // Parse the pipe-separated response with enhanced filtering
      let comps = await this.parseVertexResponse(result.text, subjectCoords.lat, subjectCoords.lon, subjectDetails);

      if (comps.length < 3 && subdivision) {
        console.log(`   🔄 Insufficient subdivision comps (${comps.length}), retrying without subdivision filter...`);

        const fallbackPrompt = `Use Google Search grounding to find recently SOLD RENOVATED properties near "${subjectAddress}" (expanded search - no subdivision filter).

SEARCH CRITERIA:
- Location: Within ${searchRadius} miles of ${subjectAddress}
- Time frame: Sold within last ${timeWindowMonths} months
- Property type: Single-family homes, townhomes, condos
- CONDITION: Recently renovated, updated, or move-in ready properties ONLY
${typeLine ? `- Type filter: ${typeLine}` : ''}

SEARCH STRATEGY:
Search broader area for RENOVATED/UPDATED properties:
- "recently renovated" ${subjectAddress.split(',')[1]?.trim() || subjectAddress} sold
- "updated" ${subjectAddress.split(',')[1]?.trim() || subjectAddress} sold properties
- "move-in ready" ${subjectAddress.split(',')[1]?.trim() || subjectAddress} sold

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url

Find ${maxResults} comparable RENOVATED properties with complete data.`;

        const fallbackResult = await groundedFreeform({
          accessToken: token,
          projectId,
          location,
          model,
          prompt: fallbackPrompt,
          maxOutputTokens: 2500
        });

        const fallbackComps = await this.parseVertexResponse(fallbackResult.text, subjectCoords.lat, subjectCoords.lon, subjectDetails);
        comps.push(...fallbackComps);
      }

      // Apply PPSF variance filtering to reduce outliers
      comps = this.filterByPPSFVariance(comps);

      // Sort by distance and limit results
      comps.sort((a, b) => a.distance - b.distance);
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

  private async parseVertexResponse(
    text: string,
    subjectLat: number,
    subjectLon: number,
    subjectDetails?: { sqft: number; beds: number; baths: number; yearBuilt: number }
  ): Promise<ComparableProperty[]> {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const comps: ComparableProperty[] = [];

    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 7) continue;

      const [addr, priceStr, dateStr, bedsStr, bathsStr, sqftStr, ybStr, url] = parts;

      // Skip header lines or examples
      if (!addr || /^(address|123\s+main\s+st|example)/i.test(addr)) continue;

      this.rawCompsFound++; // Count raw comp found

      // SOLD DATE VALIDATION
      if (!dateStr || dateStr.trim() === '') {
        console.log(`   ❌ Rejected ${addr}: Missing sold date`);
        continue;
      }

      const soldDate = new Date(dateStr);
      const today = new Date();

      // Reject future dates (with 7-day buffer for data processing delays)
      const futureBuffer = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days ahead
      if (soldDate > futureBuffer) {
        console.log(`   ❌ Rejected ${addr}: Future sold date (${dateStr}) - today is ${today.toISOString().split('T')[0]}`);
        continue;
      }

      // Check if date is valid
      if (isNaN(soldDate.getTime())) {
        console.log(`   ❌ Rejected ${addr}: Invalid date format (${dateStr})`);
        continue;
      }

      // Calculate age in months
      const ageInMonths = Math.floor((today.getTime() - soldDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44));

      const price = Number(priceStr.replace(/[^0-9.]/g, ''));
      const sqft = Number(sqftStr.replace(/[^0-9.]/g, ''));
      const beds = Number(bedsStr.replace(/[^0-9.]/g, ''));
      const baths = Number(bathsStr.replace(/[^0-9.]/g, ''));
      const yearBuilt = Number(ybStr.replace(/[^0-9]/g, ''));

      // Basic validation
      if (!price || price < 50000 || price > 5000000) continue;
      if (!sqft || sqft < 500 || sqft > 10000) continue;
      if (!beds || beds < 1 || beds > 10) continue;
      if (!baths || baths < 1 || baths > 10) continue;
      if (!yearBuilt || yearBuilt < 1900 || yearBuilt > new Date().getFullYear()) continue;

      // ENHANCED FILTERING based on subject property (if available)
      if (subjectDetails) {
        console.log(`   🔍 FILTERING ${addr}: ${beds}BR/${baths}BA, ${sqft}sqft vs Subject: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft`);

        // 1. Bedroom count: ±1 bedroom max
        const bedroomDiff = Math.abs(beds - subjectDetails.beds);
        if (bedroomDiff > 1) {
          console.log(`   ❌ FILTERED OUT ${addr}: bedroom mismatch (${beds}BR vs ${subjectDetails.beds}BR, diff: ${bedroomDiff})`);
          continue;
        } else {
          console.log(`   ✅ BEDROOM OK ${addr}: ${beds}BR vs ${subjectDetails.beds}BR (diff: ${bedroomDiff} ≤ 1)`);
        }

        // 2. Bathroom filtering with special logic for low bathroom count
        if (subjectDetails.baths <= 2) {
          // For subject with ≤2 baths, keep all comps with ≤2 baths + separate tracking for >2 bath comps
          if (baths > 2) {
            console.log(`   📝 Flagged ${addr}: high bathroom count for low-bath subject (${baths} vs ${subjectDetails.baths})`);
            // Still include but flag for separate ARV calculation
          }
        } else {
          // For subject with >2 baths, use ±1 bathroom rule (rounded for half baths)
          const bathDiff = Math.abs(baths - subjectDetails.baths);
          if (bathDiff > 1.5) { // Allow up to 1.5 difference to handle half-bath variations
            console.log(`   ⚠️  Filtered out ${addr}: bathroom mismatch (${baths} vs ${subjectDetails.baths}, diff: ${bathDiff.toFixed(1)})`);
            continue;
          }
        }

        // 3. Square footage: ±20% max
        const sqftVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        if (sqftVariance > 0.20) {
          console.log(`   ⚠️  Filtered out ${addr}: size variance too high (${(sqftVariance * 100).toFixed(1)}% > 20% limit)`);
          continue;
        }

        // 4. Age cohort filtering
        const ageGroup = this.getAgeGroup(subjectDetails.yearBuilt);
        const compAgeGroup = this.getAgeGroup(yearBuilt);
        if (!this.isAdjacentAgeGroup(ageGroup, compAgeGroup)) {
          console.log(`   ⚠️  Filtered out ${addr}: age group mismatch (${compAgeGroup} vs ${ageGroup})`);
          continue;
        }
      }

      // STRICT DISTANCE FILTERING (Tiered with hard limits)
      const distance = await this.calculateDistance(addr, subjectLat, subjectLon);
      if (!Number.isFinite(distance)) continue;

      const IDEAL_DISTANCE = 1.0;    // miles - preferred
      const MAX_DISTANCE = 2.0;      // miles - suburban limit

      if (distance > MAX_DISTANCE) {
        console.log(`   ❌ REJECTED ${addr}: Too far (${distance.toFixed(2)}mi > ${MAX_DISTANCE}mi limit)`);
        continue; // Hard rejection
      }

      if (distance > IDEAL_DISTANCE) {
        console.log(`   ⚠️  EXTENDED DISTANCE ${addr}: (${distance.toFixed(2)}mi > ${IDEAL_DISTANCE}mi ideal)`);
      }

      // STRICT SIZE VARIANCE FILTERING (±20%)
      if (subjectDetails) {
        const sizeVariance = Math.abs(sqft - subjectDetails.sqft) / subjectDetails.sqft;
        const MAX_SIZE_VARIANCE = 0.20; // 20%

        if (sizeVariance > MAX_SIZE_VARIANCE) {
          console.log(`   ❌ REJECTED ${addr}: Size variance too high (${(sizeVariance * 100).toFixed(1)}% > ${(MAX_SIZE_VARIANCE * 100)}%)`);
          console.log(`      Subject: ${subjectDetails.sqft}sqft | Comp: ${sqft}sqft`);
          continue; // Hard rejection
        }

        console.log(`   ✅ SIZE QUALIFIED ${addr}: ${(sizeVariance * 100).toFixed(1)}% variance (within ${(MAX_SIZE_VARIANCE * 100)}% limit)`);
      }

      // TIERED TIME WINDOW FILTERING
      const IDEAL_TIME_MONTHS = 12;
      const MAX_TIME_MONTHS = 18;

      if (ageInMonths <= IDEAL_TIME_MONTHS) {
        console.log(`   ✅ TIME QUALIFIED ${addr}: Recent sale (${ageInMonths} months)`);
      } else if (ageInMonths <= MAX_TIME_MONTHS) {
        console.log(`   ⚠️  TIME EXTENDED ${addr}: Extended time range (${ageInMonths} months) - may need market adjustments`);
      } else {
        console.log(`   ❌ REJECTED ${addr}: Too old (${ageInMonths} months > ${MAX_TIME_MONTHS} months)`);
        continue;
      }

      comps.push({
        address: addr,
        price,
        sqft,
        beds,
        baths,
        yearBuilt,
        soldDate: dateStr || '',
        distance,
        source: 'Vertex AI Grounded Search',
        confidence: 'high',
        condition: 'renovated' // Assume renovated for ARV analysis
      });

      console.log(`   ✅ Added: ${addr} - $${price.toLocaleString()} - ${sqft}sqft - Built: ${yearBuilt}`);
    }

    return comps;
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

  private filterByPPSFVariance(comps: ComparableProperty[]): ComparableProperty[] {
    if (comps.length < 3) return comps;

    // Calculate PPSF for all comps
    const compsWithPPSF = comps.map(comp => ({
      ...comp,
      ppsf: comp.price / comp.sqft
    }));

    // Calculate median PPSF to identify outliers
    const ppsfValues = compsWithPPSF.map(c => c.ppsf).sort((a, b) => a - b);
    const median = ppsfValues[Math.floor(ppsfValues.length / 2)];

    // Filter out comps with PPSF more than 25% away from median
    const filtered = compsWithPPSF.filter(comp => {
      const variance = Math.abs(comp.ppsf - median) / median;
      if (variance > 0.25) {
        console.log(`   🚫 Removed outlier: ${comp.address} - PPSF: $${comp.ppsf.toFixed(2)} (${(variance * 100).toFixed(1)}% from median)`);
        return false;
      }
      return true;
    });

    console.log(`   📊 PPSF variance reduction: ${comps.length} → ${filtered.length} comps (median PPSF: $${median.toFixed(2)})`);

    return filtered.map(({ ppsf, ...comp }) => comp); // Remove temporary ppsf field
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
      req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
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
    if (this.geocodeCache.has(address)) {
      return this.geocodeCache.get(address)!;
    }

    return new Promise((resolve) => {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.googleMapsApiKey}`;
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.results?.[0]?.geometry?.location) {
              const coords = { lat: parsed.results[0].geometry.location.lat, lon: parsed.results[0].geometry.location.lng };
              this.geocodeCache.set(address, coords);
              resolve(coords);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.setTimeout(timeoutMs, () => {
        try { req.destroy(new Error('timeout')); } catch {}
        resolve(null);
      });
      req.on('error', () => resolve(null));
    });
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