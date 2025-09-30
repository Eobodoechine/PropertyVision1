// Test VertexAI valuation prompt with specific comp data
import 'dotenv/config';
import { readFileSync } from 'fs';
import { vertexGenerate } from './src/server/vertex-freeform.js';

// Load service account credentials
const saPath = process.env.GCP_SA_JSON || '/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json';
console.log('📂 Loading service account from:', saPath);
const sa = JSON.parse(readFileSync(saPath, 'utf8'));

// Extract project ID from service account
const projectId = sa.project_id;

// Your exact valuation prompt
const valuationPrompt = `Role: You are a valuation assistant. Use only sale price and square footage (to compute PPSF). Do not use beds, baths, condition, or any hidden scoring. Follow the rules exactly and return the JSON schema at the end.

Inputs

You will receive JSON like:

{
  "subject": {"sqft": 2345, "property_type": "single_family"},
  "comps": [
    {"id":"C1","address":"123 Main St","unit":null,"price":350000,"sqft":2000,"sale_date":"2025-06-10","property_type":"single_family"}
    // ...
  ]
}

Rules (price & PPSF only)
0) Clean & prepare

Require price > 0 and sqft > 0. Compute ppsf = price / sqft for every comp.

Deduplicate: if two comps share the same {address, unit} (or the same address when unit is null), keep the most recent sale; mark the others "dup_address_unit".

Property type (if provided): prefer comps with the same property_type as the subject. If that leaves fewer than 3 comps, allow mixed types and set flags.mixed_types = true.

1) Order by PPSF and find obvious lows

Sort comps by PPSF (low → high). Compute the list of adjacent PPSF gaps between neighbors in this order.

If the lowest comp sits far below the pack (i.e., the first gap from it to the next comp is the largest gap among all adjacent gaps), drop that lowest comp as "low_ppsf_isolated". Re-check once after the drop.

2) Try to form a supported high cluster (preferred "optimistic" set)

Start at the highest PPSF and move downward to build the longest consecutive block at the top where no gap inside that block is the largest gap seen in the full list.

Require this block to have at least 3 comps.

Price confirmation inside the block: for each comp in the block, find its two closest prices (by absolute difference) among all comps. The comp is confirmed only if both of those closest prices are also inside the block.

The confirmed members of this block are the HighCluster. If at least 3 are confirmed, keep them and label each "high_cluster_supported". All other highs in the block are "high_no_support".

3) If no HighCluster → build a central–upper chain (baseline "conservative" set)

Using the full (cleaned) list after step 1, locate the middle comp by PPSF (if even count, take the upper of the two middles as the starting point).

From that middle, walk upward and include neighbors until you encounter the first "large jump" in PPSF (the first adjacent gap that ties with or exceeds the largest gap among the lower half of all adjacent gaps). Stop before that jump.

From this upward chain, take the top 3 PPSFs when available (if only 2, keep 2). Mark each "central_upper_chain".

4) Isolated high-price guard (when using step 3)

In the chosen chain from step 3, drop any comp whose two closest prices (by absolute difference) are both outside the chosen set. Mark "high_price_isolated".

5) Stability checks

Minimum comps: target 3 or more comps. If only 2 survive (flat or thin data), allow it but set flags.thin_market = true.

Internal spread sanity: within the chosen set, sort by PPSF. If the largest inside gap occurs at an endpoint (between the lowest member and its neighbor, or between the highest member and its neighbor), remove that endpoint ("spread_trim_low" or "spread_trim_high") once if this increases cohesion. Do not trim below 2 comps.

6) Compute ARV(s)

Conservative ARV: if a central–upper chain was used, compute the middle PPSF of the chosen set (if two values, average those two). ARV price = that PPSF × subject.sqft.

Aggressive ARV: if a HighCluster exists, compute the middle PPSF within the HighCluster the same way; ARV price = that PPSF × subject.sqft.
If no HighCluster, set aggressive = conservative and flags.no_high_cluster = true.

7) If fewer than 2 comps survive

Return "method_used": "insufficient_data", include all drop reasons, and set flags.thin_market = true.

Output JSON (return exactly this shape)
{
  "method_used": "HighCluster | CentralUpperChain | insufficient_data",
  "kept_comps": [
    {"id":"", "address":"", "price":0, "sqft":0, "ppsf":0, "reason":"high_cluster_supported|central_upper_chain|spread_trim_low|spread_trim_high"}
  ],
  "dropped_comps": [
    {"id":"", "reason_codes":["dup_address_unit","low_ppsf_isolated","high_no_support","high_price_isolated","mixed_types","bad_inputs"]}
  ],
  "conservative": {
    "arv_ppsf": 0,
    "arv_price": 0,
    "comp_ids": []
  },
  "aggressive": {
    "arv_ppsf": 0,
    "arv_price": 0,
    "comp_ids": [],
    "no_high_cluster": false
  },
  "flags": {
    "thin_market": false,
    "mixed_types": false
  },
  "notes": "Brief explanation of why each comp was kept/dropped and which fallback was used."
}

Guidance for the agent (implicit heuristics without percentages):

"Largest gap" means the widest step between two neighbors in PPSF order; "large jump" means a gap comparable to that largest step, clearly breaking a smooth run.

"Two closest prices" means the two smallest absolute price differences to that comp among all remaining comps.

When choosing "top 3" in a chain, prefer more members if they remain a smooth run; when forced to choose between 2 vs 3, prefer 3 if available.

Always explain your choices plainly (which gaps broke runs, which prices were nearest, why endpoints were trimmed).

Apply this to the following input data:

{
  "subject": {"sqft": 2345, "property_type": "single_family"},
  "comps": [
    {"id":"C1","address":"2649 Headland Dr, East Point, GA 30344","unit":null,"price":182500,"sqft":1915,"sale_date":"2025-09-15","property_type":"single_family"},
    {"id":"C2","address":"2251 Headland Dr, East Point, GA 30344","unit":null,"price":270000,"sqft":1850,"sale_date":"2025-09-10","property_type":"single_family"},
    {"id":"C3","address":"2221 Plantation Dr, East Point, GA 30344","unit":null,"price":300000,"sqft":1938,"sale_date":"2025-09-05","property_type":"single_family"},
    {"id":"C4","address":"2654 Jefferson Ter, East Point, GA 30344","unit":null,"price":255000,"sqft":2120,"sale_date":"2025-09-05","property_type":"single_family"}
  ]
}`;

