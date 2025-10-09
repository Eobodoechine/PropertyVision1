import Redis from 'ioredis';

/**
 * Redis Singleton Client
 * Single ioredis instance shared across all requests
 * Provides JSON helpers and safe key iteration with SCAN
 */
class RedisClient {
  private client: Redis | null = null;
  private isConnected = false;
  private keepaliveInterval: NodeJS.Timeout | null = null;
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
        maxRetriesPerRequest: null, // Allow operations during reconnect
        retryStrategy: (times) => {
          const delay = Math.min(1000 * Math.pow(2, Math.min(times, 5)), 15000);
          console.log(`🔄 Redis retry ${times} in ${delay}ms`);
          return delay;
        },
        lazyConnect: true, // Don't connect immediately - wait for ensureConnected()
        enableReadyCheck: true,
        keepAlive: 60000,
        connectTimeout: 10000,
        enableOfflineQueue: false,
        reconnectOnError: (err) => {
          const needsReconnect = /READONLY|ECONNRESET|ETIMEDOUT|EPIPE/i.test(err.message);
          if (needsReconnect) {
            console.log(`🔄 Reconnecting on error: ${err.message}`);
          }
          return needsReconnect;
        },
        ...(redisUrl.includes('rediss://') ? {
          tls: process.env.REDIS_TLS_ENABLED === 'true' ? {} : undefined,
        } : {}),
        ...(process.env.REDIS_PASSWORD ? {
          password: process.env.REDIS_PASSWORD,
        } : {}),
      });

      this.client.on('connect', () => {
        console.log('🟢 Redis connected');
        this.isConnected = true;
        this.startKeepalive();
      });

      this.client.on('ready', () => {
        console.log('✅ Redis ready');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('🔴 Redis error:', err.message);
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

      this.client.on('end', () => {
        console.log('🔌 Redis connection ended');
        this.isConnected = false;
      });
    } catch (error) {
      console.error('⚠️  Failed to initialize Redis client:', error);
      this.client = null;
    }
  }

  /**
   * Ensure Redis connection is established before operations
   * @param timeoutMs Connection timeout in milliseconds (default: 15000)
   */
  async ensureConnected(timeoutMs: number = 15000): Promise<void> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    // If already connected, return immediately
    if (this.isConnected && this.client.status === 'connect') {
      return;
    }

    // If currently connecting, wait for existing connection attempt
    if (this.connectionPromise) {
      await Promise.race([
        this.connectionPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Redis connect timeout')), timeoutMs)
        ),
      ]);
      return;
    }

    // Start new connection attempt
    this.connectionPromise = this.client.connect().finally(() => {
      this.connectionPromise = null;
    });

    await Promise.race([
      this.connectionPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connect timeout')), timeoutMs)
      ),
    ]);

    // Verify connection succeeded
    if (!this.isConnected) {
      throw new Error(`Redis connection failed (status=${this.client.status})`);
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

  // ==================== Core Redis Methods ====================

  /**
   * GET: Retrieve value for a key
   */
  async get(key: string): Promise<string | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error(`❌ Redis GET error for ${key}:`, error);
      return null;
    }
  }

  /**
   * SET: Store value with optional TTL
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error('Redis client not available');
    }
    try {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      console.error(`❌ Redis SET error for ${key}:`, error);
      throw error;
    }
  }

  /**
   * MGET: Retrieve multiple keys at once
   */
  async mget(...keys: string[]): Promise<(string | null)[]> {
    if (!this.client || !this.isConnected || keys.length === 0) {
      return [];
    }
    try {
      return await this.client.mget(...keys);
    } catch (error) {
      console.error(`❌ Redis MGET error:`, error);
      return [];
    }
  }

  /**
   * DEL: Delete one or more keys
   */
  async del(...keys: string[]): Promise<number> {
    if (!this.client || !this.isConnected || keys.length === 0) {
      return 0;
    }
    try {
      return await this.client.del(...keys);
    } catch (error) {
      console.error(`❌ Redis DEL error:`, error);
      return 0;
    }
  }

  /**
   * EXISTS: Check if key exists
   */
  async exists(...keys: string[]): Promise<number> {
    if (!this.client || !this.isConnected || keys.length === 0) {
      return 0;
    }
    try {
      return await this.client.exists(...keys);
    } catch (error) {
      console.error(`❌ Redis EXISTS error:`, error);
      return 0;
    }
  }

  /**
   * SCAN: Safe key iteration (use instead of KEYS in hot paths)
   * Returns all keys matching pattern
   */
  async scan(pattern: string): Promise<string[]> {
    if (!this.client || !this.isConnected) {
      return [];
    }

    try {
      const keys: string[] = [];
      let cursor = '0';

      do {
        const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      return keys;
    } catch (error) {
      console.error(`❌ Redis SCAN error for pattern ${pattern}:`, error);
      return [];
    }
  }

  /**
   * KEYS: Get keys matching pattern (use SCAN in hot paths instead)
   * WARNING: Blocking operation, use only for admin/maintenance
   */
  async keys(pattern: string): Promise<string[]> {
    if (!this.client || !this.isConnected) {
      return [];
    }
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      console.error(`❌ Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  // ==================== JSON Helper Methods ====================

  /**
   * Get JSON value
   */
  async getJson<T = any>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error(`❌ Redis getJson parse error for ${key}:`, error);
      return null;
    }
  }

  /**
   * Set JSON value with optional TTL
   */
  async setJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.set(key, serialized, ttlSeconds);
    } catch (error) {
      console.error(`❌ Redis setJson error for ${key}:`, error);
    }
  }

  /**
   * Get multiple JSON values at once
   */
  async mgetJson<T = any>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) {
      return new Map();
    }

    const values = await this.mget(...keys);
    const map = new Map<string, T>();

    for (let i = 0; i < keys.length; i++) {
      if (values[i]) {
        try {
          map.set(keys[i], JSON.parse(values[i] as string) as T);
        } catch (error) {
          console.error(`❌ Redis mgetJson parse error for ${keys[i]}:`, error);
        }
      }
    }

    return map;
  }

  // ==================== Redis Streams Methods ====================

  /**
   * Add entry to Redis Stream
   */
  async xadd(stream: string, fields: Record<string, string>): Promise<string | null> {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error('Redis client not available');
    }

    try {
      const args = [stream, 'MAXLEN', '~', '50000', '*'];
      for (const [key, value] of Object.entries(fields)) {
        args.push(key, value);
      }
      const result = await (this.client.xadd as any)(...args);
      if (!result) {
        throw new Error('XADD returned empty ID');
      }
      return result;
    } catch (error) {
      console.error('❌ Redis XADD error:', error);
      throw error;
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

  // ==================== Utility Methods ====================

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected;
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

  /**
   * Get raw ioredis client for advanced operations
   */
  getRawClient(): Redis | null {
    return this.client;
  }

  /**
   * Pipeline for batch operations
   */
  pipeline(): ReturnType<Redis['pipeline']> | null {
    if (!this.client) {
      return null;
    }
    return this.client.pipeline();
  }
}

// Declare global type for development mode hot reload persistence
declare global {
  var __redisClient: RedisClient | undefined;
}

// Singleton instance
let redisClientInstance: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  // In development, use globalThis to persist across hot reloads
  if (process.env.NODE_ENV !== 'production') {
    if (!global.__redisClient) {
      global.__redisClient = new RedisClient();
    }
    return global.__redisClient;
  }

  // In production, use regular singleton
  if (!redisClientInstance) {
    redisClientInstance = new RedisClient();
  }
  return redisClientInstance;
}

// Export singleton instance
export const redis = getRedisClient();
