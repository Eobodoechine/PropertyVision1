
/**
 * Web search service for property research
 * All hardcoded data removed - uses only external APIs
 */

export type WebSearchSubject = {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  type?: string | null;
  sub_type?: string | null;
  photos?: string[] | null;
};

export async function webSearchForPropertyDetails(address: string): Promise<WebSearchSubject | null> {
  console.log(`🔍 WEB SEARCH: No hardcoded data - external API integration required for ${address}`);
  return null;
}

export async function webSearchForMissingFields(
  address: string,
  existing: Partial<WebSearchSubject>
): Promise<Partial<WebSearchSubject>> {
  console.log(`🔍 WEB SEARCH: No hardcoded data - external API integration required for missing fields of ${address}`);
  return {};
}

// Export for routes.ts compatibility
export const webSearch = {
  forPropertyDetails: webSearchForPropertyDetails,
  forMissingFields: webSearchForMissingFields,
};

export default webSearch;
