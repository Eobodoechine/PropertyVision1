import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';

export type Strategy = {
  name: string;
  strict?: boolean;
  prompt: (ctx: Ctx) => string;
};

export type Ctx = {
  address: string;
  radius: number;
  months: number;
  subdivision?: string;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
};

export async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
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
  const u = new URL(sa.token_uri);
  const tokenResp: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body.toString()).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body.toString());
    req.end();
  });
  if (!tokenResp?.access_token) throw new Error('sa-token-failed');
  return tokenResp.access_token as string;
}

export async function vertexGenerateRaw({ token, location, projectId, model, prompt }: { token: string; location: string; projectId: string; model: string; prompt: string; }): Promise<string> {
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 2500 }
  };
  const u = new URL(url);
  const body = JSON.stringify(payload);
  const resp: any = await new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
  const parts: any[] = resp?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p?.text || '').join('');
}

export async function runWithLimit<T>(limit: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  let active = 0;
  return await new Promise((resolve) => {
    const next = () => {
      if (i >= tasks.length && active === 0) return resolve(results);
      while (active < limit && i < tasks.length) {
        const idx = i++;
        active++;
        tasks[idx]().then((res) => {
          results[idx] = res;
          active--;
          next();
        }).catch((_err) => {
          // Record empty slot on error
          // @ts-ignore
          results[idx] = null;
          active--;
          next();
        });
      }
    };
    next();
  });
}

export function scoreTargets(text: string, targets: string[]): { hits: string[]; missing: string[] } {
  const norm = (s: string) => s.toLowerCase();
  const lower = norm(text || '');
  const hits: string[] = [];
  const missing: string[] = [];
  targets.forEach(t => {
    const found = lower.includes(norm(t));
    (found ? hits : missing).push(t);
  });
  return { hits, missing };
}

