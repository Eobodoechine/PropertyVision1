// Geocode Cache - Avoid redundant Google Maps API calls
// Caches normalized address → {lat, lon} mappings
// SUCCESS: No TTL (permanent)
// FAILURE: Configurable negative cache TTL via GEOCODE_NEGATIVE_CACHE_TTL_SECONDS (default: 3600s)

import { redis } from './redisClient';

interface GeoLocation {
  lat: number;
  lon: number;
  cached: boolean;
}

interface GeocodeFailure {
  error: string;
  timestamp: number;
}

export class GeocodeCache {
  private readonly KEY_PREFIX = 'geocode:';
  private readonly NEGATIVE_CACHE_TTL_SECONDS = parseInt(process.env.GEOCODE_NEGATIVE_CACHE_TTL_SECONDS || '3600', 10);

  /**
   * Get cached geocode result
   */
  async get(address: string): Promise<GeoLocation | null> {
    try {
      const key = this.KEY_PREFIX + this.normalizeAddress(address);
      await redis.ensureConnected();

      const cached = await redis.getJson<{ lat: number; lon: number }>(key);
      if (!cached) {
        console.log(`🗺️  GEOCODE CACHE MISS: ${address}`);
        return null;
      }

      console.log(`🗺️  GEOCODE CACHE HIT: ${address} → (${cached.lat}, ${cached.lon})`);
      return { ...cached, cached: true };
    } catch (error) {
      console.error(`❌ GEOCODE CACHE GET ERROR for "${address}":`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
      return null; // On error, treat as cache miss
    }
  }

  /**
   * Store geocode result in cache (NO TTL - permanent)
   */
  async set(address: string, lat: number, lon: number): Promise<void> {
    try {
      const key = this.KEY_PREFIX + this.normalizeAddress(address);
      await redis.ensureConnected();

      // No TTL - successful geocodes are cached forever
      await redis.setJson(key, { lat, lon });

      console.log(`🗺️  GEOCODE CACHED (permanent): ${address} → (${lat}, ${lon})`);
    } catch (error) {
      console.error(`❌ GEOCODE CACHE SET ERROR for "${address}":`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
      // Continue even if caching fails
    }
  }

  /**
   * Store geocode failure in cache (with TTL)
   */
  async setFailure(address: string, error: string): Promise<void> {
    try {
      const key = this.KEY_PREFIX + this.normalizeAddress(address) + ':failure';
      await redis.ensureConnected();

      const failure: GeocodeFailure = {
        error,
        timestamp: Date.now(),
      };

      await redis.setJson(key, failure, this.NEGATIVE_CACHE_TTL_SECONDS);

      console.log(`🗺️  GEOCODE FAILURE CACHED (TTL=${this.NEGATIVE_CACHE_TTL_SECONDS}s): ${address} → ${error}`);
    } catch (err) {
      console.error(`❌ GEOCODE FAILURE CACHE SET ERROR for "${address}":`, err);
      // Continue even if caching fails
    }
  }

  /**
   * Batch get multiple geocode results
   */
  async mget(addresses: string[]): Promise<Map<string, GeoLocation>> {
    if (addresses.length === 0) {
      return new Map();
    }

    try {
      await redis.ensureConnected();

      const keys = addresses.map(addr => this.KEY_PREFIX + this.normalizeAddress(addr));
      const results = await redis.mgetJson<{ lat: number; lon: number }>(keys);

      const map = new Map<string, GeoLocation>();
      for (const [key, value] of results.entries()) {
        if (value) {
          // Extract original address from key
          const normalizedAddr = key.substring(this.KEY_PREFIX.length);
          const originalAddr = addresses.find(a => this.normalizeAddress(a) === normalizedAddr);
          if (originalAddr) {
            map.set(originalAddr, { ...value, cached: true });
          }
        }
      }

      console.log(`🗺️  GEOCODE BATCH: ${map.size}/${addresses.length} cache hits`);
      return map;
    } catch (error) {
      console.error(`❌ GEOCODE BATCH GET ERROR:`, error);
      return new Map();
    }
  }

  /**
   * Normalize address for cache key consistency
   */
  private normalizeAddress(address: string): string {
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

  /**
   * Get cache stats (uses SCAN for safe iteration)
   */
  async getStats(): Promise<{ totalKeys: number }> {
    try {
      await redis.ensureConnected();
      const keys = await redis.scan(`${this.KEY_PREFIX}*`);
      return { totalKeys: keys.length };
    } catch (error) {
      console.error(`❌ GEOCODE CACHE STATS ERROR:`, error);
      return { totalKeys: 0 };
    }
  }

  /**
   * Clear all cached geocodes (for testing/maintenance)
   * Uses SCAN for safe iteration
   */
  async clear(): Promise<number> {
    try {
      await redis.ensureConnected();
      const keys = await redis.scan(`${this.KEY_PREFIX}*`);

      if (keys.length === 0) {
        console.log(`🧹 GEOCODE CACHE: No keys to clear`);
        return 0;
      }

      await redis.del(...keys);
      console.log(`🧹 GEOCODE CACHE: Cleared ${keys.length} entries`);
      return keys.length;
    } catch (error) {
      console.error(`❌ GEOCODE CACHE CLEAR ERROR:`, error);
      console.error(`   Error type: ${typeof error}`);
      console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}

// Export singleton
export const geocodeCache = new GeocodeCache();
