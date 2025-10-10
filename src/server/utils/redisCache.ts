import { redis } from './redisClient';
import { normalizeAddress } from './addressNormalizer';

/**
 * Redis Cache Client for Raw Comps
 * LEGACY WRAPPER: Delegates to new Redis singleton
 * Use redis singleton directly in new code
 */
export class RedisCache {
  /**
   * Ensure Redis connection is established before operations
   */
  async ensureConnected(): Promise<void> {
    return redis.ensureConnected();
  }

  /**
   * Get cached raw comps for an address
   */
  async getRawComps(address: string): Promise<any[]> {
    const data = await redis.getJson<any[]>(this.getCacheKey(address));
    return data || [];
  }

  /**
   * Update cached raw comps for an address
   */
  async updateRawComps(address: string, newComps: any[]): Promise<void> {
    try {
      const key = this.getCacheKey(address);

      // Get existing cache
      const existing = await this.getRawComps(address);

      // Create a set of existing addresses for fast lookup (use normalized addresses)
      const existingAddresses = new Set(existing.map(comp => normalizeAddress(comp.address || '')));

      // Find new comps not in cache
      const uniqueNewComps = newComps.filter(comp =>
        comp.address && !existingAddresses.has(normalizeAddress(comp.address))
      );

      if (uniqueNewComps.length > 0) {
        const updated = [...existing, ...uniqueNewComps];
        await redis.setJson(key, updated);
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
    const key = this.getCacheKey(address);
    await redis.del(key);
    console.log(`   🗑️  Redis cache cleared for ${address}`);
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    const keys = await redis.scan('rawComps:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`   🗑️  Redis cache cleared: ${keys.length} addresses removed`);
    }
  }

  /**
   * Store job status in Redis
   */
  async setJob(jobId: string, jobData: any, ttlSeconds: number = 3600): Promise<void> {
    const key = `job:${jobId}`;
    await redis.setJson(key, jobData, ttlSeconds);
    console.log(`📝 Redis SET job:${jobId} (TTL=${ttlSeconds}s)`);
  }

  /**
   * Get job status from Redis
   */
  async getJob(jobId: string): Promise<any | null> {
    const key = `job:${jobId}`;
    return await redis.getJson(key);
  }

  /**
   * Delete job from Redis
   */
  async deleteJob(jobId: string): Promise<void> {
    const key = `job:${jobId}`;
    await redis.del(key);
  }

  // ==================== Redis Streams Methods ====================

  /**
   * Add entry to Redis Stream
   */
  async xadd(stream: string, fields: Record<string, string>): Promise<string | null> {
    return redis.xadd(stream, fields);
  }

  /**
   * Create consumer group (idempotent)
   */
  async xgroupCreate(stream: string, group: string, id: string = '$'): Promise<void> {
    return redis.xgroupCreate(stream, group, id);
  }

  /**
   * Read from stream as consumer group
   */
  async xreadGroup(group: string, consumer: string, stream: string, count: number, block: number = 15000): Promise<any[]> {
    return redis.xreadGroup(group, consumer, stream, count, block);
  }

  /**
   * Acknowledge message
   */
  async xack(stream: string, group: string, id: string): Promise<void> {
    return redis.xack(stream, group, id);
  }

  /**
   * Auto-claim idle messages (for reaping stuck jobs)
   */
  async xautoclaim(stream: string, group: string, consumer: string, minIdleTime: number, start: string = '0-0', count: number = 50): Promise<[string, any[]]> {
    return redis.xautoclaim(stream, group, consumer, minIdleTime, start, count);
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ totalAddresses: number; totalComps: number }> {
    const keys = await redis.scan('rawComps:*');
    let totalComps = 0;

    for (const key of keys) {
      const data = await redis.getJson<any[]>(key);
      if (data && Array.isArray(data)) {
        totalComps += data.length;
      }
    }

    return {
      totalAddresses: keys.length,
      totalComps
    };
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return redis.isReady();
  }

  /**
   * Generate cache key for an address
   */
  private getCacheKey(address: string): string {
    return `rawComps:${normalizeAddress(address)}`;
  }

  /**
   * Close Redis connection
   */
  async disconnect(): Promise<void> {
    return redis.disconnect();
  }

  /**
   * Register reconnect callback
   */
  onReconnect(callback: () => void): void {
    const client = redis.getRawClient();
    if (client) {
      client.on('reconnecting', callback);
    }
  }

  /**
   * V10: Get subject-comp references for an address
   */
  async getSubjectCompRefs(address: string): Promise<Array<{ compAddress: string; distanceMi: number }>> {
    const key = `subject:${normalizeAddress(address)}:refs`;
    const data = await redis.getJson<Array<{ compAddress: string; distanceMi: number }>>(key);
    return data || [];
  }

  /**
   * V10: Get global comp data for multiple addresses
   */
  async getGlobalComps(addresses: string[]): Promise<Map<string, any>> {
    if (addresses.length === 0) {
      return new Map();
    }

    const keys = addresses.map(addr => `globalComp:${normalizeAddress(addr)}`);
    const results = await redis.mgetJson(keys);

    const map = new Map<string, any>();
    for (const [key, value] of results.entries()) {
      if (value) {
        const normalizedAddr = key.substring('globalComp:'.length);
        // Find original address that matches this normalized version
        const originalAddr = addresses.find(a => normalizeAddress(a) === normalizedAddr);
        if (originalAddr) {
          map.set(originalAddr, value);
        }
      }
    }
    return map;
  }

  /**
   * V10: Store subject-comp references
   */
  async setSubjectCompRefs(address: string, refs: Array<{ compAddress: string; distanceMi: number }>, ttlSeconds: number = 86400): Promise<void> {
    const key = `subject:${normalizeAddress(address)}:refs`;
    await redis.setJson(key, refs, ttlSeconds);
    console.log(`💾 Wrote subject refs → ${key} (${refs.length} refs)`);
  }

  /**
   * V10: Update subject-comp references (merge with existing)
   */
  async updateSubjectCompRefs(address: string, newRefs: Array<{ compAddress: string; distanceMi: number }>, ttlSeconds: number = 86400): Promise<void> {
    const key = `subject:${normalizeAddress(address)}:refs`;

    // Get existing refs
    const existing = await this.getSubjectCompRefs(address);

    // Merge: use Map to dedupe by compAddress, keeping shortest distance
    const merged = new Map<string, number>();

    for (const ref of existing) {
      merged.set(ref.compAddress, ref.distanceMi);
    }

    for (const ref of newRefs) {
      const existingDist = merged.get(ref.compAddress);
      if (existingDist === undefined || ref.distanceMi < existingDist) {
        merged.set(ref.compAddress, ref.distanceMi);
      }
    }

    // Convert back to array
    const mergedRefs = Array.from(merged.entries()).map(([compAddress, distanceMi]) => ({
      compAddress,
      distanceMi
    }));

    await redis.setJson(key, mergedRefs, ttlSeconds);
  }

  /**
   * V10: Store global comp data
   */
  async setGlobalComp(address: string, compData: any, ttlSeconds: number = 86400): Promise<void> {
    const key = `globalComp:${normalizeAddress(address)}`;
    await redis.setJson(key, compData, ttlSeconds);
  }

  /**
   * V10: Batch store multiple global comps
   */
  async setGlobalComps(comps: any[], ttlSeconds: number = 86400): Promise<void> {
    if (comps.length === 0) {
      return;
    }

    await redis.ensureConnected(); // Ensure connection before pipeline

    const pipeline = redis.pipeline();
    if (!pipeline) throw new Error('Redis pipeline unavailable');

    for (const comp of comps) {
      if (comp.address) {
        const key = `globalComp:${normalizeAddress(comp.address)}`;
        pipeline.setex(key, ttlSeconds, JSON.stringify(comp));
      }
    }

    try {
      await pipeline.exec();
      console.log(`💾 Wrote global comps → ${comps.length} keys, e.g. globalComp:${normalizeAddress(comps[0].address)}`);
    } catch (err) {
      console.error('❌ setGlobalComps pipeline error:', err);
      throw err;
    }
  }
}

// Declare global type for development mode hot reload persistence
declare global {
  var __redisCache: RedisCache | undefined;
}

// Singleton instance
let redisCacheInstance: RedisCache | null = null;

export function getRedisCache(): RedisCache {
  // In development, use globalThis to persist across hot reloads
  if (process.env.NODE_ENV !== 'production') {
    if (!global.__redisCache) {
      global.__redisCache = new RedisCache();
    }
    return global.__redisCache;
  }

  // In production, use regular singleton
  if (!redisCacheInstance) {
    redisCacheInstance = new RedisCache();
  }
  return redisCacheInstance;
}
