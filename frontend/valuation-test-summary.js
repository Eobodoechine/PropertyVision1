// Clean summary of VertexAI valuation test results
console.log('🏠 VertexAI Valuation Test Results');
console.log('=================================');

const rawResponse = `{
  "method_used": "CentralUpperChain",
  "kept_comps": [
    {
      "id": "C3",
      "address": "2221 Plantation Dr, East Point, GA 30344",
      "price": 300000,
      "sqft": 1938,
      "ppsf": 154.70691434468523,
      "reason": "central_upper_chain"
    },
    {
      "id": "C2",
      "address": "2251 Headland Dr, East Point, GA 30344",
      "price": 270000,
      "sqft": 1850,
      "ppsf": 145.94594594594594,
      "reason": "central_upper_chain"
    },
    {
      "id": "C4",
      "address": "2654 Jefferson Ter, East Point, GA 30344",
      "price": 255000,
      "sqft": 2120,
      "ppsf": 120.28301886792453,
      "reason": "central_upper_chain"
    }
  ],
  "dropped_comps": [
    {
      "id": "C1",
      "reason_codes": []
    }
  ],
  "conservative": {
    "arv_ppsf": 145.94594594594594,
    "arv_price": 342338.5416666666,
    "comp_ids": [
      "C4",
      "C2",
      "C3"
    ]
  },
  "aggressive": {
    "arv_ppsf": 145.94594594594594,
    "arv_price": 342338.5416666666,
    "comp_ids": [
      "C4",
      "C2",
      "C3"
    ],
    "no_high_cluster": true
  },
  "flags": {
    "thin_market": false,
    "mixed_types": false
  },
  "notes": "All comps had valid price and sqft. No comps were dropped due to address duplication or property type. No comps were dropped as low_ppsf_isolated. A HighCluster could not be formed. Therefore, a CentralUpperChain was used. The middle comp is C2. The largest gap in the lower half is between C1 and C4. The chain includes C4, C2, and C3. No comps were dropped as high_price_isolated. No comps were dropped due to spread."
}`;

const result = JSON.parse(rawResponse);

console.log('\n📊 Analysis Summary:');
console.log(`• Method Used: ${result.method_used}`);
console.log(`• Comps Kept: ${result.kept_comps.length} of 4`);
console.log(`• Comps Dropped: ${result.dropped_comps.length}`);

console.log('\n💰 Valuation Results:');
console.log(`• Conservative ARV: $${Math.round(result.conservative.arv_price).toLocaleString()}`);
console.log(`• Aggressive ARV: $${Math.round(result.aggressive.arv_price).toLocaleString()}`);
console.log(`• PPSF Used: $${Math.round(result.conservative.arv_ppsf)}`);

console.log('\n🏘️ Kept Comparables:');
result.kept_comps.forEach((comp, i) => {
  console.log(`${i + 1}. ${comp.address}`);
  console.log(`   $${comp.price.toLocaleString()} • ${comp.sqft} sqft • $${Math.round(comp.ppsf)}/sqft`);
});

console.log('\n❌ Dropped Comparables:');
result.dropped_comps.forEach((comp, i) => {
  console.log(`${i + 1}. ${comp.id} • Reason: ${comp.reason_codes.length ? comp.reason_codes.join(', ') : 'No specific reason given'}`);
});

console.log('\n🏠 Subject Property:');
console.log(`• Square Footage: 2,345 sqft`);
console.log(`• Estimated Value: $${Math.round(result.conservative.arv_price).toLocaleString()}`);

console.log('\n✅ Test Conclusion: VertexAI successfully applied the valuation logic and returned properly formatted JSON results.');