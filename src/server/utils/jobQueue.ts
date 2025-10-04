// Job Queue with Redis Streams for async processing
import { getRedisCache } from './redisCache';
import { ComprehensiveComparableSearchV5 } from '../comprehensive-comp-search-v5';
import { randomUUID } from 'crypto';
import os from 'os';

const STREAM = 'jobs';
const GROUP = 'workers';
const MIN_IDLE_MS = 900_000; // 15 minutes
const MAX_ATTEMPTS = 3;
const JOB_TTL = 3600; // 1 hour

// Get unique consumer ID per container
const CONSUMER = `${os.hostname()}:${process.pid}`;

interface JobData {
  jobId: string;
  address: string;
  userId?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  phase: string;
  result?: any;
  error?: string;
  attempts: number;
  createdAt: number;
  lastHeartbeat: number;
  completedAt?: number;
}

export class JobQueue {
  private redis = getRedisCache();
  private analysisService: ComprehensiveComparableSearchV5;
  private isProcessing = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reclaimInterval: NodeJS.Timeout | null = null;
  private shouldRestart = false;

  constructor() {
    this.analysisService = new ComprehensiveComparableSearchV5();

    // Register reconnect callback to restart worker
    this.redis.onReconnect(() => {
      if (this.shouldRestart && !this.isProcessing) {
        console.log('♻️  Redis reconnected, restarting worker...');
        this.processJobs().catch((error) => {
          console.error('❌ Worker restart failed:', error);
        });
      }
    });
  }

  /**
   * Initialize stream and consumer group
   */
  async initialize(): Promise<void> {
    // Ensure Redis is connected before operations
    await this.redis.ensureConnected();
    await this.redis.xgroupCreate(STREAM, GROUP, '$');
    console.log(`✅ Job queue initialized: stream=${STREAM}, group=${GROUP}, consumer=${CONSUMER}`);
  }

