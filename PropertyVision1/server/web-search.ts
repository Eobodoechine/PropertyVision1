/**
 * Minimal stub: real web search removed.
 * Keeps the same surface so routes can import { webSearch } safely.
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

export async function webSearchForPropertyDetails(_address: string): Promise<WebSearchSubject | null> {
  return null; // no demo data
}

export async function webSearchForMissingFields(
  _address: string,
  _existing: Partial<WebSearchSubject>
): Promise<Partial<WebSearchSubject>> {
  return {}; // no enrichment
}

// What routes.ts expects:
export const webSearch = {
  forPropertyDetails: webSearchForPropertyDetails,
  forMissingFields: webSearchForMissingFields,
};

export default webSearch;
