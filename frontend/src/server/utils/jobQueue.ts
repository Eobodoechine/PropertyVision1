// Job Queue with Redis Streams for async processing
import { getRedisCache } from './redisCache';
import { ComprehensiveComparableSearchV5 } from '../comprehensive-comp-search-v5';
import { ComprehensiveComparableSearchV10 } from '../comprehensive-comp-search-v10';
import { parallelSearchConfig } from './parallelSearchConfig';
import { sendErrorNotification, sendSuccessNotification } from './emailNotification';
import { GoogleMapsGeocoder } from './googleMapsGeocoder';
import { randomUUID } from 'crypto';
import os from 'os';

const STREAM = 'jobs';
const GROUP = 'workers';
const HEARTBEAT_MS = 7_000; // 7 seconds
const MIN_IDLE_MS = 12_000; // 12 seconds (for crash recovery)
const MAX_ATTEMPTS = 1; // Fast failure detection - maximizes speed + error handling
const JOB_TTL = 3600; // 1 hour

// Get unique consumer ID per container
const CONSUMER = `${os.hostname()}:${process.pid}`;

interface JobData {
  jobId: string;
  address: string;
  userId?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  phase: string;
  phaseMessage?: string; // User-friendly message for current phase
  estimatedTimeRemaining?: number; // Seconds remaining (estimated)
  phaseStartTime?: number; // Timestamp when current phase started (for real ETA calculation)
  result?: any;
  error?: string;
  attempts: number;
  createdAt: number;
  lastHeartbeat: number;
  completedAt?: number;
  processingBy?: string; // Track which worker is processing this job
  processingMessageId?: string; // Track which stream message is being processed (prevents same consumer re-processing)
  cancelRequested?: boolean; // User requested cancellation
}

// Phase definitions with progress ranges and estimated durations (V10 parallel search)
// Total allocated: 300 seconds (VPC grounded searches are slow)
export const PHASES = {
  QUEUED: { name: 'Queued', progress: 0, message: 'Waiting to start analysis...', estimatedSeconds: 5 },
  SUBJECT_PROPERTY: { name: 'Subject Property Research', progress: 10, message: 'Fetching property details from public records...', estimatedSeconds: 60 }, // VPC grounded search (primary + county)
  COMPARABLE_SEARCH_L1: { name: 'Parallel Comparable Search', progress: 30, message: 'Running parallel comparable search (Levels 1-4)...', estimatedSeconds: 180 }, // VPC parallel grounded searches across 4 levels
  COMPARABLE_SEARCH_L2: { name: 'Parallel Comparable Search', progress: 30, message: 'Running parallel comparable search (Levels 1-4)...', estimatedSeconds: 0 }, // Hidden - runs in parallel with L1
  COMPARABLE_SEARCH_L3: { name: 'Parallel Comparable Search', progress: 30, message: 'Running parallel comparable search (Levels 1-4)...', estimatedSeconds: 0 }, // Hidden - runs in parallel with L1
  COMPARABLE_SEARCH_L4: { name: 'Parallel Comparable Search', progress: 30, message: 'Running parallel comparable search (Levels 1-4)...', estimatedSeconds: 0 }, // Hidden - runs in parallel with L1
  DEDUPLICATION: { name: 'Deduplication', progress: 60, message: 'Removing duplicate listings...', estimatedSeconds: 40 },
  ARV_CALCULATION: { name: 'ARV Calculation', progress: 75, message: 'Calculating After Repair Value...', estimatedSeconds: 10 },
  FINALIZING: { name: 'Finalizing', progress: 90, message: 'Preparing your analysis report...', estimatedSeconds: 5 },
  COMPLETED: { name: 'Completed', progress: 100, message: 'Analysis complete! 🎉', estimatedSeconds: 0 }
} as const;

// Global job context - allows comprehensive-comp-search to update progress
let currentJobContext: { jobId: string; jobQueue: JobQueue } | null = null;

