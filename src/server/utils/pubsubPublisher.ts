import { PubSub } from '@google-cloud/pubsub';

const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'durable-ring-475417-g0';
const TOPIC_NAME = 'property-analysis-jobs';

let pubsubClient: PubSub | null = null;

/**
 * Get or create Pub/Sub client singleton
 */
function getPubSubClient(): PubSub {
  if (!pubsubClient) {
    pubsubClient = new PubSub({
      projectId: PROJECT_ID,
    });
    console.log(`📢 Pub/Sub client initialized for project: ${PROJECT_ID}`);
  }
  return pubsubClient;
}

/**
 * Job message data structure (matches Redis Stream format)
 */
export interface JobMessage {
  jobId: string;
  address: string;
  userId?: string;
  userEmail?: string;
  source?: 'chatgpt' | 'website';
  createdAt: number;
}

/**
 * Publish a job message to Pub/Sub topic
 *
 * @param jobData - Job data to publish
 * @returns Promise<string> - Message ID assigned by Pub/Sub
 */
export async function publishJob(jobData: JobMessage): Promise<string> {
  const client = getPubSubClient();
  const topic = client.topic(TOPIC_NAME);

  // Convert job data to JSON buffer
  const messageBuffer = Buffer.from(JSON.stringify(jobData));

  // Add attributes for filtering/routing if needed
  const attributes = {
    jobId: jobData.jobId,
    source: jobData.source || 'website',
    timestamp: jobData.createdAt.toString(),
  };

  try {
    // Publish message
    const messageId = await topic.publishMessage({
      data: messageBuffer,
      attributes,
    });

    console.log(`📢 Published job ${jobData.jobId} to Pub/Sub (messageId: ${messageId})`);
    return messageId;
  } catch (error) {
    console.error(`❌ Failed to publish job ${jobData.jobId} to Pub/Sub:`, error);
    throw error;
  }
}

/**
 * Parse Pub/Sub message received from push subscription
 *
 * @param message - Pub/Sub push message
 * @returns JobMessage - Parsed job data
 */
export function parsePubSubMessage(message: any): JobMessage {
  // Pub/Sub push messages have this structure:
  // {
  //   message: {
  //     data: "base64-encoded-json",
  //     attributes: { ... },
  //     messageId: "...",
  //     publishTime: "..."
  //   },
  //   subscription: "..."
  // }

  if (!message || !message.data) {
    throw new Error('Invalid Pub/Sub message format');
  }

  // Decode base64 data
  const dataBuffer = Buffer.from(message.data, 'base64');
  const jobData = JSON.parse(dataBuffer.toString('utf-8')) as JobMessage;

  return jobData;
}

/**
 * Validate Pub/Sub push request (optional security check)
 *
 * This can be enhanced with:
 * - JWT token verification
 * - Service account validation
 * - Request signature verification
 */
export function validatePubSubRequest(req: any): boolean {
  // Basic validation: check if request has Pub/Sub message structure
  if (!req.body || !req.body.message) {
    return false;
  }

  // Optional: Verify that request came from Google's Pub/Sub
  // const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith('Bearer ')) {
  //   return false;
  // }

  return true;
}

/**
 * Initialize Pub/Sub client on module load (optional)
 */
export function initializePubSub(): void {
  getPubSubClient();
}

export { getPubSubClient };
