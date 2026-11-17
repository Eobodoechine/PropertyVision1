// Free US Census Bureau geocoder: no API key, no account, no billing.
// US addresses only. Replaces Google Maps geocoding unless GEOCODER=google.
// Docs: https://geocoding.geo.census.gov/geocoder/

import { jobLog } from './jobLogger';

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

export function useCensusGeocoder(): boolean {
  return (process.env.GEOCODER || 'census').toLowerCase() !== 'google';
}

export interface CensusGeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
}

export async function censusGeocode(address: string, timeoutMs = 20000): Promise<CensusGeocodeResult | null> {
  const url = `${CENSUS_URL}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      jobLog(`❌ CENSUS_GEOCODE http=${res.status} for: ${address}`);
      return null;
    }
    const data: any = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match) {
      jobLog(`❌ CENSUS_GEOCODE no match (${Date.now() - started}ms): ${address}`);
      return null;
    }
    // Census returns x = longitude, y = latitude
    const out = { lat: Number(match.coordinates.y), lng: Number(match.coordinates.x), matchedAddress: match.matchedAddress };
    jobLog(`🗺️  CENSUS_GEOCODE ok (${Date.now() - started}ms): ${address} -> ${out.lat}, ${out.lng}`);
    return out;
  } catch (e: any) {
    jobLog(`❌ CENSUS_GEOCODE error (${Date.now() - started}ms): ${address}: ${e?.name === 'AbortError' ? 'timeout' : e?.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
