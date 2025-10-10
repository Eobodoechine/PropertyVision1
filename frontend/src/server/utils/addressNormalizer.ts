/**
 * Address Normalization Utility
 * Ensures consistent cache keys across all Redis operations
 */

/**
 * Normalize address for cache key consistency
 * Used by: geocodeCache, redisCache (subject refs, global comps, rawComps)
 */
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .trim()
    // Remove punctuation except commas
    .replace(/[^\w\s,]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Remove extra commas
    .replace(/,+/g, ',')
    .trim();
}
