import Redis from 'ioredis';

/**
 * Redis Cache Client for Raw Comps
 * Provides persistent caching across server restarts
 */
export class RedisCache {
  private client: Redis | null = null;
  private isConnected = false;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private reconnectCallbacks: Array<() => void> = [];
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    try {
      // Support both REDIS_URL and REDIS_HOST/REDIS_PORT env vars
      const redisUrl = process.env.REDIS_URL ||
        (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || '6379'}` : 'redis://localhost:6379');

      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 10) {
            console.warn('⚠️  Redis connection failed after 10 retries');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 1000, 5000); // Max 5s between retries
          console.log(`🔄 Redis retry ${times}/10 in ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
        enableReadyCheck: true,
        keepAlive: 30000, // TCP keepalive every 30s
        connectTimeout: 10000,
        enableOfflineQueue: true,
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected');
        this.isConnected = true;
        this.startKeepalive();
      });

      this.client.on('ready', () => {
        console.log('✅ Redis ready');
        this.isConnected = true;
        // Trigger reconnect callbacks for workers
        this.reconnectCallbacks.forEach(cb => cb());
      });

      this.client.on('error', (err) => {
        console.warn('⚠️  Redis connection error:', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('🔌 Redis connection closed');
        this.isConnected = false;
        this.stopKeepalive();
      });

      this.client.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
        this.isConnected = false;
      });

      // Attempt to connect and store promise
      this.connectionPromise = this.client.connect()
        .then(() => {
          console.log('🔗 Redis connection established');
        })
        .catch((err) => {
          console.warn('⚠️  Redis connection failed:', err.message);
          this.isConnected = false;
          throw err;
        });
    } catch (error) {
      console.warn('⚠️  Failed to initialize Redis client:', error);
      this.client = null;
      this.connectionPromise = Promise.reject(error);
    }
  }

  /**
   * Ensure Redis connection is established before operations
   */
  async ensureConnected(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
      } catch (error) {
        console.error('❌ Redis connection failed:', error);
        throw new Error('Redis connection failed');
      }
    } else {
      throw new Error('Redis client not initialized');
    }
  }

  /**
   * Start keepalive ping to prevent connection timeout
   */
  private startKeepalive() {
    if (this.keepaliveInterval) {
      return;
    }

    this.keepaliveInterval = setInterval(async () => {
      if (this.client && this.isConnected) {
        try {
          await this.client.ping();
        } catch (error) {
          console.warn('⚠️  Keepalive ping failed');
        }
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop keepalive ping
   */
  private stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Register callback for reconnection events (for workers)
   */
  onReconnect(callback: () => void) {
    this.reconnectCallbacks.push(callback);
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
   * Store job status in Redis
   */
  async setJob(jobId: string, jobData: any, ttlSeconds: number = 3600): Promise<void> {
    if (!this.client || !this.isConnected) {
      console.error(`❌ CRITICAL: Redis not connected, job ${jobId} will NOT be persisted!`);
      return;
    }

    try {
      const key = `job:${jobId}`;
      const dataStr = JSON.stringify(jobData);
      await this.client.set(key, dataStr, 'EX', ttlSeconds);
      console.log(`📝 Redis SET job:${jobId} (${dataStr.length} bytes, TTL=${ttlSeconds}s)`);
    } catch (error) {
      console.error(`❌ Redis SET JOB error for ${jobId}:`, error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Get job status from Redis
   */
  async getJob(jobId: string): Promise<any | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const key = `job:${jobId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('❌ Redis GET JOB error:', error);
      return null;
    }
  }

  /**
   * Delete job from Redis
   */
  async deleteJob(jobId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const key = `job:${jobId}`;
      await this.client.del(key);
    } catch (error) {
      console.error('❌ Redis DEL JOB error:', error);
    }
  }

  // ==================== Redis Streams Methods ====================

  /**
   * Add entry to Redis Stream
   */
  async xadd(stream: string, fields: Record<string, string>): Promise<string | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const args = [stream, 'MAXLEN', '~', '50000', '*'];
      for (const [key, value] of Object.entries(fields)) {
        args.push(key, value);
      }
      return await (this.client.xadd as any)(...args);
    } catch (error) {
      console.error('❌ Redis XADD error:', error);
      return null;
    }
  }

  /**
   * Create consumer group (idempotent)
   */
  async xgroupCreate(stream: string, group: string, id: string = '$'): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      await this.client.xgroup('CREATE', stream, group, id, 'MKSTREAM');
    } catch (error: any) {
      if (!/BUSYGROUP/.test(error.message)) {
        console.error('❌ Redis XGROUP CREATE error:', error);
      }
    }
  }

  /**
   * Read from stream as consumer group
   */
  async xreadGroup(group: string, consumer: string, stream: string, count: number, block: number = 15000): Promise<any[]> {
    if (!this.client || !this.isConnected) {
      console.warn(`⚠️  Redis not connected, cannot read from stream ${stream}`);
      return [];
    }

    try {
      const result = await this.client.xreadgroup(
        'GROUP', group, consumer,
        'COUNT', count,
        'BLOCK', block,
        'STREAMS', stream, '>'
      );
      return result || [];
    } catch (error) {
      console.error('❌ Redis XREADGROUP error:', error);
      return [];
    }
  }

  /**
   * Acknowledge message
   */
  async xack(stream: string, group: string, id: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      console.error(`❌ CRITICAL: Cannot XACK - Redis not connected! Stream: ${stream}, ID: ${id}`);
      return;
    }

    try {
      const result = await this.client.xack(stream, group, id);
      console.log(`✅ XACK successful: stream=${stream}, id=${id}, result=${result}`);
    } catch (error) {
      console.error(`❌ Redis XACK error for ${id}:`, error);
      throw error; // Re-throw so caller knows it failed
    }
  }

  /**
   * Auto-claim idle messages (for reaping stuck jobs)
   */
  async xautoclaim(stream: string, group: string, consumer: string, minIdleTime: number, start: string = '0-0', count: number = 50): Promise<[string, any[]]> {
    if (!this.client || !this.isConnected) {
      return ['0-0', []];
    }

    try {
      const result = await this.client.xautoclaim(
        stream, group, consumer, minIdleTime, start, 'COUNT', count
      );
      return result as [string, any[]];
    } catch (error) {
      console.error('❌ Redis XAUTOCLAIM error:', error);
      return ['0-0', []];
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
