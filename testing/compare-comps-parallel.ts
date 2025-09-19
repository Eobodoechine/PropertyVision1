import 'dotenv/config';
import fs from 'fs';
import { VertexComparableSearchService } from '../server/step3-find-comparables.js';
import { getServiceAccountToken, vertexGenerateRaw, buildContext } from './vertex-bakeoff-shared.js';

function extractAddresses(text: string): string[] {
  const lines = (text || '').split(/\r?\n/);
  const addrs: string[] = [];
  const addrRe = /\b\d+\s+[^,\n]+,\s*Fayetteville,\s*GA\s*\d{5}\b/i;
  for (const ln of lines) {
    const m = ln.match(addrRe);
    if (m) addrs.push(m[0].trim());
  }
  return Array.from(new Set(addrs));
}

async function runAnalystMethods(ctx: any): Promise<{ name: string; addresses: string[] }[]> {
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  const lowSqft = Math.round((ctx.sqft || 2331) * 0.8);
  const highSqft = Math.round((ctx.sqft || 2331) * 1.2);
  const lowYear = (ctx.yearBuilt || 1998) - 10;
  const highYear = (ctx.yearBuilt || 1998) + 10;

  const analystPrompt = (withSubdivision: boolean) => `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below. 
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${ctx.address}
- Beds: ${ctx.beds ?? 4}
- Baths: ${ctx.baths ?? 2.5}
- Square Footage: ${(ctx.sqft ?? 2331).toLocaleString()} sqft
- Year Built: ${ctx.yearBuilt ?? 1998}
${withSubdivision && ctx.subdivision ? `- Subdivision: ${ctx.subdivision}\n` : ''}
COMPARABLE SELECTION CRITERIA:
1. Location: Within 2 miles of the subject property.
2. Sale Date: Sold within the last 12 months.
3. Size: Between ~${lowSqft.toLocaleString()} sqft and ~${highSqft.toLocaleString()} sqft (±20% of subject).
4. Bedrooms: ${(ctx.beds ?? 4)-1}–${(ctx.beds ?? 4)+1} bedrooms (±1 of subject).
5. Bathrooms: ${Math.max(1, Math.floor((ctx.baths ?? 2.5) - 1))}–${Math.ceil((ctx.baths ?? 2.5) + 1)} bathrooms (±1 of subject).
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

  const prompts = [
    { name: 'analyst-user-no-subdivision', text: analystPrompt(false) },
    { name: 'analyst-user-with-subdivision', text: analystPrompt(true) },
  ];

  const tasks = prompts.map(p => async () => {
    const text = await vertexGenerateRaw({ token, location, projectId, model, prompt: p.text });
    return { name: p.name, addresses: extractAddresses(text) };
  });
  const results = [] as any[];
  for (const t of tasks) {
    try { results.push(await t()); } catch { results.push({ name: 'error', addresses: [] }); }
  }
  return results;
}

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const ctx = await buildContext(address, 3, 18);
  console.log('🧩 Context:', ctx);

  // Lightweight comprehensive-like searches: issue grounded prompts and parse, no enrichment/geocoding
  const service = new VertexComparableSearchService() as any;
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  const makePrompt = (subdivision: string | null, radius: number, months: number) => `REAL ESTATE COMPARABLE SEARCH - VERTEX AI GROUNDED ANALYSIS

Use Google Search grounding with authoritative MLS data sources to find recently SOLD comparable properties.

TARGET PROPERTY: ${address}

SEARCH CRITERIA (STRICT REQUIREMENTS):
- Location: Within ${radius} miles of ${address}
- Time frame: Sold within last ${months} months (SOLD properties only, not listings)
- Property type: Single-family homes, townhomes, condos
${subdivision ? `- Subdivision: Only include properties in subdivision "${subdivision}".` : ''}

REQUIRED DATA FOR EACH PROPERTY:
- Complete street address with city, state, ZIP
- Actual sale price (not listing price)
- Sale date in YYYY-MM-DD format
- Bedrooms and bathrooms (exact numbers)
- Square footage (living area)
- Year built
- Source website (Zillow, Redfin, Realtor.com, etc.)

OUTPUT FORMAT:
One property per line, pipe-separated:
address | sold_price | sold_date | beds | baths | sqft | year_built | source_url`;

  const parseRun = async (label: string, subdivision: string | null, radius: number, months: number) => {
    try {
      const prompt = makePrompt(subdivision, radius, months);
      const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });
      const parsed = await service.parseVertexResponse(text, 0, 0, ctx.sqft && ctx.beds && ctx.baths && ctx.yearBuilt ? { sqft: ctx.sqft, beds: ctx.beds, baths: ctx.baths, yearBuilt: ctx.yearBuilt } : undefined);
      return { label, addresses: parsed.map((c: any) => c.address) };
    } catch {
      return { label, addresses: [] };
    }
  };

  console.log('🚀 Running lightweight comprehensive searches in parallel...');
  const [r1, r2, r3, r4] = await Promise.all([
    parseRun('subdivision', ctx.subdivision || null, 3, 18),
    parseRun('broader-1', null, 3, 18),
    parseRun('broader-2', null, 3, 18),
    parseRun('fallback', null, 4, 24)
  ]);
  const compResults = [r1, r2, r3, r4];

  // Analyst method (your prompt) variants
  console.log('🚀 Running analyst prompt variants...');
  const analyst = await runAnalystMethods(ctx);

  // Aggregate + compare
  const setComp = new Set<string>(compResults.flatMap((r: any) => r.addresses));
  const setAnalyst = new Set<string>(analyst.flatMap(r => r.addresses));
  const overlap = [...setComp].filter(a => setAnalyst.has(a));
  const compOnly = [...setComp].filter(a => !setAnalyst.has(a));
  const analystOnly = [...setAnalyst].filter(a => !setComp.has(a));

  console.log('\n=== Comprehensive Parallel (combined) — addresses ===');
  compResults.forEach((r: any) => console.log(`${r.label}: ${r.addresses.length} results`));
  console.log([...setComp].join('\n'));

  console.log('\n=== Analyst Prompt Variants — addresses ===');
  analyst.forEach(r => console.log(`${r.name}: ${r.addresses.length} results`));
  console.log([...setAnalyst].join('\n'));

  console.log('\n=== Overlap ===');
  console.log(overlap.join('\n') || '(none)');

  console.log('\n=== Comprehensive-only ===');
  console.log(compOnly.join('\n') || '(none)');

  console.log('\n=== Analyst-only ===');
  console.log(analystOnly.join('\n') || '(none)');
}

main().catch(err => { console.error('Compare run failed:', err?.message || err); process.exit(1); });