export function buildStrategyRegistry(): Record<string, Strategy> {
  const baseFields = 'address | sold_price | sold_date(YYYY-MM-DD) | beds | baths | sqft | year_built | distance_miles | source_url';
  const clusterStreets = ['Jordan Pl', 'Bailey Ct', 'Bailey Station Cir', 'Ridgemont Dr'];
  const cluster = clusterStreets.join(', ');

  const R: Record<string, Strategy> = {};

  const add = (s: Strategy) => { R[s.name] = s; };

  add({ name: 'subdivision-strict-20-distance', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties near "${c.address}" within ${c.radius} miles and ${c.months} months.
${c.subdivision ? `Only include properties in subdivision "${c.subdivision}".
` : ''}${c.sqft && c.beds ? `Match subject: beds within ±1 of ${c.beds}, sqft within ±20% of ${c.sqft}.
` : ''}Reject listings/pendings or missing sale date/price. No commentary, no headers. Return 20 lines.` });

  add({ name: 'subdivision-default-20',
    prompt: (c) => `Find recently SOLD comparable properties near ${c.address}. Within ${c.radius} miles, last ${c.months} months. ${c.subdivision ? `Subdivision: ${c.subdivision}.` : ''} Single-family. Return 20 properties (address, sold price, sold date, beds, baths, sqft, year, source URL).` });

  add({ name: 'street-cluster-strict-1mi', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties within 1 mile of ${c.address} on/near: ${cluster}. Last ${c.months} months. No commentary. Return 20 lines.` });

  add({ name: 'zip-city-strict', strict: true,
    prompt: (c) => { const zip = (c.address.match(/\b\d{5}\b/) || [])[0] || ''; return `Return ONLY ${baseFields} for SOLD single-family properties within ${c.radius} miles of ${c.address} (ZIP must be ${zip} unless within ${c.radius} miles of subject). City must be Fayetteville, GA. Last ${c.months} months. No commentary. Return 20 lines.`; } });

  add({ name: 'renovated-terms-strict-20', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties near "${c.address}" within ${c.radius} miles and ${c.months} months that are recently renovated/updated/move-in ready. Reject missing sale date/price. No commentary. Return 20 lines.` });

  add({ name: 'broader-strict-20', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${c.radius} miles and ${c.months} months. Prefer beds within ±1 of ${c.beds ?? ''} and sqft within ±20% of ${c.sqft ?? ''}. No commentary. Return 20 lines.` });

  [1,2,3].forEach(mi => {
    add({ name: `ring-${mi}mi-strict`, strict: true,
      prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${mi} miles and ${c.months} months. No commentary. Return 20 lines.` });
  });

  add({ name: 'subject-card-subdivision-strict', strict: true,
    prompt: (c) => `Subject: ${c.address}\nZIP: ${(c.address.match(/\b\d{5}\b/) || [])[0] || ''}\nBeds/Baths: ${c.beds ?? ''}/${c.baths ?? ''}\nSqft: ${c.sqft ?? ''}\nYear: ${c.yearBuilt ?? ''}\n${c.subdivision ? `Subdivision: ${c.subdivision}\n` : ''}Return ONLY ${baseFields} for SOLD single-family properties within ${c.radius} miles and ${c.months} months. Constraints: beds ±1, sqft ±20%, reject condos, reject missing sale date/price. No commentary. Return 20 lines.` });

  add({ name: 'domain-allowlist-strict', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${c.radius} miles and ${c.months} months. Source URL must be one of: zillow.com, redfin.com, realtor.com, homes.com. Reject others. No commentary. Return 20 lines.` });

  add({ name: 'table-default-20',
    prompt: (c) => `Provide a table of 20 SOLD single-family properties near ${c.address} within ${c.radius} miles and ${c.months} months, with columns: address, sold_price, sold_date (YYYY-MM-DD), beds, baths, sqft, year_built, source_url.` });

  // Additional variants (as requested)
  add({ name: 'street-cluster-strict-2mi', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties within 2 miles of ${c.address} on/near: ${cluster}. Last ${c.months} months. No commentary. Return 20 lines.` });

  add({ name: 'subdivision-default-30',
    prompt: (c) => `Find recently SOLD comparable properties near ${c.address}. Within ${c.radius} miles, last ${c.months} months. ${c.subdivision ? `Subdivision: ${c.subdivision}.` : ''} Single-family. Return 30 properties with address, sold_price, sold_date, beds, baths, sqft, year_built, source_url.` });

  add({ name: 'broader-strict-30', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near "${c.address}" within ${c.radius} miles and ${c.months} months. Prefer beds within ±1 and sqft within ±20%. No commentary. Return 30 lines.` });

  add({ name: 'zip-city-default-20',
    prompt: (c) => { const zip = (c.address.match(/\b\d{5}\b/) || [])[0] || ''; return `Find SOLD single-family properties near ${c.address}. City must be Fayetteville, GA and ZIP should be ${zip} unless inside ${c.radius} miles. Return 20 with address, price, date, beds, baths, sqft, year, source.`; } });

  add({ name: 'price-band-strict', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near ${c.address} within ${c.radius} miles and ${c.months} months, with sold_price between $250,000 and $900,000. No commentary. Return 20 lines.` });

  add({ name: 'sqft-cap-strict', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD single-family properties near ${c.address} within ${c.radius} miles and ${c.months} months. Reject properties with sqft < 1000 or > 4000. No commentary. Return 20 lines.` });

  // Street cluster excluding user-targeted names
  const clusterNoTargets = [
    'Sheldon Way','Sterling Ct','Johns Ct','Inman Rd','Chantilly Ln','Wendolyn Trce',
    'Discovery Lake Dr','Lake Cir','Surrey Park Dr','McElwaney Way','Stayman Park',
    'Zelkova Dr','Postwood Dr','Old Senoia Rd','Green Meadow Ln','Seawright Dr',
    'Pebble Beach Dr','Paces Dr','Canal Pl','Maple Pl'
  ].join(', ');

  add({ name: 'street-cluster-no-targets-1mi', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties within 1 mile of ${c.address} on/near: ${clusterNoTargets}. Last ${c.months} months. No commentary. Return 20 lines.` });

  add({ name: 'street-cluster-no-targets-2mi', strict: true,
    prompt: (c) => `Return ONLY ${baseFields} for SOLD properties within 2 miles of ${c.address} on/near: ${clusterNoTargets}. Last ${c.months} months. No commentary. Return 20 lines.` });

  // 10) Analyst narrative prompts (non-pipe bullets)
  add({ name: 'analyst-default',
    prompt: (c) => {
      const low = Math.round((c.sqft || 0) * 0.8) || '±20% lower bound';
      const high = Math.round((c.sqft || 0) * 1.2) || '±20% upper bound';
      const y = c.yearBuilt || '';
      return `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below.
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${c.address}
- Beds: ${c.beds ?? ''}
- Baths: ${c.baths ?? ''}
- Square Footage: ${c.sqft ?? ''} sqft
- Year Built: ${y}

COMPARABLE SELECTION CRITERIA:
1. Location: Within ${c.radius >= 2 ? 2 : c.radius} miles of the subject property.
2. Sale Date: Sold within the last 12 months.
3. Size: Between ~${low} sqft and ~${high} sqft (±20% of subject).
4. Bedrooms: ${c.beds ? `${c.beds-1}–${c.beds+1}` : '±1 of subject'} bedrooms.
5. Bathrooms: ${c.baths ? `${Math.max(1, Math.floor((c.baths-1))) }–${Math.ceil((c.baths+1))}` : '±1 of subject'} bathrooms.
6. Year Built: Between ${(y ? y-10 : 'subject-10')} and ${(y ? y+10 : 'subject+10')}.

PROCESS:
- Step 1: List several recent sales within ~2 miles of the subject.
- Step 2: Filter those to only homes meeting ALL the criteria above.
- Step 3: Select 3–5 of the closest matches that would realistically be chosen by a real estate analyst.
- Step 4: For each comp, provide: Address, sale date, sale price, beds, baths, sqft, year built, distance from subject, and a short reason.

OUTPUT FORMAT:
List each comp as a bullet point in this exact format:
- **[Address]** — Sold [Month Year] for $[Price], [Beds] bed / [Baths] bath, [Sqft] sqft, built [Year], [Distance] miles away. *Reason it’s comparable.*

RESTRICTIONS:
- Do not include homes outside 2 miles or older than 12 months.
- Do not include homes outside the sqft, bed/bath, or year built ranges.
- Do not hallucinate properties; only return realistic addresses.
- Return 3–5 comps that BEST match the criteria.

Now, provide the comps.`;
    }
  });

  add({ name: 'analyst-subdivision-cluster',
    prompt: (c) => {
      const streets = ['Jordan Pl','Bailey Ct','Bailey Station Cir','Ridgemont Dr','Stoneridge Way','Winter Valley','Lakeside Pkwy'].join(', ');
      return `You are an experienced real estate analyst.

Subject: ${c.address}
${c.subdivision ? `Subdivision: ${c.subdivision}\n` : ''}Beds: ${c.beds ?? ''}\nBaths: ${c.baths ?? ''}\nSqft: ${c.sqft ?? ''}\nYear: ${c.yearBuilt ?? ''}

Find 3–5 SOLD comps within 2 miles and 12 months, similar size (±20%), beds (±1), baths (±1), year (±10). Prefer homes on or near: ${streets}. For each, output:
- **[Address]** — Sold [Month Year] for $[Price], [Beds] bed / [Baths] bath, [Sqft] sqft, built [Year], [Distance] miles away. *Reason it’s comparable.*`;
    }
  });

  return R;
}

export function buildUserAnalystPrompt(ctx: Ctx): string {
  const lowSqft = Math.round((ctx.sqft || 0) * 0.8) || 1865;
  const highSqft = Math.round((ctx.sqft || 0) * 1.2) || 2800;
  const lowYear = (ctx.yearBuilt || 1998) - 10;
  const highYear = (ctx.yearBuilt || 1998) + 10;
  const beds = ctx.beds ?? 4;
  const baths = ctx.baths ?? 2.5;
  return `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below. 
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${ctx.address}
- Beds: ${beds}
- Baths: ${baths}
- Square Footage: ${(ctx.sqft ?? 2331).toLocaleString()} sqft
- Year Built: ${ctx.yearBuilt ?? 1998}

COMPARABLE SELECTION CRITERIA:
1. Location: Within 2 miles of the subject property.
2. Sale Date: Sold within the last 12 months.
3. Size: Between ~${lowSqft.toLocaleString()} sqft and ~${highSqft.toLocaleString()} sqft (±20% of subject).
4. Bedrooms: ${beds-1}–${beds+1} bedrooms (±1 of subject).
5. Bathrooms: ${Math.max(1, Math.floor((baths as number) - 1))}–${Math.ceil((baths as number) + 1)} bathrooms (±1 of subject).
6. Year Built: Between ${lowYear} and ${highYear} (within ±10 years of subject’s build year).

PROCESS:
- Step 1: List several recent sales within ~2 miles of the subject.
- Step 2: Filter those to only homes meeting ALL the criteria above.
- Step 3: Select 3–5 of the closest matches that would realistically be chosen by a real estate analyst.
- Step 4: For each comp, provide:
   - Address
   - Sale date
   - Sale price
   - Beds, baths, sqft, year built
   - Distance from subject
   - Short note on why it is a good comp

OUTPUT FORMAT:
List each comp as a bullet point in this exact format:

- **[Address]** — Sold [Month Year] for $[Price], [Beds] bed / [Baths] bath, [Sqft] sqft, built [Year], [Distance] miles away. *Reason it’s comparable.*

EXAMPLE (do not reuse these numbers):
- **123 Maple St, Fayetteville, GA 30215** — Sold Feb 2025 for $400,000, 4 bed / 3 bath, 2,100 sqft, built 1995, 1.2 miles away. *Within size and bed/bath range, same school district, and recent sale.*

RESTRICTIONS:
- Do not include homes outside the 2-mile radius.
- Do not include homes that sold more than 12 months ago.
- Do not include homes outside the sqft, bed/bath, or year built ranges.
- Do not hallucinate properties; only return realistic addresses.
- Return 3–5 comps that BEST match the criteria.

Now, provide the comps.`;
}

export async function buildContext(address: string, radius: number, months: number): Promise<Ctx> {
  const details = await fetchPropertyDetailsViaVertex(address);
  return {
    address,
    radius,
    months,
    subdivision: details?.subdivision || undefined,
    sqft: details?.sqft || undefined,
    beds: details?.beds || undefined,
    baths: details?.baths || undefined,
    yearBuilt: details?.yearBuilt || undefined,
  };
}