// Helper function to update progress from anywhere (e.g., comprehensive-comp-search)
export async function updateJobProgress(phaseKey: keyof typeof PHASES): Promise<void> {
  if (!currentJobContext) return;
  await currentJobContext.jobQueue.updateProgress(currentJobContext.jobId, phaseKey);
}

// Helper function to check if job is cancelled
export async function isJobCancelled(): Promise<boolean> {
  if (!currentJobContext) return false;
  const job = await currentJobContext.jobQueue.getJobStatus(currentJobContext.jobId);
  return job?.cancelRequested === true;
}

export class JobQueue {
  private redis = getRedisCache();
  private analysisService: ComprehensiveComparableSearchV5 | ComprehensiveComparableSearchV10;
  private isProcessing = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reclaimInterval: NodeJS.Timeout | null = null;
  private shouldRestart = false;

  constructor() {
    // Use V10 if parallel search is enabled, otherwise V5
    const useV10 = parallelSearchConfig.enabled;
    this.analysisService = useV10
      ? new ComprehensiveComparableSearchV10()
      : new ComprehensiveComparableSearchV5();

    console.log(`✅ JobQueue initialized with ${useV10 ? 'V10 (Parallel Search)' : 'V5 (Sequential Search)'}`);

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
   * Update job progress with phase information and estimated time
   */
  async updateProgress(jobId: string, phaseKey: keyof typeof PHASES): Promise<void> {
    const phase = PHASES[phaseKey];
    const job = await this.getJobStatus(jobId);
    if (!job) return;

    const now = Date.now();

    // Calculate countdown: total max time minus sum of previous phases' allocated times
    const TOTAL_MAX_TIME = 300; // Total max time in seconds
    const phaseOrder: (keyof typeof PHASES)[] = [
      'QUEUED', 'SUBJECT_PROPERTY', 'COMPARABLE_SEARCH_L1',
      'DEDUPLICATION', 'ARV_CALCULATION', 'FINALIZING', 'COMPLETED'
    ];

    const currentPhaseIndex = phaseOrder.indexOf(phaseKey);
    const allocatedTimeConsumed = phaseOrder
      .slice(0, currentPhaseIndex)
      .reduce((sum, key) => sum + PHASES[key].estimatedSeconds, 0);

    const countdownRemaining = TOTAL_MAX_TIME - allocatedTimeConsumed;

    // If we're running over time, update the message to reflect that
    const phaseMessage = countdownRemaining <= 0
      ? `${phase.message} (Taking a bit longer than usual...)`
      : phase.message;

    // Store phase start time for real ETA calculation
    await this.updateJob(jobId, {
      progress: phase.progress,
      phase: phase.name,
      phaseMessage,
      estimatedTimeRemaining: Math.max(0, countdownRemaining),
      phaseStartTime: now
    });
  }

  /**
   * Request job cancellation
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJobStatus(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed') {
      return false; // Can't cancel completed jobs
    }

    await this.updateJob(jobId, {
      cancelRequested: true,
      phaseMessage: 'Cancellation requested...'
    });

    console.log(`🚫 Cancellation requested for job ${jobId}`);
    return true;
  }

  /**
   * Update job data
   */
  private async updateJob(jobId: string, updates: Partial<JobData>): Promise<void> {
    // Only log if it's more than just a heartbeat update
    const isHeartbeatOnly = Object.keys(updates).length === 1 && 'lastHeartbeat' in updates;
    if (!isHeartbeatOnly) {
      console.log(`💾 Updating job ${jobId} with:`, JSON.stringify(updates).substring(0, 200));
    }

    const job = await this.getJobStatus(jobId);
    if (job) {
      const updated = { ...job, ...updates, lastHeartbeat: Date.now() };
      await this.redis.setJob(jobId, updated, JOB_TTL);
      if (!isHeartbeatOnly) {
        console.log(`✅ Job ${jobId} saved to Redis: status=${updated.status}, progress=${updated.progress}`);
      }
    } else {
      console.error(`❌ CRITICAL: Job ${jobId} not found in Redis during updateJob! Creating new entry.`);
      const newJob = {
        jobId,
        ...updates,
        lastHeartbeat: Date.now(),
        createdAt: updates.createdAt || Date.now()
      };
      await this.redis.setJob(jobId, newJob, JOB_TTL);
      console.log(`✅ Job ${jobId} created in Redis: status=${newJob.status}, progress=${newJob.progress}`);
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
    // Import trace context helpers
    const { updateTraceContext } = await import('./logger');

    // Set trace context for this job (propagates to all console.log calls)
    updateTraceContext({
      jobId,
      address,
      traceId: jobId // Use jobId as traceId for worker jobs
    });

    console.log(`⚙️  [${messageId}] Processing job ${jobId}: ${address}`);

    // Check if job is already being processed (use message ID for same-consumer detection)
    const existingJob = await this.getJobStatus(jobId);

    // Skip jobs that are already completed or failed
    if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'failed')) {
      console.log(`✅ [${messageId}] Job ${jobId} already ${existingJob.status}, acknowledging and skipping`);
      await this.redis.xack(STREAM, GROUP, messageId);
      return;
    }

    if (existingJob && existingJob.status === 'processing') {
      console.log(`🔍 [${messageId}] Job ${jobId} status=${existingJob.status}, messageId=${existingJob.processingMessageId || 'none'}`);

      // ALWAYS check heartbeat when job is processing (even if same message ID - handles XAUTOCLAIM reclaims)
      const timeSinceHeartbeat = Date.now() - (existingJob.lastHeartbeat || 0);
      console.log(`🔍 [${messageId}] Heartbeat age: ${Math.round(timeSinceHeartbeat / 1000)}s`);

      if (timeSinceHeartbeat < 60000) { // If heartbeat within last 60 seconds, job is still active
        console.warn(`⚠️  [${messageId}] Job ${jobId} still active (heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago), skipping XAUTOCLAIM reclaim`);
        await this.redis.xack(STREAM, GROUP, messageId); // Acknowledge to prevent re-processing
        return;
      }
      console.log(`⏰ [${messageId}] Job ${jobId} heartbeat stale (${Math.round(timeSinceHeartbeat / 1000)}s), taking over`);
    } else {
      console.log(`🔍 [${messageId}] Job ${jobId} not currently processing (status: ${existingJob?.status || 'none'})`);
    }

    // Update status to processing and claim ownership with message ID
    console.log(`📝 [${messageId}] Claiming ownership of job ${jobId}`);
    await this.updateJob(jobId, {
      status: 'processing',
      phase: 'Getting subject details',
      progress: 10,
      processingBy: CONSUMER,
      processingMessageId: messageId
    });

    // Set global job context for progress updates
    currentJobContext = { jobId, jobQueue: this };

    // Start heartbeat
    const heartbeat = setInterval(async () => {
      await this.updateJob(jobId, { lastHeartbeat: Date.now() });
    }, HEARTBEAT_MS);

    try {
      // **FAST-FAIL: Early geocode validation**
      // Validate address can be geocoded before running expensive Vertex searches
      // Invalid addresses like "333" will fail here in ~10s instead of ~4 minutes
      console.log(`🗺️  [${messageId}] Validating address via geocoding: ${address}`);
      const geocodeStart = Date.now();

      // Use GoogleMapsGeocoder for address validation (works with both V5 and V10)
      try {
        const geocoder = new GoogleMapsGeocoder();
        const result = await geocoder.geocodeAddress(address);
        const geocodeDuration = Date.now() - geocodeStart;

        if (!result || !result.lat || !result.lng) {
          console.error(`❌ [${messageId}] Address geocoding failed in ${geocodeDuration}ms - invalid address`);
          throw new Error(`Invalid address: could not geocode "${address}"`);
        }

        console.log(`✅ [${messageId}] Address validated via geocoding in ${geocodeDuration}ms: ${result.lat}, ${result.lng}`);
      } catch (error) {
        const geocodeDuration = Date.now() - geocodeStart;
        console.error(`❌ [${messageId}] Geocoder initialization or geocoding failed in ${geocodeDuration}ms:`);
        console.error(`   Error type: ${typeof error}`);
        console.error(`   Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`   Error stack:`, error instanceof Error ? error.stack : 'N/A');
        throw new Error(`Invalid address: could not geocode "${address}"${error instanceof Error ? ` - ${error.message}` : ''}`);
      }

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
      currentJobContext = null; // Clear job context
      console.log(`✅ Job ${jobId} completed`);

      // Validate ARV before sending success notification
      const completedAt = Date.now();
      const duration = completedAt - (existingJob?.createdAt || Date.now());

      // Handle both V10 (result.arv?.estimate) and V5 (result.arv?.conservative?.arv_price) structures
      const arvValue = result.arv?.estimate || (result.arv as any)?.conservative?.arv_price;
      const compsCount = result.qualified_comps?.length || 0;

      // ARV=$0 or 0 comps is a failed run, not a success
      if (!arvValue || arvValue === 0 || compsCount === 0) {
        const errorMessage = !arvValue || arvValue === 0
          ? `ARV unavailable (ARV=$${arvValue || 0}, comps=${compsCount})`
          : `No comparable properties found (comps=${compsCount})`;

        console.error(`❌ Job ${jobId} completed but failed validation: ${errorMessage}`);

        // Send error notification instead of success
        await sendErrorNotification({
          jobId,
          address,
          error: errorMessage,
          phase: 'ARV Calculation',
          attempts: 1,
          timestamp: completedAt,
          userId: existingJob?.userId
        });

        // Mark job as failed
        await this.updateJob(jobId, {
          status: 'failed',
          error: errorMessage,
          completedAt
        });

        // Acknowledge message to remove from queue
        await this.redis.xack(STREAM, GROUP, messageId);
        clearInterval(heartbeat);
        currentJobContext = null;
        return;
      }

      // Send success notification email
      await sendSuccessNotification({
        jobId,
        address,
        arv: arvValue,
        compsCount,
        duration,
        timestamp: completedAt,
        userId: existingJob?.userId
      });

    } catch (error: any) {
      clearInterval(heartbeat);
      currentJobContext = null; // Clear job context
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

      // Send error notification email
      await sendErrorNotification({
        jobId,
        address: job.address,
        error: errorMessage,
        phase: job.phase,
        attempts,
        timestamp: Date.now(),
        userId: job.userId
      });

      // Acknowledge to remove from processing
      await this.redis.xack(STREAM, GROUP, messageId);
      console.log(`💀 Job ${jobId} moved to DLQ after ${attempts} attempts`);
    } else {
      // Instant retry - acknowledge current message and re-add to stream immediately
      await this.updateJob(jobId, {
        status: 'queued',
        attempts,
        error: errorMessage,
        processingBy: undefined,
        processingMessageId: undefined
      });

      // ACK the current message
      await this.redis.xack(STREAM, GROUP, messageId);

      // Immediately re-add to stream for instant retry (don't wait for XAUTOCLAIM)
      await this.redis.xadd(STREAM, {
        jobId,
        address: job.address,
        userId: job.userId || '',
        attempts: attempts.toString(),
        createdAt: Date.now().toString()
      });

      console.log(`🔄 Job ${jobId} retried immediately (attempt ${attempts}/${MAX_ATTEMPTS})`);
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
                // Check if job has exceeded max attempts
                const job = await this.getJobStatus(jobData.jobId);
                if (job && (job.attempts || 0) >= MAX_ATTEMPTS) {
                  console.warn(`⚠️  Job ${jobData.jobId} exceeded max attempts (${job.attempts}), moving to DLQ`);
                  await this.handleJobFailure(jobData.jobId, new Error('Max reclaim attempts exceeded'), messageId);
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
