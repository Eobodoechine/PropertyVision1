import { NextRequest, NextResponse } from 'next/server';
import { parsePubSubMessage, validatePubSubRequest, JobMessage } from '@/server/utils/pubsubPublisher';
import { getJobQueue } from '@/server/utils/jobQueue';

/**
 * HTTP endpoint for processing Pub/Sub push messages
 *
 * This endpoint receives job messages from Google Pub/Sub (via Eventarc)
 * and processes them using the existing job queue infrastructure.
 *
 * Pub/Sub Message Format:
 * {
 *   message: {
 *     data: "base64-encoded-json",
 *     messageId: "...",
 *     publishTime: "...",
 *     attributes: { jobId, source, timestamp }
 *   },
 *   subscription: "..."
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse request body
    const body = await request.json();

    // Validate Pub/Sub message structure
    if (!validatePubSubRequest({ body })) {
      console.error('❌ Invalid Pub/Sub message format');
      return NextResponse.json(
        { error: 'Invalid Pub/Sub message format' },
        { status: 400 }
      );
    }

    // Parse job data from Pub/Sub message
    const jobData: JobMessage = parsePubSubMessage(body.message);
    const pubsubMessageId = body.message.messageId;

    console.log(`📬 Received Pub/Sub message ${pubsubMessageId} for job ${jobData.jobId}`);
    console.log(`   Address: ${jobData.address}`);
    console.log(`   Source: ${jobData.source || 'website'}`);
    console.log(`   UserId: ${jobData.userId || 'N/A'}`);
    console.log(`   UserEmail: ${jobData.userEmail || 'N/A'}`);

    // Get job queue instance
    const jobQueue = getJobQueue();

    // Process job using the HTTP-triggered method
    // This will handle the job processing WITHOUT Redis Stream acknowledgment
    await jobQueue.processJobFromPubSub(jobData, pubsubMessageId);

    const duration = Date.now() - startTime;
    console.log(`✅ Job ${jobData.jobId} processing completed in ${duration}ms`);

    // Return 200 OK to acknowledge the message
    // Pub/Sub will consider the message successfully processed
    return NextResponse.json({
      success: true,
      jobId: jobData.jobId,
      messageId: pubsubMessageId,
      duration
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ Error processing Pub/Sub message (${duration}ms):`, error);

    // Return 500 to trigger Pub/Sub retry
    // Pub/Sub will automatically retry this message based on subscription config
    return NextResponse.json(
      {
        error: 'Job processing failed',
        message: error?.message || String(error),
        duration
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for health check / debugging
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/worker/process',
    purpose: 'Receive Pub/Sub push messages for job processing',
    status: 'ready',
    timestamp: new Date().toISOString()
  });
}
