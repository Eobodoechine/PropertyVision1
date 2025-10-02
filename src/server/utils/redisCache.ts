import Redis from 'ioredis';

/**
 * Redis Cache Client for Raw Comps
 * Provides persistent caching across server restarts
 */
export class RedisCache {
  private client: Redis | null = null;
  private isConnected = false;

  constructor() {
    this.initialize();
  }

  private initialize() {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('⚠️  Redis connection failed after 3 retries, using in-memory fallback');
            return null; // Stop retrying
          }
          return Math.min(times * 100, 2000); // Exponential backoff
        },
        lazyConnect: true, // Don't connect immediately
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.warn('⚠️  Redis connection error:', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('🔌 Redis connection closed');
        this.isConnected = false;
      });

      // Attempt to connect
      this.client.connect().catch((err) => {
        console.warn('⚠️  Redis connection failed:', err.message);
        this.isConnected = false;
      });
    } catch (error) {
      console.warn('⚠️  Failed to initialize Redis client:', error);
      this.client = null;
    }
  }

  /**
   * Get cached raw comps for an address
   */
  async getRawComps(address: string): Promise<any[]> {
    if (!this.client || !this.isConnected) {
      return [];
    }

    try {
      const key = this.getCacheKey(address);
      const data = await this.client.get(key);

      if (!data) {
        return [];
      }

      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('❌ Redis GET error:', error);
      return [];
    }
  }

  /**
   * Update cached raw comps for an address
   */
  async updateRawComps(address: string, newComps: any[]): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const key = this.getCacheKey(address);

      // Get existing cache
      const existing = await this.getRawComps(address);

      // Create a set of existing addresses for fast lookup
      const existingAddresses = new Set(existing.map(comp => comp.address?.toLowerCase()));

      // Find new comps not in cache
      const uniqueNewComps = newComps.filter(comp =>
        comp.address && !existingAddresses.has(comp.address.toLowerCase())
      );

      if (uniqueNewComps.length > 0) {
        const updated = [...existing, ...uniqueNewComps];
        await this.client.set(key, JSON.stringify(updated));
        console.log(`   💾 Redis cache updated: Added ${uniqueNewComps.length} new comps. Total cached: ${updated.length}`);
      } else {
        console.log(`   💾 Redis cache unchanged: No new comps found. Total cached: ${existing.length}`);
      }
    } catch (error) {
      console.error('❌ Redis SET error:', error);
    }
  }

  /**
   * Clear cache for an address
   */
  async clearAddress(address: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const key = this.getCacheKey(address);
      await this.client.del(key);
      console.log(`   🗑️  Redis cache cleared for ${address}`);
    } catch (error) {
      console.error('❌ Redis DEL error:', error);
    }
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const keys = await this.client.keys('rawComps:*');
      if (keys.length > 0) {
        await this.client.del(...keys);
        console.log(`   🗑️  Redis cache cleared: ${keys.length} addresses removed`);
      }
    } catch (error) {
      console.error('❌ Redis CLEAR ALL error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ totalAddresses: number; totalComps: number }> {
    if (!this.client || !this.isConnected) {
      return { totalAddresses: 0, totalComps: 0 };
    }

    try {
      const keys = await this.client.keys('rawComps:*');
      let totalComps = 0;

      for (const key of keys) {
        const data = await this.client.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          totalComps += Array.isArray(parsed) ? parsed.length : 0;
        }
      }

      return {
        totalAddresses: keys.length,
        totalComps
      };
    } catch (error) {
      console.error('❌ Redis STATS error:', error);
      return { totalAddresses: 0, totalComps: 0 };
    }
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Generate cache key for an address
   */
  private getCacheKey(address: string): string {
    return `rawComps:${address.toLowerCase().trim()}`;
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
    }
  }
}

// Singleton instance
let redisCacheInstance: RedisCache | null = null;

export function getRedisCache(): RedisCache {
  if (!redisCacheInstance) {
    redisCacheInstance = new RedisCache();
  }
  return redisCacheInstance;
}
