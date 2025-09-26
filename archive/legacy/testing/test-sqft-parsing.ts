// Test square footage parsing to fix the lot size confusion

function testSqftParsing() {
  console.log('🧪 TESTING SQUARE FOOTAGE PARSING LOGIC');
  console.log('============================================================');

  // Test data simulating Vertex AI responses that confuse house size with lot size
  const testCases = [
    {
      name: "Correct case - house size only",
      text: "This 4-bedroom home features 2,331 square feet of living space, built in 1998.",
      expected: 2331
    },
    {
      name: "Problematic case - lot size mixed in",
      text: "4-bedroom, 2.5-bathroom home with 2,331 sq ft of living area on a 7,111 sq ft lot.",
      expected: 2331 // Should pick house size, not lot size
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
    }
  ];

  const clean = (s: string) => s.replace(/[,\s]/g, '').trim();

  // Current (broken) logic
  function currentLogic(text: string): number | null {
    const sqftCandidates = [
      text.match(/(?:square\s*feet?|sq\s*ft|sqft)[:\s]*([0-9,]+)/i),
      text.match(/([0-9,]+)\s*(?:square\s*feet?|sq\s*ft|sqft)/i), // This is the problem
      text.match(/(?:living\s*area|floor\s*area)[:\s]*([0-9,]+)/i),
      text.match(/size[:\s]*([0-9,]+)\s*(?:sq|square)/i)
    ];

    for (const candidate of sqftCandidates) {
      if (candidate) {
        const val = Number(clean(candidate[1]));
        if (val >= 500 && val <= 10000) {
          return val;
        }
      }
    }
    return null;
  }

  // Improved logic
  function improvedLogic(text: string): number | null {
    const sqftCandidates = [
      text.match(/(?:square\s*feet?|sq\s*ft|sqft)[:\s]*([0-9,]+)/i),
      text.match(/(?:living\s*area|floor\s*area|interior)[:\s]*([0-9,]+)/i),
      text.match(/(?:home|house)\s*(?:size|area)[:\s]*([0-9,]+)/i),
      text.match(/(?:finished\s*area)[:\s]*([0-9,]+)/i)
    ];

    // Look for numbers with sq ft but EXCLUDE lot-related matches
    const allMatches = Array.from(text.matchAll(/([0-9,]+)\s*(?:square\s*feet?|sq\s*ft|sqft)/gi));
    for (const match of allMatches) {
      const beforeText = text.substring(Math.max(0, match.index! - 50), match.index!).toLowerCase();
      const afterText = text.substring(match.index! + match[0].length, Math.min(text.length, match.index! + match[0].length + 50)).toLowerCase();

      // Skip if lot-related keywords are nearby
      const isLotRelated = /\b(?:lot|acre|land|property)\b/.test(beforeText + ' ' + afterText);
      if (!isLotRelated) {
        sqftCandidates.push(match);
      }
    }

    for (const candidate of sqftCandidates) {
      if (candidate) {
        const val = Number(clean(candidate[1]));
        if (val >= 500 && val <= 10000) {
          return val;
        }
      }
    }
    return null;
  }

  testCases.forEach((testCase, i) => {
    console.log(`\n${i + 1}. ${testCase.name}`);
    console.log(`   Text: "${testCase.text}"`);

    const currentResult = currentLogic(testCase.text);
    const improvedResult = improvedLogic(testCase.text);

    console.log(`   Current logic: ${currentResult} ${currentResult === testCase.expected ? '✅' : '❌'}`);
    console.log(`   Improved logic: ${improvedResult} ${improvedResult === testCase.expected ? '✅' : '❌'}`);
    console.log(`   Expected: ${testCase.expected}`);
  });

  console.log('\n📊 SUMMARY:');
  let currentCorrect = 0;
  let improvedCorrect = 0;

  testCases.forEach(testCase => {
    if (currentLogic(testCase.text) === testCase.expected) currentCorrect++;
    if (improvedLogic(testCase.text) === testCase.expected) improvedCorrect++;
  });

  console.log(`Current logic: ${currentCorrect}/${testCases.length} correct`);
  console.log(`Improved logic: ${improvedCorrect}/${testCases.length} correct`);

  if (improvedCorrect > currentCorrect) {
    console.log('✅ Improvement successful! Safe to apply changes.');
  } else {
    console.log('❌ Improvement failed. Do not apply changes.');
  }
}

testSqftParsing();