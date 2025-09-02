/**
 * Web search service for property research via external provider (Tavily or others)
 */

import { load as loadCheerio } from 'cheerio';
import { extractFromPage, mergeDetails } from './providers/extractors';

const WEB_DEBUG = (process.env.DEBUG_WEB || '').toString().trim() !== ''
  && (process.env.DEBUG_WEB || '0') !== '0'
  && (process.env.DEBUG_WEB || '').toLowerCase() !== 'false';
function dlog(...args: any[]) {
  if (WEB_DEBUG) console.error('[WEB]', ...args);
}

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
    dlog('Tavily search query:', query);
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
    const mapped = results
      .map((r: any) => ({ url: r.url || r.link || '', title: r.title, content: r.content }))
      .filter((r: any) => typeof r.url === 'string' && r.url.startsWith('http'));
    dlog('Tavily results:', mapped.map(r => r.url));
    return mapped;
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
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  } as any;
  try {
    const res = await fetch(url, { signal: controller.signal, headers } as any);
    clearTimeout(timeout);
    if (!res.ok) return {};
    const html = await res.text();
    // Try structured extraction first (schema/heuristics/host-specific)
    const details = await extractFromPage(url, html);
    if (details && (details.sqft || details.beds || details.baths || details.yearBuilt)) {
      dlog('Structured extraction success for', url, '->', details);
      return {
        beds: details.beds ?? undefined,
        baths: details.baths ?? undefined,
        sqft: details.sqft ?? undefined,
        yearBuilt: details.yearBuilt ?? undefined,
        type: details.type ?? undefined,
        sub_type: null,
        photos: null,
      };
    }
    // Fallback: crude text scrape
    dlog('Structured extraction failed for', url, '- falling back to text extraction');
    const $ = loadCheerio(html);
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

    const results = await tavilySearch(query, 8);
    if (!results.length) return null;

    // Prefer known real estate hosts first
    const priority = ['realtor.com','zillow.com','redfin.com','trulia.com','homes.com'];
    const sorted = results.slice().sort((a,b) => {
      const ha = new URL(a.url).hostname.replace(/^www\./,'');
      const hb = new URL(b.url).hostname.replace(/^www\./,'');
      const ia = priority.indexOf(ha);
      const ib = priority.indexOf(hb);
      if (ia !== -1 && ib === -1) return -1;
      if (ib !== -1 && ia === -1) return 1;
      return 0;
    });

    const collected: any[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      try { dlog(`Fetching [${i+1}/${sorted.length}]`, r.url); } catch {}
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(r.url, { signal: controller.signal, headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        }} as any);
        clearTimeout(timeout);
        if (!res.ok) continue;
        const html = await res.text();
        const details = await extractFromPage(r.url, html);
        if (details) {
          collected.push(details);
          try { dlog('Extracted from', r.url, ':', details); } catch {}
        } else {
          try { dlog('No details extracted from', r.url); } catch {}
        }
        if (collected.length >= 5) break;
      } catch { clearTimeout(timeout); }
    }

    try { dlog('Collected details:', collected); } catch {}
    const merged = mergeDetails(collected);
    if (!merged) return null;
    const result = {
      beds: merged.beds ?? null,
      baths: merged.baths ?? null,
      sqft: merged.sqft ?? null,
      yearBuilt: merged.yearBuilt ?? null,
      type: merged.type ?? null,
      sub_type: null,
      photos: null,
    };
    try { dlog('Merged details:', result); } catch {}
    return result;
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