  /**
   * Enqueue a new job
   */
  async enqueueJob(address: string, userId?: string): Promise<string> {
    const jobId = randomUUID();
    const now = Date.now();

    const jobData: JobData = {
      jobId,
      address,
      userId,
      status: 'queued',
      progress: 0,
      phase: 'Queued',
      attempts: 0,
      createdAt: now,
      lastHeartbeat: now
    };

    // Store job status in Redis hash
    await this.redis.setJob(jobId, jobData, JOB_TTL);

    // Add to stream
    const streamId = await this.redis.xadd(STREAM, {
      jobId,
      address,
      userId: userId || '',
      createdAt: now.toString()
    });

    if (!streamId) {
      throw new Error('Failed to enqueue job');
    }

    console.log(`📋 Job ${jobId} enqueued for address: ${address}`);
    return jobId;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<JobData | null> {
    return await this.redis.getJob(jobId);
  }

  /**
   * Update job data
   */
  private async updateJob(jobId: string, updates: Partial<JobData>): Promise<void> {
    const job = await this.getJobStatus(jobId);
    if (job) {
      const updated = { ...job, ...updates, lastHeartbeat: Date.now() };
      await this.redis.setJob(jobId, updated, JOB_TTL);
    }
  }

  /**
   * Process jobs from stream (main worker loop)
   */
  async processJobs(): Promise<void> {
    if (this.isProcessing) {
      console.warn('⚠️  Worker already running');
      return;
    }

    await this.initialize();
    this.isProcessing = true;
    this.shouldRestart = true; // Mark that worker should restart if Redis reconnects

    // Start heartbeat reaper (reclaim stuck jobs)
    this.startReaper();

    console.log(`🔄 Worker started: ${CONSUMER}`);

    try {
      while (this.isProcessing) {
        // Reduced block timeout from 15s to 5s for better connection stability
        const messages = await this.redis.xreadGroup(GROUP, CONSUMER, STREAM, 10, 5000);

        if (!messages || messages.length === 0) {
          console.log('⏱️  No messages received (timeout or empty queue)');
          continue;
        }

        console.log(`📬 Received ${messages.length} stream(s) with messages`);

        for (const streamData of messages) {
          if (!streamData || !Array.isArray(streamData) || streamData.length < 2) {
            continue;
          }

          const messagesArray = streamData[1];
          if (!Array.isArray(messagesArray)) {
            continue;
          }

          for (const message of messagesArray) {
            if (!Array.isArray(message) || message.length < 2) {
              continue;
            }

            const [messageId, fields] = message;
            const jobData = this.parseStreamMessage(fields);

            if (!jobData || !jobData.jobId) {
              console.error('❌ Invalid job data:', fields);
              await this.redis.xack(STREAM, GROUP, messageId);
              continue;
            }

            try {
              await this.processJob(jobData.jobId, jobData.address, messageId);
            } catch (error: any) {
              await this.handleJobFailure(jobData.jobId, error, messageId);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Worker error:', error);
      this.isProcessing = false;
    }
  }

  /**
   * Parse stream message to job data
   */
  private parseStreamMessage(fields: any): { jobId: string; address: string; userId?: string } | null {
    if (Array.isArray(fields)) {
      const obj: any = {};
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }
      return obj;
    }
    return fields;
  }

  /**
   * Process a single job
   */
  private async processJob(jobId: string, address: string, messageId: string): Promise<void> {
    console.log(`⚙️  Processing job ${jobId}: ${address}`);

    // Update status to processing
    await this.updateJob(jobId, {
      status: 'processing',
      phase: 'Getting subject details',
      progress: 10
    });

    // Start heartbeat
    const heartbeat = setInterval(async () => {
      await this.updateJob(jobId, { lastHeartbeat: Date.now() });
    }, 10000);

    try {
      // Run analysis
      const result = await this.analysisService.findComparables(address);

      // Mark complete
      await this.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        phase: 'Complete',
        result: {
          subject: result.subject,
          arv: result.arv,
          twoBathArv: result.twoBathARV,
          bathroomAnalysis: result.bathroomAnalysis,
          renovationAnalysis: result.renovation_analysis,
          compsUsed: result.qualified_comps,
          allComps: result.all_comps,
          confidenceScores: Object.fromEntries(result.consistency_scores.entries()),
          searchMetadata: result.searchMetadata
        },
        completedAt: Date.now()
      });

      // Acknowledge message
      await this.redis.xack(STREAM, GROUP, messageId);

      clearInterval(heartbeat);
      console.log(`✅ Job ${jobId} completed`);

    } catch (error: any) {
      clearInterval(heartbeat);
      throw error;
    }
  }

  /**
   * Handle job failure with retry logic
   */
  private async handleJobFailure(jobId: string, error: any, messageId: string): Promise<void> {
    const job = await this.getJobStatus(jobId);
    if (!job) {
      await this.redis.xack(STREAM, GROUP, messageId);
      return;
    }

    const attempts = (job.attempts || 0) + 1;
    const errorMessage = error?.message || String(error);

    console.error(`❌ Job ${jobId} failed (attempt ${attempts}/${MAX_ATTEMPTS}):`, errorMessage);

    if (attempts >= MAX_ATTEMPTS) {
      // Max retries reached - mark as failed and move to DLQ
      await this.updateJob(jobId, {
        status: 'failed',
        error: errorMessage,
        attempts,
        completedAt: Date.now()
      });

      // Add to dead letter queue
      await this.redis.xadd('jobs:dlq', {
        jobId,
        address: job.address,
        error: errorMessage,
        attempts: attempts.toString(),
        failedAt: Date.now().toString()
      });

      // Acknowledge to remove from processing
      await this.redis.xack(STREAM, GROUP, messageId);
      console.log(`💀 Job ${jobId} moved to DLQ after ${attempts} attempts`);
    } else {
      // Will be retried - update attempts but don't ACK
      await this.updateJob(jobId, {
        attempts,
        error: errorMessage
      });
      console.log(`🔄 Job ${jobId} will be retried (attempt ${attempts}/${MAX_ATTEMPTS})`);
    }
  }

  /**
   * Start background reaper to reclaim stuck jobs
   */
  private startReaper(): void {
    this.reclaimInterval = setInterval(async () => {
      try {
        let cursor = '0-0';
        do {
          const [nextCursor, claimed] = await this.redis.xautoclaim(
            STREAM,
            GROUP,
            CONSUMER,
            MIN_IDLE_MS,
            cursor,
            50
          );

          cursor = nextCursor;

          if (claimed && claimed.length > 0) {
            console.log(`♻️  Reclaimed ${claimed.length} stuck jobs`);

            for (const message of claimed) {
              if (!Array.isArray(message) || message.length < 2) {
                continue;
              }

              const [messageId, fields] = message;
              const jobData = this.parseStreamMessage(fields);

              if (jobData && jobData.jobId) {
                try {
                  await this.processJob(jobData.jobId, jobData.address, messageId);
                } catch (error: any) {
                  await this.handleJobFailure(jobData.jobId, error, messageId);
                }
              }
            }
          }
        } while (cursor !== '0-0');
      } catch (error) {
        console.error('❌ Reaper error:', error);
      }
    }, 15000); // Run every 15 seconds
  }

  /**
   * Stop processing (graceful shutdown)
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping worker...');
    this.isProcessing = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.reclaimInterval) {
      clearInterval(this.reclaimInterval);
    }

    console.log('✅ Worker stopped');
  }
}

// Singleton instance
let jobQueueInstance: JobQueue | null = null;

export function getJobQueue(): JobQueue {
  if (!jobQueueInstance) {
    jobQueueInstance = new JobQueue();
  }
  return jobQueueInstance;
}
