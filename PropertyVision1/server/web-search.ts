/**
 * Web search service for property research via external provider (Tavily or others)
 */

import cheerio from 'cheerio';

export type WebSearchSubject = {
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  yearBuilt?: number | null;
  type?: string | null;
  sub_type?: string | null;
  photos?: string[] | null;
};

type TavilyResult = {
  url: string;
  title?: string;
  content?: string;
};

async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Support both header and body auth styles
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        max_results: maxResults,
        api_key: apiKey,
      })
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results: any[] = data?.results || data?.data || [];
    return results
      .map((r: any) => ({ url: r.url || r.link || '', title: r.title, content: r.content }))
      .filter((r: any) => typeof r.url === 'string' && r.url.startsWith('http'));
  } catch {
    return [];
  }
}

function extractFromText(text: string) {
  const out: WebSearchSubject = {};
  const lower = text.toLowerCase();

  // sqft
  const sqftMatch = lower.match(/(\d{3,4})\s*(sq\.?\s*ft|square\s*feet|sf)/i);
  if (sqftMatch) {
    const sqft = parseInt(sqftMatch[1], 10);
    if (Number.isFinite(sqft)) out.sqft = sqft;
  }

  // beds
  const bedsMatch = lower.match(/(\d{1,2})\s*(bed(?:room)?s?|br)\b/i);
  if (bedsMatch) {
    const beds = parseInt(bedsMatch[1], 10);
    if (Number.isFinite(beds)) out.beds = beds;
  }

  // baths (support halves)
  const bathsMatch = lower.match(/(\d+(?:\.5)?)\s*(bath(?:room)?s?|ba)\b/i);
  if (bathsMatch) {
    const baths = parseFloat(bathsMatch[1]);
    if (Number.isFinite(baths)) out.baths = baths;
  }

  // year built
  const yearMatch = lower.match(/(?:year\s*built|built\s*in)\s*(\d{4})/i);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const now = new Date().getFullYear() + 1;
    if (year >= 1800 && year <= now) out.yearBuilt = year;
  }

  return out;
}

async function fetchAndExtract(url: string): Promise<WebSearchSubject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal } as any);
    clearTimeout(timeout);
    if (!res.ok) return {};
    const html = await res.text();
    const $ = cheerio.load(html);
    const text = $('body').text() || '';
    return extractFromText(text);
  } catch {
    clearTimeout(timeout);
    return {};
  }
}

export async function webSearchForPropertyDetails(address: string): Promise<WebSearchSubject | null> {
  try {
    const query = `${address} property details year built square feet bedrooms bathrooms`;
    console.log(`🔍 WEB SEARCH (Tavily): ${query}`);

    const results = await tavilySearch(query, 6);
    if (!results.length) return null;

    const aggregate: WebSearchSubject = {};
    for (const r of results) {
      const data = await fetchAndExtract(r.url);
      if (data.beds && !aggregate.beds) aggregate.beds = data.beds;
      if (data.baths && !aggregate.baths) aggregate.baths = data.baths;
      if (data.sqft && !aggregate.sqft) aggregate.sqft = data.sqft;
      if (data.yearBuilt && !aggregate.yearBuilt) aggregate.yearBuilt = data.yearBuilt;
      if (aggregate.beds && aggregate.baths && aggregate.sqft && aggregate.yearBuilt) break;
    }
    return Object.keys(aggregate).length ? aggregate : null;
  } catch (e) {
    console.log(`❌ Web search provider error: ${e}`);
    return null;
  }
}

export async function webSearchForMissingFields(
  address: string,
  existing: Partial<WebSearchSubject>
): Promise<Partial<WebSearchSubject>> {
  const details = await webSearchForPropertyDetails(address);
  if (!details) return {};
  const out: any = {};
  if (existing.sqft == null && details.sqft) out.sqft = details.sqft;
  if (existing.beds == null && details.beds) out.beds = details.beds;
  if (existing.baths == null && details.baths) out.baths = details.baths;
  if (existing.yearBuilt == null && details.yearBuilt) out.yearBuilt = details.yearBuilt;
  return out;
}

export const webSearch = {
  forPropertyDetails: webSearchForPropertyDetails,
  forMissingFields: webSearchForMissingFields,
};

export default webSearch;
