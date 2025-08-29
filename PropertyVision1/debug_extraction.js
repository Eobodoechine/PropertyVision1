// Debug script to test property data extraction
const testContent = "Property Details: 851 Hedge Garden Ct Stone Mountain GA 30088. 1516 sq ft living area. 3 bedrooms. 2.5 bathrooms. Built in 1986. Single Family Home property type. Lot size 0.3 acres 13068 sq ft. Features include attached garage fireplace granite counters new exterior siding new furnace fenced yard.";

console.log("Test content:", testContent);

// Test square footage extraction
const sqftPatterns = [
  /(\d{1,5})\s*sq\s*ft/i,
  /(\d{1,5})\s*(?:sq|square)\s*(?:ft|feet|foot)/i,
  /(\d{1,5})\s*sqft/i,
  /square\s*feet[\s:]*(\d{1,5})/i,
  /(\d{1,5})\s*square/i
];

for (const pattern of sqftPatterns) {
  const match = testContent.match(pattern);
  if (match) {
    console.log(`PATTERN MATCH: ${pattern} -> ${match[1]}`);
    break;
  }
}

// Test year extraction
const yearPatterns = [
  /(?:built|year built|constructed)[\s:]*(\d{4})/i,
  /(\d{4})\s*built/i,
  /built\s*in\s*(\d{4})/i
];

for (const pattern of yearPatterns) {
  const match = testContent.match(pattern);
  if (match) {
    console.log(`YEAR MATCH: ${pattern} -> ${match[1]}`);
    break;
  }
}