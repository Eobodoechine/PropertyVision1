// Real web search integration for property data
export async function performRealWebSearch(query: string): Promise<any[]> {
  console.log(`🌐 PERFORMING REAL WEB SEARCH: ${query}`);
  console.log(`❌ ERROR: External web search API integration required`);
  console.log(`🚫 No hardcoded data available - must integrate with external web search service`);

  // Return empty results - external API integration required
  return [];
}

// Function to extract property details from web search results - no longer needed as web search results are not hardcoded
// export function extractPropertyDataFromWebResults(results: any[], targetAddress: string) {
//   console.log(`🔍 EXTRACTING PROPERTY DATA from ${results.length} web search results`);

//   const propertyData: any = {};

//   for (const result of results) {
//     const content = `${result.title || ''} ${result.description || ''} ${result.content || ''}`.toLowerCase();

//     // Check if this result is about the target address
//     const addressParts = targetAddress.toLowerCase().split(/[\s,]+/).filter(part => part.length > 2);
//     const hasAddressMatch = addressParts.some(part => content.includes(part));

//     if (!hasAddressMatch) continue;

//     // Extract square footage
//     if (!propertyData.sqft) {
//       const sqftPatterns = [
//         /(\d{1,4})\s*(?:square\s*)?(?:sq\.?\s*)?(?:ft\.?|feet)/i,
//         /(\d{1,4})\s*sqft/i,
//         /(\d{1,4})\s*sq\s*ft/i
//       ];

//       for (const pattern of sqftPatterns) {
//         const match = content.match(pattern);
//         if (match) {
//           propertyData.sqft = parseInt(match[1]);
//           console.log(`✅ Found square footage: ${propertyData.sqft} sqft`);
//           break;
//         }
//       }
//     }

//     // Extract bedrooms
//     if (!propertyData.beds) {
//       const bedroomPatterns = [
//         /(\d+)\s*bed(?:room)?s?/i,
//         /(\d+)\s*br/i,
//         /(\d+)\s*bd/i
//       ];

//       for (const pattern of bedroomPatterns) {
//         const match = content.match(pattern);
//         if (match) {
//           propertyData.beds = parseInt(match[1]);
//           console.log(`✅ Found bedrooms: ${propertyData.beds} beds`);
//           break;
//         }
//       }
//     }

//     // Extract bathrooms
//     if (!propertyData.baths) {
//       const bathroomPatterns = [
//         /(\d+(?:\.\d+)?)\s*bath(?:room)?s?/i,
//         /(\d+(?:\.\d+)?)\s*ba/i
//       ];

//       for (const pattern of bathroomPatterns) {
//         const match = content.match(pattern);
//         if (match) {
//           propertyData.baths = parseFloat(match[1]);
//           console.log(`✅ Found bathrooms: ${propertyData.baths} baths`);
//           break;
//         }
//       }
//     }

//     // Extract year built
//     if (!propertyData.yearBuilt) {
//       const yearPatterns = [
//         /built\s*in\s*(\d{4})/i,
//         /(\d{4})\s*built/i,
//         /year\s*built\s*(\d{4})/i
//       ];

//       for (const pattern of yearPatterns) {
//         const match = content.match(pattern);
//         if (match) {
//           const year = parseInt(match[1]);
//           if (year >= 1800 && year <= new Date().getFullYear()) {
//             propertyData.yearBuilt = year;
//             console.log(`✅ Found year built: ${propertyData.yearBuilt}`);
//             break;
//           }
//         }
//       }
//     }
//   }

//   console.log(`🏠 EXTRACTED PROPERTY DATA:`, propertyData);
//   return propertyData;
// }