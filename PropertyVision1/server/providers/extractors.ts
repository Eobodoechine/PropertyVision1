import { load as loadCheerio } from 'cheerio';

export type ExtractedDetails = {
  beds?: number | null;
  baths?: number | null; // allow .5
  sqft?: number | null;
  yearBuilt?: number | null;
  type?: string | null;
  source?: string; // hostname
};

function toNumber(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function normalizeBaths(v: any): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d+(?:\.5)?)$/);
  if (m) return parseFloat(m[1]);
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

// Generic schema.org JSON-LD extractor
export function extractSchemaOrg(html: string, hostname: string): ExtractedDetails | null {
  try {
    const $ = loadCheerio(html);
    const scripts = $('script[type="application/ld+json"]').toArray();
    for (const el of scripts) {
      try {
        const text = $(el).text();
        if (!text) continue;
        const data = JSON.parse(text);
        const graph = Array.isArray(data) ? data : (Array.isArray(data['@graph']) ? data['@graph'] : [data]);
        for (const node of graph) {
          const t = (node['@type'] || node['type'] || '').toString().toLowerCase();
          if (!t) continue;
          if (t.includes('residence') || t.includes('apartment') || t.includes('house') || t.includes('place') || t.includes('offercatalog') || t.includes('offer')) {
            const beds = toNumber(node['numberOfRooms'] ?? node['numberOfBedrooms'] ?? node['bedrooms']?.value ?? node['bedrooms']);
            const baths = normalizeBaths(node['numberOfBathroomsTotal'] ?? node['bathrooms']?.value ?? node['bathrooms']);
            const sqft = toNumber(node['floorSize']?.value ?? node['size']?.value ?? node['area']?.value ?? node['floorSize']?.value?.value);
            const year = toNumber(node['yearBuilt'] ?? node['dateBuilt']);
            if (beds || baths || sqft || year) {
              return {
                beds: beds ?? null,
                baths: baths ?? null,
                sqft: sqft ?? null,
                yearBuilt: year ?? null,
                type: (node['@type'] || null)?.toString().toLowerCase() ?? null,
                source: hostname,
              };
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

// Host-specific light extractors (regex hints)
export function extractFromHtmlHeuristics(html: string, hostname: string): ExtractedDetails | null {
  const lower = html.toLowerCase();
  const out: ExtractedDetails = { source: hostname };

  // sqft
  const sqft = /(?:\b|\D)(\d{3,4})\s*(sq\.?\s*ft|square\s*feet|sf)\b/i.exec(lower);
  if (sqft) out.sqft = toNumber(sqft[1]);

  // beds
  const beds = /(?:\b|\D)(\d{1,2})\s*(bed(?:room)?s?|br)\b/i.exec(lower);
  if (beds) out.beds = toNumber(beds[1]);

  // baths
  const baths = /(?:\b|\D)(\d+(?:\.5)?)\s*(bath(?:room)?s?|ba)\b/i.exec(lower);
  if (baths) out.baths = normalizeBaths(baths[1]);

  // year built
  const year = /(?:year\s*built|built\s*in)\s*(\d{4})/i.exec(lower);
  if (year) out.yearBuilt = toNumber(year[1]);

  if (out.beds || out.baths || out.sqft || out.yearBuilt) return out;
  return null;
}

export function mergeDetails(items: ExtractedDetails[]): ExtractedDetails | null {
  if (!items.length) return null;
  const pick = (selector: (x: ExtractedDetails) => any): any => {
    const vals = items.map(selector).filter(v => v != null);
    if (!vals.length) return null;
    // Majority or first
    const counts = new Map<any, number>();
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    let best = vals[0], bestC = 0;
    counts.forEach((c, v) => { if (c > bestC) { best = v; bestC = c; } });
    return best;
  };
  return {
    beds: pick(x => x.beds),
    baths: pick(x => x.baths),
    sqft: pick(x => x.sqft),
    yearBuilt: pick(x => x.yearBuilt),
    type: pick(x => x.type),
    source: items[0].source,
  };
}

export async function extractFromPage(url: string, html: string): Promise<ExtractedDetails | null> {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // 1) schema.org JSON-LD
    const schema = extractSchemaOrg(html, hostname);
    if (schema) return schema;
    // 2) heuristics
    const heur = extractFromHtmlHeuristics(html, hostname);
    if (heur) return heur;
  } catch {}
  return null;
}

