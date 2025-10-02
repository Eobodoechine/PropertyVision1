import { NextResponse } from 'next/server';
import { getRedisCache } from '@/server/utils/redisCache';

export async function GET() {
  try {
    const redisCache = getRedisCache();

    // Get cache stats
    const stats = await redisCache.getCacheStats();

    // Get all keys directly from redisCache
    const client = (redisCache as any).client;

    if (!client || !(redisCache as any).isConnected) {
      return NextResponse.json({
        status: 'disconnected',
        message: 'Redis client not connected',
        stats: { totalAddresses: 0, totalComps: 0 }
      });
    }

    const keys = await client.keys('rawComps:*');

    // Get detailed info for each key
    const keysInfo = await Promise.all(
      keys.slice(0, 10).map(async (key: string) => {
        const data = await client.get(key);
        const parsed = data ? JSON.parse(data) : [];
        const address = key.replace('rawComps:', '');

        return {
          address,
          compsCount: Array.isArray(parsed) ? parsed.length : 0,
          sizeBytes: data ? data.length : 0
        };
      })
    );

    return NextResponse.json({
      status: 'connected',
      stats,
      totalKeys: keys.length,
      sampleKeys: keysInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
      status: 'error'
    }, { status: 500 });
  }
}
