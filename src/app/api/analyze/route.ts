import { NextRequest, NextResponse } from 'next/server';
import logger, { logSearchRequest, logSearchError } from '../../../server/utils/logger';
import { getJobQueue } from '../../../server/utils/jobQueue';
import { getRedisCache } from '../../../server/utils/redisCache';

// Always use async mode now
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const redis = getRedisCache();

// Public demo guardrails. Each live analysis spends API credits, so the demo
// caps runs per visitor and per day. LIVE_ANALYSIS=off leaves only the saved
// example reports.
const LIVE_ANALYSIS = (process.env.LIVE_ANALYSIS || 'on').toLowerCase() !== 'off';
const MAX_PER_IP_PER_DAY = Number(process.env.DEMO_MAX_PER_IP_PER_DAY || 3);
const MAX_PER_DAY = Number(process.env.DEMO_MAX_PER_DAY || 25);

function clientIp(request: NextRequest): string {
  // Behind the Cloudflare tunnel the visitor's address is in cf-connecting-ip.
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function checkDemoLimits(request: NextRequest): Promise<NextResponse | null> {
  if (!LIVE_ANALYSIS) {
    return NextResponse.json(
      { error: 'Live analysis is turned off on this demo right now. Open one of the example reports instead.' },
      { status: 503 }
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  try {
    const perIp = await redis.incrWithExpiry(`demo:ip:${day}:${clientIp(request)}`, 2 * 86400);
    if (perIp > MAX_PER_IP_PER_DAY) {
      return NextResponse.json(
        { error: `This demo allows ${MAX_PER_IP_PER_DAY} live analyses per visitor per day. The example reports are always available.` },
        { status: 429 }
      );
    }
    const total = await redis.incrWithExpiry(`demo:day:${day}`, 2 * 86400);
    if (total > MAX_PER_DAY) {
      return NextResponse.json(
        { error: "Today's live analyses for this demo are used up. Please try again tomorrow, or open an example report." },
        { status: 429 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Live analysis is unavailable right now. The example reports are still available.' },
      { status: 503 }
    );
  }
  return null;
}

const DEMO_WINDOW_MS = 10 * 60 * 1000;
const DEMO_MAX_JOBS_PER_IP = Number(process.env.PV_DEMO_IP_JOB_LIMIT || 6);
const recentSubmitsByIp = new Map<string, number[]>();

// A published demo link is a public spend button: every submit here costs real Vertex
// and geocoding quota, so the window is capped per IP while PV_LOCAL_DEMO is on.
function withinDemoBudget(ip: string): boolean {
  const now = Date.now();
  const hits = (recentSubmitsByIp.get(ip) || []).filter(t => now - t < DEMO_WINDOW_MS);
  const allowed = hits.length < DEMO_MAX_JOBS_PER_IP;
  if (allowed) hits.push(now);
  recentSubmitsByIp.set(ip, hits);
  if (recentSubmitsByIp.size > 500) {
    for (const [key, times] of recentSubmitsByIp) {
      if (!times.length || now - times[times.length - 1] >= DEMO_WINDOW_MS) recentSubmitsByIp.delete(key);
    }
  }
  return allowed;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  // Cloudflare's edge sets cf-connecting-ip to the real client and strips anything
  // the client sent; x-forwarded-for alone would let callers rotate the key for free.
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for');

  try {
    const body = await request.json();
    const address = String(body?.address || '').trim();
    const userId = body?.userId || request.headers.get('x-user-id');
    const sessionId = body?.sessionId || request.headers.get('x-session-id');

    if (!address) {
      logSearchError({
        address: '',
        userId: userId || undefined,
        sessionId: sessionId || undefined,
        error: new Error('Address is required'),
        stage: 'validation',
      });
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }
    if (address.length > 200) {
      return NextResponse.json(
        { error: 'Please enter a single street address (under 200 characters).' },
        { status: 400 }
      );
    }

    // Log incoming search request
    logSearchRequest({
      address,
      userId: userId || undefined,
      sessionId: sessionId || undefined,
      ip: ip || 'unknown',
    });

    if (process.env.PV_LOCAL_DEMO === 'true' && !withinDemoBudget(ip || 'unknown')) {
      logger.warn('Demo rate limit hit', {
        eventType: 'JOB_THROTTLED',
        address,
        ip: ip || 'unknown',
        limit: DEMO_MAX_JOBS_PER_IP,
        windowMs: DEMO_WINDOW_MS,
      });
      return NextResponse.json(
        { error: `Demo limit reached for this network (${DEMO_MAX_JOBS_PER_IP} analyses per 10 minutes). Please wait a few minutes.` },
        { status: 429 }
      );
    }

    // Ensure Redis is connected before operations
    await redis.ensureConnected();

    const limited = await checkDemoLimits(request);
    if (limited) return limited;

    // Create async job
    const jobQueue = getJobQueue();
    const jobId = await jobQueue.enqueueJob(address, userId);

    console.log(`✅ Job ${jobId} created for address: ${address}`);

    return NextResponse.json({
      jobId,
      status: 'queued',
      message: 'Analysis started. Poll /api/analyze/status/{jobId} for results.'
    });

  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const message = error?.message || 'Failed to create job';

    let address = '';
    try {
      const body = await request.clone().json();
      address = String(body?.address || '');
    } catch {}

    logSearchError({
      address,
      userId: undefined,
      sessionId: undefined,
      error: error instanceof Error ? error : new Error(message),
      stage: 'job_creation',
    });

    logger.error('Job creation failed', {
      eventType: 'JOB_ERROR',
      address,
      executionTimeMs,
      errorMessage: message,
      errorStack: error?.stack,
    });

    return NextResponse.json(
      { error: 'Failed to create analysis job', details: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { message: 'Use POST method to analyze properties. This endpoint now uses async jobs - poll /api/analyze/status/{jobId} for results.' },
    { status: 405 }
  );
}
