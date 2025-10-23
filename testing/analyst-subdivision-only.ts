import 'dotenv/config';
import fs from 'fs';
import { fetchPropertyDetailsViaVertex } from '../server/vertex-details.js';
import { getServiceAccountToken, vertexGenerateRaw } from './vertex-bakeoff-shared.js';

async function main() {
  const address = process.env.ADDRESS || '185 Jordan Pl, Fayetteville, GA 30215';
  const radiusMiles = 2;
  const months = 12;

  const details = await fetchPropertyDetailsViaVertex(address);
  const subdivision = details?.subdivision || '';
  const beds = details?.beds ?? 4;
  const baths = details?.baths ?? 2.5;
  const sqft = details?.sqft ?? 2331;
  const year = details?.yearBuilt ?? 1998;

  const lowSqft = Math.round(sqft * 0.8);
  const highSqft = Math.round(sqft * 1.2);
  const lowYear = year - 10;
  const highYear = year + 10;

  const prompt = `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below.
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${address}
- Beds: ${beds}
- Baths: ${baths}
- Square Footage: ${sqft.toLocaleString()} sqft
- Year Built: ${year}
${subdivision ? `- Subdivision: ${subdivision}\n` : ''}
COMPARABLE SELECTION CRITERIA:
1. Location: Within ${radiusMiles} miles of the subject property.
2. Sale Date: Sold within the last ${months} months.
3. Size: Between ~${lowSqft.toLocaleString()} sqft and ~${highSqft.toLocaleString()} sqft (±20% of subject).
4. Bedrooms: ${beds-1}–${beds+1} bedrooms (±1 of subject).
5. Bathrooms: ${Math.max(1, Math.floor(baths-1))}–${Math.ceil(baths+1)} bathrooms (±1 of subject).
6. Year Built: Between ${lowYear} and ${highYear} (within ±10 years of subject’s build year).

PROCESS:
- Step 1: List several recent sales within ~${radiusMiles} miles of the subject.
- Step 2: Filter those to only homes meeting ALL the criteria above.
- Step 3: Select 3–5 of the closest matches that would realistically be chosen by a real estate analyst.
- Step 4: For each comp, provide: Address, sale date, sale price, beds, baths, sqft, year built, distance from subject, and a short reason.

OUTPUT FORMAT:
List each comp as a bullet point in this exact format:
- **[Address]** — Sold [Month Year] for $[Price], [Beds] bed / [Baths] bath, [Sqft] sqft, built [Year], [Distance] miles away. *Reason it’s comparable.*

RESTRICTIONS:
- Do not include homes outside ${radiusMiles} miles or older than ${months} months.
- Do not include homes outside the sqft, bed/bath, or year built ranges.
- Do not hallucinate properties; only return realistic addresses.
- Return 3–5 comps that BEST match the criteria.

Now, provide the comps.`;

  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  console.log('🧪 Running analyst prompt (subdivision only, no street names)...');
  const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });
  console.log('\n--- Analyst Subdivision-Only Output ---');
  console.log(text);
}

main().catch(err => { console.error('Analyst subdivision-only test failed:', err?.message || err); process.exit(1); });

