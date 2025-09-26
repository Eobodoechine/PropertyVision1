// DEBUG Component 3: Response Parsing
// This will test the parsing logic in isolation

console.log('🔍 TESTING COMPONENT 3: Response Parsing');
console.log('========================================');

// Sample Vertex AI responses to test parsing
const SAMPLE_RESPONSES = [
  `### Comparable Properties for 185 Jordan Pl, Fayetteville, GA 30215

1. **165 Longshore Way, Fayetteville, GA 30215**
   - Price: $499,900
   - Beds: 4
   - Baths: 2.5
   - Square Feet: 2,501
   - Year Built: 1998
   - Sale Date: September 2024

2. **235 Surrey Park Dr, Fayetteville, GA 30215**
   - Price: $428,000
   - Beds: 4
   - Baths: 2
   - Square Feet: 1,914
   - Year Built: 1997
   - Sale Date: September 2024`,

  `### Property Details for 185 Jordan Pl, Fayetteville, GA 30215

**CRITICAL DATA**
- Square Footage: 2,331 sqft
- Bedrooms: 4
- Bathrooms: 2.5
- Year Built: 1998
- Property Type: Single Family
- Subdivision: Bailey Oaks

**COMPARABLE SALES:**
• 165 Longshore Way, Fayetteville, GA 30215 - $499,900 - 4BR/2.5BA - 2501 sqft - Built 1998
• 235 Surrey Park Dr, Fayetteville, GA 30215 - $428,000 - 4BR/2BA - 1914 sqft - Built 1997`
];

function testParsingConsistency() {
  console.log('🧪 Testing parsing consistency with different response formats');

  // Test the parsing logic that's embedded in step3-find-comparables.ts
  function extractPropertyData(response) {
    const properties = [];

    // This mimics the parsing logic from the actual code
    const lines = response.split('\n');
    let currentProperty = {};

    for (const line of lines) {
      const trimmed = line.trim();

      // Look for address patterns
      const addressMatch = trimmed.match(/(\d+\s+[^,]+,\s*[^,]+,\s*[A-Z]{2}\s*\d{5})/);
      if (addressMatch) {
        if (currentProperty.address) {
          properties.push({...currentProperty});
        }
        currentProperty = { address: addressMatch[1] };
      }

      // Look for price patterns
      const priceMatch = trimmed.match(/\$([0-9,]+)/);
      if (priceMatch && currentProperty.address) {
        currentProperty.price = parseInt(priceMatch[1].replace(/,/g, ''));
      }

      // Look for sqft patterns
      const sqftMatch = trimmed.match(/([0-9,]+)\s*(?:sq\.?\s*ft\.?|sqft)/i);
      if (sqftMatch && currentProperty.address) {
        currentProperty.sqft = parseInt(sqftMatch[1].replace(/,/g, ''));
      }

      // Look for beds/baths
      const bedsMatch = trimmed.match(/(\d+)\s*(?:BR|bed)/i);
      if (bedsMatch && currentProperty.address) {
        currentProperty.beds = parseInt(bedsMatch[1]);
      }

      const bathsMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:BA|bath)/i);
      if (bathsMatch && currentProperty.address) {
        currentProperty.baths = parseFloat(bathsMatch[1]);
      }

      // Look for year built
      const yearMatch = trimmed.match(/(?:built|year)\s*:?\s*(\d{4})/i);
      if (yearMatch && currentProperty.address) {
        currentProperty.yearBuilt = parseInt(yearMatch[1]);
      }
    }

    if (currentProperty.address) {
      properties.push(currentProperty);
    }

    return properties;
  }

  // Test parsing on sample responses
  SAMPLE_RESPONSES.forEach((response, index) => {
    console.log(`\n📝 Testing Response ${index + 1}:`);
    const parsed = extractPropertyData(response);

    console.log(`Extracted ${parsed.length} properties:`);
    parsed.forEach((prop, i) => {
      console.log(`  ${i+1}. ${prop.address}`);
      console.log(`     Price: $${prop.price || 'MISSING'}`);
      console.log(`     Sqft: ${prop.sqft || 'MISSING'}`);
      console.log(`     Beds: ${prop.beds || 'MISSING'}`);
      console.log(`     Baths: ${prop.baths || 'MISSING'}`);
      console.log(`     Year: ${prop.yearBuilt || 'MISSING'}`);
    });
  });

  // Test for specific issues found in logs
  console.log('\n🔍 Testing specific parsing issues from logs:');

  const problemResponse = `165 McElwaney Way, Fayetteville, GA 30215: 4BR/2.5BA, 2885sqft vs Subject: 4BR/2.5BA, 2331sqft
165 McElwaney Way, Fayetteville, GA 30215: 4BR/2.5BA, 2619sqft vs Subject: 4BR/2.5BA, 2331sqft`;

  console.log('Same property with different sqft values:');
  const parsed = extractPropertyData(problemResponse);
  console.log('Parsed results:', JSON.stringify(parsed, null, 2));

  // Check if parsing consistently extracts the same sqft for the same address
  const sqftValues = parsed
    .filter(p => p.address === '165 McElwaney Way, Fayetteville, GA 30215')
    .map(p => p.sqft);

  if (new Set(sqftValues).size > 1) {
    console.log('🚨 PARSING ISSUE: Same property extracted with different sqft values:', sqftValues);
  } else {
    console.log('✅ Parsing consistent for this property');
  }
}

testParsingConsistency();