async function testValuationPrompt() {
  console.log('🏠 Testing VertexAI Valuation Prompt');
  console.log('====================================');

  try {
    console.log('📝 Sending prompt to VertexAI...');

    // Call VertexAI with the valuation prompt
    const response = await vertexGenerate({
      sa: sa,
      projectId: projectId,
      location: 'us-central1',
      model: 'gemini-2.0-flash-exp',
      prompt: valuationPrompt,
      json: true, // Request JSON response
      grounded: false, // No grounded search needed for this
      timeoutMs: 60000
    });

    console.log('\n📊 VertexAI Response:');
    console.log('===================');
    console.log(response);

    // Try to parse as JSON to verify format
    try {
      const parsed = JSON.parse(response);
      console.log('\n✅ Response successfully parsed as JSON:');
      console.log(JSON.stringify(parsed, null, 2));

      // Validate the expected structure
      if (parsed.method_used && parsed.kept_comps && parsed.dropped_comps && parsed.conservative && parsed.aggressive) {
        console.log('\n🎯 Response matches expected schema structure!');
      } else {
        console.log('\n⚠️  Response structure may be incomplete');
      }

    } catch (parseError) {
      console.log('\n❌ Response is not valid JSON:', parseError.message);
      console.log('Raw response:', response);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testValuationPrompt();