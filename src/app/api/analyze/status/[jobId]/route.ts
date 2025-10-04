import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '../../../../../server/utils/jobQueue';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const jobQueue = getJobQueue();
    const job = await jobQueue.getJobStatus(params.jobId);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: params.jobId,
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      result: job.result,
      error: job.error
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to get job status', details: error.message },
      { status: 500 }
    );
  }
}
