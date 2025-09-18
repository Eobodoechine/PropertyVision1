// Final test of square footage parsing with lot size exclusion

function testFinalSqftParsing() {
  console.log('🧪 TESTING FINAL SQUARE FOOTAGE PARSING');
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
      expected: null
    },
    {
      name: "Real Vertex response - Run 3 type",
      text: "4-bedroom, 2.5-bathroom home built in 1998 featuring 7,111 square feet including lot area, with 2,331 sq ft of living space.",
      expected: 2331
    }
  ];

  const clean = (s: string) => s.replace(/[,\s]/g, '').trim();

  function finalLogic(text: string): number | null {
    // Priority 1: Look for house-specific terms first
    const houseSpecificPatterns = [
      text.match(/(?:living\s*area|floor\s*area|interior\s*space|finished\s*area)[:\s]*([0-9,]+)/i),
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

    // Priority 2: Find all sq ft numbers and exclude obvious lot references
    const allMatches = Array.from(text.matchAll(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet|sqft)/gi));
    const validNumbers: number[] = [];

    for (const match of allMatches) {
      const val = Number(clean(match[1]));
      if (val >= 500 && val <= 50000) {
        // Check context around this number
        const beforeText = text.substring(Math.max(0, match.index! - 30), match.index!).toLowerCase();
        const afterText = text.substring(match.index! + match[0].length, Math.min(text.length, match.index! + match[0].length + 30)).toLowerCase();

        // Skip if clearly lot-related
        const isLotRelated = /\b(?:lot|acre|land|property|site)\b/.test(beforeText + ' ' + afterText) &&
                            !/\b(?:living|interior|home|house)\b/.test(beforeText + ' ' + afterText);

        if (!isLotRelated) {
          validNumbers.push(val);
          console.log(`   📏 Valid house candidate: ${val} sqft`);
        } else {
          console.log(`   🚫 Skipped lot reference: ${val} sqft`);
        }
      }
    }

    // If we have multiple valid numbers, choose the smaller one (house is typically smaller than total property)
    if (validNumbers.length >= 2) {
      validNumbers.sort((a, b) => a - b);
      const smaller = validNumbers[0];
      const larger = validNumbers[1];
      if (larger > smaller * 1.5 && smaller <= 10000) {
        console.log(`   ✅ Multiple valid numbers, choosing smaller: ${smaller} sqft`);
        return smaller;
      }
    }

    // Single valid number - use it if reasonable for house size
    if (validNumbers.length === 1) {
      const val = validNumbers[0];
      if (val <= 8000) { // Most houses under 8000 sqft
        console.log(`   ✅ Single valid number: ${val} sqft`);
        return val;
      } else {
        console.log(`   ❌ Single number too large for house: ${val} sqft`);
        return null;
      }
    }

    console.log(`   ❌ No valid house size found`);
    return null;
  }

  testCases.forEach((testCase, i) => {
    console.log(`\n${i + 1}. ${testCase.name}`);
    console.log(`   Text: "${testCase.text.substring(0, 100)}..."`);

    const result = finalLogic(testCase.text);
    const isCorrect = result === testCase.expected;

    console.log(`   Result: ${result} ${isCorrect ? '✅' : '❌'}`);
    console.log(`   Expected: ${testCase.expected}`);
  });

  console.log('\n📊 SUMMARY:');
  let correct = 0;

  testCases.forEach(testCase => {
    if (finalLogic(testCase.text) === testCase.expected) correct++;
  });

  console.log(`Final logic: ${correct}/${testCases.length} correct`);

  if (correct === testCases.length) {
    console.log('🎯 PERFECT! Safe to apply changes.');
  } else if (correct >= testCases.length - 1) {
    console.log('✅ Very good! Safe to apply changes.');
  } else {
    console.log('❌ Needs more work.');
  }
}

testFinalSqftParsing();