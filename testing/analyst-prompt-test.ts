import 'dotenv/config';
import fs from 'fs';
import { getServiceAccountToken, vertexGenerateRaw } from './vertex-bakeoff-shared.js';

async function main() {
  const address = '185 Jordan Pl, Fayetteville, GA 30215';
  const subject = {
    address,
    beds: 4,
    baths: 2.5,
    sqft: 2331,
    year: 1998,
  };

  const prompt = `You are an experienced real estate analyst.

Your task is to identify the best comparable sales ("comps") for the subject property below. 
Follow the step-by-step instructions exactly and only return comps that meet the criteria.

SUBJECT PROPERTY:
- Address: ${subject.address}
- Beds: ${subject.beds}
- Baths: ${subject.baths}
- Square Footage: ${subject.sqft.toLocaleString()} sqft
- Year Built: ${subject.year}

COMPARABLE SELECTION CRITERIA:
1. Location: Within 2 miles of the subject property.
2. Sale Date: Sold within the last 12 months.
3. Size: Between ~${Math.round(subject.sqft * 0.8).toLocaleString()} sqft and ~${Math.round(subject.sqft * 1.2).toLocaleString()} sqft (±20% of subject).
4. Bedrooms: 3–5 bedrooms (±1 of subject).
5. Bathrooms: 2–4 bathrooms (±1 of subject).
6. Year Built: Between ${subject.year - 10} and ${subject.year + 10} (within ±10 years of subject’s build year).

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

  // SA + endpoint
  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  if (!saPath || !fs.existsSync(saPath)) throw new Error('GCP_SA_JSON is required');
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');

  // Use google_search grounding implicitly (vertexGenerateRaw config does)
  console.log('🧪 Running analyst-style prompt...');
  const text = await vertexGenerateRaw({ token, location, projectId, model, prompt });

  console.log('\n--- Analyst Prompt Output ---');
  console.log(text);
}

main().catch(err => { console.error('Analyst prompt test failed:', err?.message || err); process.exit(1); });

