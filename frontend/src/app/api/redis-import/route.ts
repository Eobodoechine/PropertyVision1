import { NextRequest, NextResponse } from 'next/server';
import { getRedisCache } from '@/server/utils/redisCache';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, rawComps } = body;

    if (!address || !Array.isArray(rawComps)) {
      return NextResponse.json({
        error: 'Invalid payload. Expected {address: string, rawComps: array}'
      }, { status: 400 });
    }

    const redisCache = getRedisCache();
    await redisCache.updateRawComps(address, rawComps);

    return NextResponse.json({
      success: true,
      address,
      compsImported: rawComps.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      status: 'error'
    }, { status: 500 });
  }
}
