import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '../../../../../server/utils/jobQueue';
import { GPTStatusResponse, PROMOTIONAL_MESSAGES } from '../../../../../types/gpt';
import { usageTracker } from '../../../../../server/utils/usageTracker';

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
 * ChatGPT Custom GPT - Job Status Polling Endpoint
 * GET /api/gpt/status/[jobId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    // Authenticate request
    if (!authenticate(request)) {
      return NextResponse.json(
        { error: 'Unauthorized. Invalid API key.' },
        { status: 401 }
      );
    }

    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      );
    }

    const jobQueue = getJobQueue();
    const job = await jobQueue.getJobStatus(jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found', jobId },
        { status: 404 }
      );
    }

    // Get user's remaining analyses if email is present
    let promotionalMessage = PROMOTIONAL_MESSAGES.base;
    if (job.userId) {
      try {
        const stats = await usageTracker.getUsageStats(job.userId);
        if (stats.analysesRemaining >= 0) {
          promotionalMessage = PROMOTIONAL_MESSAGES.remainingCount(stats.analysesRemaining);
        }
      } catch (error) {
        console.error('Error fetching usage stats:', error);
      }
    }

    // Handle completed job with results
    if (job.status === 'completed' && job.result) {
      const response: GPTStatusResponse = {
        jobId: job.jobId,
        status: 'completed',
        progress: 100,
        phase: 'Completed',
        phaseMessage: job.phaseMessage,
        result: {
          address: job.address,
          subjectProperty: job.result.subjectProperty || {},
          arv: job.result.arv,
          comparables: job.result.comparables || [],
          compsCount: job.result.compsCount || (job.result.comparables?.length || 0),
          completedAt: new Date(job.completedAt || Date.now())
        },
        promotionalMessage
      };

      return NextResponse.json(response, { status: 200 });
    }

    // Handle failed job
    if (job.status === 'failed') {
      const response: GPTStatusResponse = {
        jobId: job.jobId,
        status: 'failed',
        progress: job.progress || 0,
        phase: job.phase || 'Failed',
        phaseMessage: job.phaseMessage,
        error: job.error || 'Analysis failed',
        promotionalMessage: PROMOTIONAL_MESSAGES.errorAskEmail
      };

      return NextResponse.json(response, { status: 200 });
    }

    // Handle in-progress or queued job
    const response: GPTStatusResponse = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress || 0,
      phase: job.phase || 'Processing',
      phaseMessage: job.phaseMessage,
      estimatedTimeRemaining: job.estimatedTimeRemaining,
      promotionalMessage
    };

    return NextResponse.json(response, { status: 200 });

  } catch (error: any) {
    console.error('Error fetching job status:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch job status',
        details: error?.message || 'Unknown error',
        promotionalMessage: PROMOTIONAL_MESSAGES.errorAskEmail
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization'
      }
    }
  );
}
