import { NextRequest, NextResponse } from 'next/server';
import { usageTracker } from '../../../../server/utils/usageTracker';
import { GPTUsageResponse, PROMOTIONAL_MESSAGES } from '../../../../types/gpt';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// API Key for authentication
const GPT_API_KEY = process.env.GPT_API_KEY || 'your-secret-key-here';

/**
 * Authentication middleware
 */
function authenticate(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
  return apiKey === GPT_API_KEY;
}

/**
 * ChatGPT Custom GPT - Usage Check Endpoint
 * GET /api/gpt/usage?email=user@example.com
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate request
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Invalid API key.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim();

    if (!email) {
      return NextResponse.json(
        {
          error: 'Email parameter is required',
          usage: 'GET /api/gpt/usage?email=user@example.com'
        },
        { status: 400 }
      );
    }

    // Get usage stats
    const stats = await usageTracker.getUsageStats(email);

    const response: GPTUsageResponse = {
      email,
      analysesUsed: stats.analysesUsed,
      analysesLimit: stats.analysesLimit,
      analysesRemaining: stats.analysesRemaining,
      lastAnalysis: stats.lastAnalysis,
      canAnalyze: stats.canAnalyze,
      promotionalMessage: stats.canAnalyze
        ? PROMOTIONAL_MESSAGES.remainingCount(stats.analysesRemaining)
        : PROMOTIONAL_MESSAGES.limitReached
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching usage stats:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch usage statistics',
        details: error?.message || 'Unknown error',
        promotionalMessage: PROMOTIONAL_MESSAGES.base
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for checking usage (alternative to GET with query params)
 * POST /api/gpt/usage with { "email": "user@example.com" }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate request
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Invalid API key.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const email = body?.email?.trim();

    if (!email) {
      return NextResponse.json(
        {
          error: 'Email is required in request body',
          usage: 'POST { "email": "user@example.com" }'
        },
        { status: 400 }
      );
    }

    // Get usage stats
    const stats = await usageTracker.getUsageStats(email);

    const response: GPTUsageResponse = {
      email,
      analysesUsed: stats.analysesUsed,
      analysesLimit: stats.analysesLimit,
      analysesRemaining: stats.analysesRemaining,
      lastAnalysis: stats.lastAnalysis,
      canAnalyze: stats.canAnalyze,
      promotionalMessage: stats.canAnalyze
        ? PROMOTIONAL_MESSAGES.remainingCount(stats.analysesRemaining)
        : PROMOTIONAL_MESSAGES.limitReached
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching usage stats:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch usage statistics',
        details: error?.message || 'Unknown error',
        promotionalMessage: PROMOTIONAL_MESSAGES.base
      },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS for CORS preflight (if needed)
 */
export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization'
      }
    }
  );
}
