import { NextRequest, NextResponse } from 'next/server';
import logger, { logSearchRequest, logSearchError } from '../../../../server/utils/logger';
import { getJobQueue } from '../../../../server/utils/jobQueue';
import { getRedisCache } from '../../../../server/utils/redisCache';
import { usageTracker } from '../../../../server/utils/usageTracker';
import { GPTAnalyzeRequest, GPTAnalyzeResponse, PROMOTIONAL_MESSAGES } from '../../../../types/gpt';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const redis = getRedisCache();

// API Key for authentication (stored in environment)
const GPT_API_KEY = process.env.GPT_API_KEY || 'your-secret-key-here';

/**
 * Authentication middleware
 */
function authenticate(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
  return apiKey === GPT_API_KEY;
}

/**
 * ChatGPT Custom GPT - Property Analysis Endpoint
 * POST /api/gpt/analyze
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip');

  try {
    // Authenticate request
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Invalid API key.' },
        { status: 401 }
      );
    }

    const body: GPTAnalyzeRequest = await request.json();
    const address = String(body?.address || '').trim();
    const userEmail = body?.userEmail?.trim();

    // Validate address
    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Check usage limits if email provided
    let remainingAnalyses = undefined;
    if (userEmail) {
      const usageCheck = await usageTracker.canAnalyze(userEmail);

      if (!usageCheck.canAnalyze) {
        return NextResponse.json(
          {
            error: 'Analysis limit reached',
            message: PROMOTIONAL_MESSAGES.limitReached,
            analysesRemaining: 0,
            promotionalMessage: PROMOTIONAL_MESSAGES.limitReached
          },
          { status: 429 } // Too Many Requests
        );
      }

      remainingAnalyses = usageCheck.analysesRemaining;
    }

    // Log incoming search request
    logSearchRequest({
      address,
      userId: userEmail || 'anonymous-gpt-user',
      sessionId: `gpt-${Date.now()}`,
      ip: ip || 'unknown',
    });

    // Ensure Redis is connected
    await redis.ensureConnected();

    // Create async job with email metadata
    const jobQueue = getJobQueue();
    const jobId = await jobQueue.enqueueJob(address, userEmail || undefined, userEmail || undefined, 'chatgpt');

    // Record usage if email provided
    if (userEmail) {
      try {
        await usageTracker.recordAnalysis(userEmail, jobId, 'chatgpt');
        // Decrement remaining since we just used one
        if (remainingAnalyses !== undefined) {
          remainingAnalyses = Math.max(0, remainingAnalyses - 1);
        }
      } catch (error) {
        console.error('Failed to record usage:', error);
        // Continue anyway - don't fail the analysis
      }
    }

    console.log(`✅ GPT Job ${jobId} created for address: ${address} (email: ${userEmail || 'not provided'})`);

    const response: GPTAnalyzeResponse = {
      jobId,
      status: 'queued',
      message: `Analysis started for ${address}. Poll /api/gpt/status/${jobId} for results.`,
      remainingAnalyses,
      promotionalMessage: userEmail && remainingAnalyses !== undefined
        ? PROMOTIONAL_MESSAGES.remainingCount(remainingAnalyses)
        : PROMOTIONAL_MESSAGES.base
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const message = error?.message || 'Failed to create job';

    let address = '';
    let userEmail = '';
    try {
      const body = await request.clone().json();
      address = String(body?.address || '');
      userEmail = body?.userEmail || '';
    } catch {}

    logSearchError({
      address,
      userId: userEmail || 'anonymous-gpt-user',
      sessionId: `gpt-${Date.now()}`,
      error: error instanceof Error ? error : new Error(message),
      stage: 'gpt_job_creation',
    });

    logger.error('GPT Job creation failed', {
      eventType: 'GPT_JOB_ERROR',
      address,
      userEmail,
      executionTimeMs,
      errorMessage: message,
      errorStack: error?.stack,
    });

    return NextResponse.json(
      {
        error: 'Failed to create analysis job',
        details: message,
        promotionalMessage: PROMOTIONAL_MESSAGES.errorAskEmail
      },
      { status: 500 }
    );
  }
}

/**
 * GET request returns API documentation
 */
export async function GET() {
  return NextResponse.json(
    {
      message: 'ChatGPT Custom GPT - Property Analysis API',
      usage: 'POST to this endpoint with { "address": "123 Main St", "userEmail": "optional@email.com" }',
      authentication: 'Include API key in x-api-key header or Authorization: Bearer <key>',
      documentation: 'See /docs/chatgpt-custom-gpt-setup.md for full setup instructions'
    },
    { status: 200 }
  );
}
