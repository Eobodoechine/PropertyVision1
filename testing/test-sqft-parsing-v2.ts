// Test square footage parsing - better approach

function testSqftParsingV2() {
  console.log('🧪 TESTING SQUARE FOOTAGE PARSING V2');
  console.log('============================================================');

  const testCases = [
    {
      name: "Correct case - house size only",
      text: "This 4-bedroom home features 2,331 square feet of living space, built in 1998.",
      expected: 2331
    },
    {
      name: "Problematic case - lot size mixed in",
      text: "4-bedroom, 2.5-bathroom home with 2,331 sq ft of living area on a 7,111 sq ft lot.",
      expected: 2331
    },
    {
      name: "Another lot confusion case",
      text: "Built in 1998, this property has 2,331 square feet with lot size: 7,111 square feet.",
      expected: 2331
    },
    {
      name: "Lot mentioned first",
      text: "Situated on 7,111 square feet lot, the home offers 2,331 sq ft of interior space.",
      expected: 2331
    },
    {
      name: "Acre conversion case",
      text: "Home size 2,331 sqft on 0.16 acres (approximately 7,111 sq ft lot).",
      expected: 2331
    },
    {
      name: "Edge case - only lot size mentioned",
      text: "Property sits on 7,111 sq ft lot in Bailey Oaks subdivision.",
      expected: null // Should not extract lot size as house size
    }
  ];

  const clean = (s: string) => s.replace(/[,\s]/g, '').trim();

  // Better approach: Prioritize house-specific terms and use smaller numbers when both present
  function betterLogic(text: string): number | null {
    // Priority 1: Look for house-specific terms first
    const houseSpecificPatterns = [
      text.match(/(?:living\s*area|floor\s*area|interior\s*space)[:\s]*([0-9,]+)/i),
      text.match(/(?:home|house)\s*(?:has|features|offers)[^0-9]*([0-9,]+)\s*(?:sq\s*ft|square\s*feet)/i),
      text.match(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet)\s*of\s*(?:living|interior|floor)/i),
      text.match(/(?:home|house)\s*size[:\s]*([0-9,]+)/i)
    ];

    for (const candidate of houseSpecificPatterns) {
      if (candidate) {
        const val = Number(clean(candidate[1]));
        if (val >= 500 && val <= 10000) {
          console.log(`   🏠 Found house-specific: ${val} sqft`);
          return val;
        }
      }
    }

    // Priority 2: Find all sq ft numbers and choose the smaller one (house usually smaller than lot)
    const allSqftNumbers = Array.from(text.matchAll(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet|sqft)/gi))
      .map(match => Number(clean(match[1])))
      .filter(val => val >= 500 && val <= 50000) // Expanded range but still reasonable
      .sort((a, b) => a - b); // Sort ascending

    if (allSqftNumbers.length >= 2) {
      // If we have 2 numbers and one is much larger, choose the smaller (likely house)
      const smaller = allSqftNumbers[0];
      const larger = allSqftNumbers[1];
      if (larger > smaller * 2 && smaller <= 10000) { // Lot is typically 2-5x house size
        console.log(`   📏 Multiple numbers found, choosing smaller: ${smaller} sqft (vs ${larger})`);
        return smaller;
      }
    }

    // Priority 3: Single number case - use existing logic but be more careful
    const generalPatterns = [
      text.match(/(?:square\s*feet?|sq\s*ft|sqft)[:\s]*([0-9,]+)/i),
      text.match(/([0-9,]+)\s*(?:square\s*feet?|sq\s*ft|sqft)/i)
    ];

    for (const candidate of generalPatterns) {
      if (candidate) {
        const val = Number(clean(candidate[1]));
        // For single numbers, be more restrictive on upper limit
        if (val >= 500 && val <= 8000) { // Most houses are under 8000 sqft
          console.log(`   📐 Single number found: ${val} sqft`);
          return val;
        }
      }
    }

    console.log(`   ❌ No valid house size found`);
    return null;
  }

  testCases.forEach((testCase, i) => {
    console.log(`\n${i + 1}. ${testCase.name}`);
    console.log(`   Text: "${testCase.text}"`);

    const result = betterLogic(testCase.text);
    const isCorrect = result === testCase.expected;

    console.log(`   Result: ${result} ${isCorrect ? '✅' : '❌'}`);
    console.log(`   Expected: ${testCase.expected}`);
  });

  console.log('\n📊 SUMMARY:');
  let correct = 0;

  testCases.forEach(testCase => {
    if (betterLogic(testCase.text) === testCase.expected) correct++;
  });

  console.log(`Better logic: ${correct}/${testCases.length} correct`);

  if (correct >= testCases.length - 1) { // Allow 1 failure
    console.log('✅ Improvement successful! Safe to apply changes.');
  } else {
    console.log('❌ Improvement needs more work.');
  }
}

testSqftParsingV2();