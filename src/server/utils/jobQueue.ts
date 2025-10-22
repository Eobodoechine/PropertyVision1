// Job Queue with Redis Streams for async processing
import { getRedisCache } from './redisCache';
import { ComprehensiveComparableSearchV5 } from '../comprehensive-comp-search-v5';
import { ComprehensiveComparableSearchV10 } from '../comprehensive-comp-search-v10';
import { parallelSearchConfig } from './parallelSearchConfig';
import { sendErrorNotification, sendSuccessNotification } from './emailNotification';
import { GoogleMapsGeocoder } from './googleMapsGeocoder';
import { publishJob } from './pubsubPublisher';
import { randomUUID } from 'crypto';
import os from 'os';
import { jobLog, setJobContext, runWithJobContext } from './jobLogger';
import { setCurrentJobContext, PHASES as JOB_PHASES } from './jobProgress';

// Global job context - allows comprehensive-comp-search to update progress
// Initialized immediately to avoid Temporal Dead Zone issues during module imports

const STREAM = 'jobs';
const GROUP = 'workers';
const HEARTBEAT_MS = 7_000; // 7 seconds
const MIN_IDLE_MS = 12_000; // 12 seconds (for crash recovery)
const MAX_ATTEMPTS = 1; // Fast failure detection - maximizes speed + error handling
const JOB_TTL = 3600; // 1 hour (processing)
const JOB_TTL_TERMINAL = 86400; // 24 hours (completed/cancelled)
const JOB_TTL_FAILED_SHORT = 21600; // 6 hours (failed)
const MAX_REDIS_RETRIES = 8;
const MAX_HEARTBEAT_FAILURES = 3;
const HEARTBEAT_STALE_MS = HEARTBEAT_MS * 3; // 21 seconds
const PROGRESS_STALE_MS = HEARTBEAT_MS * 5; // 35 seconds
const MAX_RESULT_BYTES = 2_000_000; // 2MB cap

// Get unique consumer ID per container
const CONSUMER = `${os.hostname()}:${process.pid}`;

// Helper functions
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isTerminalStatus = (status: string) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

// State machine transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'queued': ['processing', 'cancelled'],
  'processing': ['processing', 'completed', 'failed', 'cancelled'],
  'completed': [], // Terminal
  'failed': [],    // Terminal
  'cancelled': []  // Terminal
};

interface JobData {
  jobId: string;
  address: string;
  userId?: string;
  userEmail?: string; // User's email for tracking and notifications
  source?: 'chatgpt' | 'website'; // Source of the analysis
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
  lastProgressAt?: number;        // Track actual work progress
  updatedAt?: number;              // Last modification time
  version?: number;                // Monotonic version counter
  finalized?: boolean;             // One-way completion flag
  finishedBy?: string;             // Which worker finalized
  completedAt?: number;
  processingBy?: string; // Track which worker is processing this job
  processingMessageId?: string; // Track which stream message is being processed (prevents same consumer re-processing)
  cancelRequested?: boolean; // User requested cancellation
}



// Helper function to check if job is cancelled

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

    jobLog(`✅ JobQueue initialized with ${useV10 ? 'V10 (Parallel Search)' : 'V5 (Sequential Search)'}`);

    // Register reconnect callback to restart worker
    this.redis.onReconnect(() => {
      if (this.shouldRestart && !this.isProcessing) {
        jobLog('♻️  Redis reconnected, restarting worker...');
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
    jobLog(`✅ Job queue initialized: stream=${STREAM}, group=${GROUP}, consumer=${CONSUMER}`);
  }

  /**
   * Enqueue a new job
   */
  async enqueueJob(
    address: string,
    userId?: string,
    userEmail?: string,
    source?: 'chatgpt' | 'website'
  ): Promise<string> {
    const jobId = randomUUID();
    const now = Date.now();

    // Determine userEmail: use explicit param, or extract from userId if it's an email
    const finalUserEmail = userEmail || (userId && userId.includes('@') ? userId : undefined);

    const jobData: JobData = {
      jobId,
      address,
      userId,
      userEmail: finalUserEmail,
      source: source || 'website',
      status: 'queued',
      progress: 0,
      phase: 'Queued',
      attempts: 0,
      createdAt: now,
      lastHeartbeat: now
    };

    // Store job status in Redis hash
    await this.redis.setJob(jobId, jobData, JOB_TTL);

    jobLog(`📋 Job ${jobId} created for address: ${address} (email: ${finalUserEmail || 'none'}, source: ${source || 'website'})`);

    // Publish to Pub/Sub (primary queue mechanism)
    try {
      await publishJob({
        jobId,
        address,
        userId,
        userEmail: finalUserEmail,
        source: source || 'website',
        createdAt: now
      });
      jobLog(`📢 Job ${jobId} published to Pub/Sub`);
    } catch (error) {
      console.error(`❌ Failed to publish job ${jobId} to Pub/Sub:`, error);
      throw new Error(`Failed to enqueue job to Pub/Sub: ${error instanceof Error ? error.message : String(error)}`);
    }

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
  async updateProgress(jobId: string, phaseKey: keyof typeof JOB_PHASES): Promise<void> {
    const phase = JOB_PHASES[phaseKey];
    const job = await this.getJobStatus(jobId);
    if (!job) return;

    const now = Date.now();

    // Calculate countdown: total max time minus sum of previous phases' allocated times
    const TOTAL_MAX_TIME = 300; // Total max time in seconds
    const phaseOrder: (keyof typeof JOB_PHASES)[] = [
      'QUEUED', 'SUBJECT_PROPERTY', 'COMPARABLE_SEARCH_L1',
      'DEDUPLICATION', 'ARV_CALCULATION', 'FINALIZING', 'COMPLETED'
    ];

    const currentPhaseIndex = phaseOrder.indexOf(phaseKey);
    const allocatedTimeConsumed = phaseOrder
      .slice(0, currentPhaseIndex)
      .reduce((sum, key) => sum + JOB_PHASES[key].estimatedSeconds, 0);

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

    jobLog(`🚫 Cancellation requested for job ${jobId}`);
    return true;
  }

  /**
   * updateHeartbeatOnly - Field-level heartbeat update
   *
   * ONLY touches lastHeartbeat, updatedAt, version.
   * Does NOT modify status, progress, phase, result, error.
   */
  private async updateHeartbeatOnly(
    jobId: string,
    leaseOwner: string
  ): Promise<boolean> {
    const result = await this.redis.atomicUpdateJob(jobId, (cur) => {
      if (!cur) return null; // Job doesn't exist

      // Terminal state protection - don't touch completed/failed/cancelled jobs
      if (isTerminalStatus(cur.status)) {
        return null;
      }

      // Finalized guard - don't touch finalized jobs (hardening)
      if (cur.finalized) {
        return null;
      }

      // Cancellation respect - no-op if user cancelled (diagnostic logging)
      if (cur.cancelRequested) {
        jobLog(`📋 Heartbeat skipped for cancelled job ${jobId}`);
        return null;
      }

      // Ownership check - reject if wrong owner
      if (cur.processingBy && cur.processingBy !== leaseOwner) {
        return null;
      }

      const now = Date.now();

      // Field-level update - ONLY heartbeat fields
      return {
        ...cur,
        lastHeartbeat: now,
        updatedAt: now,
        version: (cur.version || 0) + 1
      };
    });

    return result.success;
  }

  /**
   * startHeartbeat - Self-scheduling heartbeat loop
   *
   * Prevents reentrancy using async while loop instead of setInterval.
   * Returns a stop function to call BEFORE writing completion status.
   */
  private startHeartbeat(jobId: string, leaseOwner: string): () => void {
    let running = true;
    let consecutiveFailures = 0;

    // Self-scheduling async loop (prevents reentrancy)
    (async () => {
      // Fire first heartbeat immediately
      try {
        await this.updateHeartbeatOnly(jobId, leaseOwner);
      } catch (error) {
        jobLog(`⚠️  Initial heartbeat failed for ${jobId}:`, (error as any)?.message);
      }

      // Then start periodic heartbeat loop
      while (running) {
        await new Promise(resolve => setTimeout(resolve, HEARTBEAT_MS));

        if (!running) break; // Exit if stopped

        try {
          const success = await this.updateHeartbeatOnly(jobId, leaseOwner);

          if (success) {
            consecutiveFailures = 0; // Reset on success
          } else {
            consecutiveFailures++;
            jobLog(`⚠️  Heartbeat failed for ${jobId} (${consecutiveFailures}/${MAX_HEARTBEAT_FAILURES})`);

            // Stop after max failures
            if (consecutiveFailures >= MAX_HEARTBEAT_FAILURES) {
              jobLog(`🛑 Heartbeat stopped for ${jobId} after ${MAX_HEARTBEAT_FAILURES} failures`);
              running = false;

              // Best-effort diagnostic breadcrumb for ops
              try {
                await this.updateJob(jobId, {
                  phaseMessage: '⚠️ Heartbeat stopped (worker errors)'
                }, leaseOwner);
              } catch {
                // Best effort - don't throw if this fails
              }
            }
          }
        } catch (error) {
          consecutiveFailures++;
          jobLog(`❌ Heartbeat error for ${jobId}:`, (error as any)?.message);

          if (consecutiveFailures >= MAX_HEARTBEAT_FAILURES) {
            jobLog(`🛑 Heartbeat stopped for ${jobId} after ${MAX_HEARTBEAT_FAILURES} errors`);
            running = false;

            // Best-effort diagnostic breadcrumb
            try {
              await this.updateJob(jobId, {
                phaseMessage: '⚠️ Heartbeat stopped (worker errors)'
              }, leaseOwner);
            } catch {
              // Best effort
            }
          }
        }
      }
    })();

    // Return stop function
    return () => {
      running = false;
    };
  }

  /**
   * Update job data with atomic WATCH/MULTI and all guards
   */
  private async updateJob(jobId: string, updates: Partial<JobData>, leaseOwner?: string): Promise<void> {
    // Strip undefined to prevent field deletion (v4 bug fix #11)
    const stripUndefined = <T extends object>(obj: T): Partial<T> => {
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
      ) as Partial<T>;
    };

    const cleanedUpdates = stripUndefined(updates);

    const result = await this.redis.atomicUpdateJob(jobId, (cur) => {
      if (!cur) {
        // Job creation path - require address
        if (!cleanedUpdates.address) {
          jobLog(`❌ Cannot create job ${jobId} without address`);
          return null;
        }

        const now = Date.now();
        return {
          jobId,
          address: cleanedUpdates.address,
          status: cleanedUpdates.status ?? 'queued',
          progress: clamp(cleanedUpdates.progress ?? 0, 0, 100),
          phase: cleanedUpdates.phase ?? 'Initializing',
          phaseStartTime: cleanedUpdates.phaseStartTime ?? now,
          lastProgressAt: now,
          createdAt: cleanedUpdates.createdAt ?? now,
          lastHeartbeat: now,
          updatedAt: now,
          version: 1,
          attempts: cleanedUpdates.attempts ?? 0,
          userId: cleanedUpdates.userId,
          userEmail: cleanedUpdates.userEmail,
          source: cleanedUpdates.source,
          processingBy: cleanedUpdates.processingBy,
          processingMessageId: cleanedUpdates.processingMessageId,
          cancelRequested: cleanedUpdates.cancelRequested ?? false,
          result: cleanedUpdates.result,
          error: cleanedUpdates.error,
          finalized: false,
          completedAt: cleanedUpdates.completedAt
        };
      }

      // Terminal state protection (except finalization)
      if (isTerminalStatus(cur.status)) {
        const isFinalization = cleanedUpdates.finalized === true && !cur.finalized;
        if (!isFinalization) {
          return null;
        }
      }

      const now = Date.now();

      // Ownership enforcement with dual staleness reclaim
      let ownershipPatch: Partial<JobData> = {};

      if (leaseOwner && cur.processingBy && cur.processingBy !== leaseOwner) {
        const heartbeatAge = now - (cur.lastHeartbeat || 0);
        const progressAge = now - (cur.lastProgressAt || cur.updatedAt || 0);
        const heartbeatStale = heartbeatAge > HEARTBEAT_STALE_MS;
        const progressStale = progressAge > PROGRESS_STALE_MS;

        if (!heartbeatStale || !progressStale) {
          return null; // Current owner still active
        }

        jobLog(`🔄 Reclaiming stale job ${jobId} from ${cur.processingBy} to ${leaseOwner}`);
        ownershipPatch = {
          processingBy: leaseOwner,
          processingMessageId: leaseOwner.replace(/^pubsub:/, '')
        };
      } else if (leaseOwner && !cur.processingBy) {
        ownershipPatch = {
          processingBy: leaseOwner,
          processingMessageId: leaseOwner.replace(/^pubsub:/, '')
        };
      }

      // Authoritative status (v4 bug fix #8)
      let nextStatus = cur.status;
      if (cleanedUpdates.status !== undefined) {
        const allowedNext = ALLOWED_TRANSITIONS[cur.status] || [];
        nextStatus = allowedNext.includes(cleanedUpdates.status) ? cleanedUpdates.status : cur.status;
        if (nextStatus !== cleanedUpdates.status) {
          jobLog(`⚠️  Rejected invalid transition: ${cur.status} → ${cleanedUpdates.status}`);
        }
      }
      const isCompleting = nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'cancelled';

      // Authoritative progress with monotonicity (v4 bug fix #9)
      const incomingProgress =
        typeof cleanedUpdates.progress === 'number' ? clamp(cleanedUpdates.progress, 0, 100) : (cur.progress ?? 0);
      const nextProgress = Math.max(cur.progress ?? 0, incomingProgress);
      if (typeof cleanedUpdates.progress === 'number' && incomingProgress < (cur.progress ?? 0)) {
        jobLog(`⚠️  Rejected non-monotonic progress: ${(cur.progress ?? 0)} → ${incomingProgress}`);
      }
      const progressIncreased = nextProgress > (cur.progress ?? 0);

      // Progress normalization (v4 bug fix #10)
      const normalizedProgress =
        nextStatus === 'completed' ? 100 :
        nextStatus === 'failed' || nextStatus === 'cancelled' ? Math.min(nextProgress, 99) :
        nextProgress;

      // Phase tracking
      const phaseChanged = cleanedUpdates.phase !== undefined && cleanedUpdates.phase !== cur.phase;
      const phasePatch: Partial<JobData> = phaseChanged
        ? {
            phase: cleanedUpdates.phase,
            phaseStartTime: now,
            lastProgressAt: now
          }
        : cleanedUpdates.phase !== undefined
        ? { phase: cleanedUpdates.phase }
        : {};

      const progressTimePatch: Partial<JobData> = progressIncreased
        ? { lastProgressAt: now }
        : {};

      // Idempotent finalization
      const finalizationPatch: Partial<JobData> = (!cur.finalized && isCompleting)
        ? { finalized: true, finishedBy: leaseOwner || cur.processingBy || cur.finishedBy || 'unknown' }
        : (cleanedUpdates.finalized && !cur.finalized ? { finalized: true, finishedBy: leaseOwner || cur.processingBy || 'unknown' } : {});

      // Auto-set completedAt
      const completionPatch: Partial<JobData> =
        (nextStatus === 'completed' && !cur.completedAt) ? { completedAt: now } : {};

      // Result size guardrails
      if (cleanedUpdates.result) {
        const resultSize = JSON.stringify(cleanedUpdates.result).length;
        if (resultSize > 100000) {
          jobLog(`⚠️  Large result for job ${jobId}: ${(resultSize / 1024).toFixed(1)}KB`);
        }
      }

      // Result/state consistency validation (v4)
      if (cleanedUpdates.result && nextStatus !== 'completed') {
        jobLog(`⚠️  Result attached while status=${nextStatus} (job ${jobId})`);
      }

      // Conditional heartbeat update (v4 bug fix #3)
      const shouldTouchHeartbeat =
        !!leaseOwner || progressIncreased || phaseChanged || isCompleting;

      // Merge all patches with authoritative values
      const next: JobData = {
        ...cur,
        ...cleanedUpdates,
        ...ownershipPatch,
        ...phasePatch,
        ...progressTimePatch,
        ...finalizationPatch,
        ...completionPatch,
        ...(shouldTouchHeartbeat ? { lastHeartbeat: now } : {}),
        status: nextStatus,       // Authoritative
        progress: normalizedProgress,  // Authoritative + normalized
        updatedAt: now,
        version: (cur.version || 0) + 1
      };

      return next;
    });

    if (result.conflicts > 0) {
      jobLog(`⚙️  Job ${jobId} update had ${result.conflicts} conflicts (resolved via retry)`);
    }

    // Keep existing logging for non-heartbeat updates
    const isHeartbeatOnly = Object.keys(cleanedUpdates).length === 1 && 'lastHeartbeat' in cleanedUpdates;
    if (!isHeartbeatOnly && result.success) {
      jobLog(`✅ Job ${jobId} updated: status=${updates.status || 'unchanged'}, progress=${updates.progress ?? 'unchanged'}`);
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

    jobLog(`🔄 Worker started: ${CONSUMER}`);

    try {
      while (this.isProcessing) {
        // Reduced block timeout from 15s to 5s for better connection stability
        const messages = await this.redis.xreadGroup(GROUP, CONSUMER, STREAM, 10, 5000);

        if (!messages || messages.length === 0) {
          jobLog('⏱️  No messages received (timeout or empty queue)');
          continue;
        }

        jobLog(`📬 Received ${messages.length} stream(s) with messages`);

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
  private parseStreamMessage(fields: any): { jobId: string; address: string; userId?: string; userEmail?: string; source?: 'chatgpt' | 'website' } | null {
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
    // Set job context for logging (propagates jobId to all jobLog calls)
    setJobContext(jobId);

    jobLog(`⚙️  [${messageId}] Processing job ${jobId}: ${address}`);

    // Check if job is already being processed (use message ID for same-consumer detection)
    const existingJob = await this.getJobStatus(jobId);

    // Skip jobs that are already completed or failed
    if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'failed')) {
      jobLog(`✅ [${messageId}] Job ${jobId} already ${existingJob.status}, acknowledging and skipping`);
      await this.redis.xack(STREAM, GROUP, messageId);
      return;
    }

    if (existingJob && existingJob.status === 'processing') {
      jobLog(`🔍 [${messageId}] Job ${jobId} status=${existingJob.status}, messageId=${existingJob.processingMessageId || 'none'}`);

      // ALWAYS check heartbeat when job is processing (even if same message ID - handles XAUTOCLAIM reclaims)
      const timeSinceHeartbeat = Date.now() - (existingJob.lastHeartbeat || 0);
      jobLog(`🔍 [${messageId}] Heartbeat age: ${Math.round(timeSinceHeartbeat / 1000)}s`);

      if (timeSinceHeartbeat < 60000) { // If heartbeat within last 60 seconds, job is still active
        console.warn(`⚠️  [${messageId}] Job ${jobId} still active (heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago), skipping XAUTOCLAIM reclaim`);
        await this.redis.xack(STREAM, GROUP, messageId); // Acknowledge to prevent re-processing
        return;
      }
      jobLog(`⏰ [${messageId}] Job ${jobId} heartbeat stale (${Math.round(timeSinceHeartbeat / 1000)}s), taking over`);
    } else {
      jobLog(`🔍 [${messageId}] Job ${jobId} not currently processing (status: ${existingJob?.status || 'none'})`);
    }

    // Update status to processing and claim ownership with message ID
    jobLog(`📝 [${messageId}] Claiming ownership of job ${jobId}`);
    await this.updateJob(jobId, {
      status: 'processing',
      phase: 'Getting subject details',
      progress: 10,
      processingBy: CONSUMER,
      processingMessageId: messageId
    });

    // Set global job context for progress updates
    setCurrentJobContext({ jobId, jobQueue: this });

    // Start heartbeat
    const heartbeat = setInterval(async () => {
      await this.updateJob(jobId, { lastHeartbeat: Date.now() });
    }, HEARTBEAT_MS);

    try {
      // **FAST-FAIL: Early geocode validation**
      // Validate address can be geocoded before running expensive Vertex searches
      // Invalid addresses like "333" will fail here in ~10s instead of ~4 minutes
      jobLog(`🗺️  [${messageId}] Validating address via geocoding: ${address}`);
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

        jobLog(`✅ [${messageId}] Address validated via geocoding in ${geocodeDuration}ms: ${result.lat}, ${result.lng}`);
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
      setCurrentJobContext(null); // Clear job context
      setJobContext(null); // Clear logger context too
      jobLog(`✅ Job ${jobId} completed`);

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
          userId: existingJob?.userId,
          userEmail: existingJob?.userEmail,
          source: existingJob?.source
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
        setCurrentJobContext(null);
        setJobContext(null);
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
        userId: existingJob?.userId,
        userEmail: existingJob?.userEmail,
        source: existingJob?.source
      });

    } catch (error: any) {
      clearInterval(heartbeat);
      setCurrentJobContext(null); // Clear job context
      setJobContext(null); // Clear logger context too
      throw error;
    }
  }

  /**
   * Process a job from Pub/Sub (HTTP-triggered, no Redis Stream acknowledgment)
   * This is called from the /api/worker/process endpoint when receiving Pub/Sub push messages
   */
  async processJobFromPubSub(jobData: {jobId: string; address: string; userId?: string; userEmail?: string; source?: 'chatgpt' | 'website'}, pubsubMessageId: string): Promise<void> {
    const { jobId, address } = jobData;

    // Wrap entire execution in job context for automatic log prefixing
    return runWithJobContext(jobId, async () => {
      jobLog(`📢 [PubSub:${pubsubMessageId}] Processing job ${jobId}: ${address}`);

    // Check if job is already being processed or completed
    const existingJob = await this.getJobStatus(jobId);

    // Skip jobs that are already completed or failed
    if (existingJob && (existingJob.status === 'completed' || existingJob.status === 'failed')) {
      jobLog(`✅ [PubSub:${pubsubMessageId}] Job ${jobId} already ${existingJob.status}, skipping`);
      return;
    }

    if (existingJob && existingJob.status === 'processing') {
      // Check heartbeat to see if job is still actively processing
      const timeSinceHeartbeat = Date.now() - (existingJob.lastHeartbeat || 0);
      jobLog(`🔍 [PubSub:${pubsubMessageId}] Job ${jobId} status=processing, heartbeat age: ${Math.round(timeSinceHeartbeat / 1000)}s`);

      if (timeSinceHeartbeat < 60000) { // If heartbeat within last 60 seconds, job is still active
        console.warn(`⚠️  [PubSub:${pubsubMessageId}] Job ${jobId} still active (heartbeat ${Math.round(timeSinceHeartbeat / 1000)}s ago), skipping duplicate`);
        return; // Don't process duplicate - job is already being handled
      }
      jobLog(`⏰ [PubSub:${pubsubMessageId}] Job ${jobId} heartbeat stale, taking over`);
    }

    // Update status to processing and claim ownership (v4: CRITICAL - claim BEFORE starting heartbeat)
    jobLog(`📝 [PubSub:${pubsubMessageId}] Claiming ownership of job ${jobId}`);
    const leaseOwner = `pubsub:${pubsubMessageId}`;
    await this.updateJob(jobId, {
      status: 'processing',
      phase: 'Getting subject details',
      progress: 10,
      phaseMessage: 'Validating address and preparing analysis...',
      phaseStartTime: Date.now(),
      estimatedTimeRemaining: 295, // 300 total - 5 for QUEUED phase
      processingBy: leaseOwner,
      processingMessageId: pubsubMessageId
    }, leaseOwner);

    // Set global job context for progress updates
    setCurrentJobContext({ jobId, jobQueue: this });

    // Start heartbeat (v4: self-scheduling loop, returns stop function)
    const stopHeartbeat = this.startHeartbeat(jobId, leaseOwner);

    try {
      // **FAST-FAIL: Early geocode validation**
      jobLog(`🗺️  [PubSub:${pubsubMessageId}] Validating address via geocoding: ${address}`);
      const geocodeStart = Date.now();

      try {
        const geocoder = new GoogleMapsGeocoder();
        const result = await geocoder.geocodeAddress(address);
        const geocodeDuration = Date.now() - geocodeStart;

        if (!result || !result.lat || !result.lng) {
          console.error(`❌ [PubSub:${pubsubMessageId}] Address geocoding failed in ${geocodeDuration}ms - invalid address`);
          throw new Error(`Invalid address: could not geocode "${address}"`);
        }

        jobLog(`✅ [PubSub:${pubsubMessageId}] Address validated via geocoding in ${geocodeDuration}ms: ${result.lat}, ${result.lng}`);

        // Update progress to show geocoding complete and start countdown timer
        await this.updateProgress(jobId, 'SUBJECT_PROPERTY');
      } catch (error) {
        const geocodeDuration = Date.now() - geocodeStart;
        console.error(`❌ [PubSub:${pubsubMessageId}] Geocoder initialization or geocoding failed in ${geocodeDuration}ms:`, error);
        throw new Error(`Invalid address: could not geocode "${address}"${error instanceof Error ? ` - ${error.message}` : ''}`);
      }

      // Run analysis
      const result = await this.analysisService.findComparables(address);

      // CRITICAL (v4): Stop heartbeat BEFORE writing completion to prevent race condition
      // If heartbeat fires after completion write, it will overwrite the result with just { lastHeartbeat }
      stopHeartbeat();

      // Mark complete (v4: pass leaseOwner, add finalized flag, explicit completedAt)
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
        finalized: true,
        completedAt: Date.now()
      }, leaseOwner);
      setCurrentJobContext(null);
      setJobContext(null);
      jobLog(`✅ Job ${jobId} completed`);

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
          userId: existingJob?.userId,
          userEmail: existingJob?.userEmail,
          source: existingJob?.source
        });

        // Mark job as failed
        await this.updateJob(jobId, {
          status: 'failed',
          error: errorMessage,
          completedAt
        });

        // heartbeat already cleared above before completion write
        setCurrentJobContext(null);
        setJobContext(null);

        // Throw error to trigger Pub/Sub retry
        throw new Error(errorMessage);
      }

      // Send success notification email
      await sendSuccessNotification({
        jobId,
        address,
        arv: arvValue,
        compsCount,
        duration,
        timestamp: completedAt,
        userId: existingJob?.userId,
        userEmail: existingJob?.userEmail,
        source: existingJob?.source
      });

    } catch (error: any) {
      // Stop heartbeat in case error happened before completion (v4)
      stopHeartbeat();
      setCurrentJobContext(null);
      setJobContext(null);

      // Log error and rethrow to trigger Pub/Sub retry
      const errorMessage = error?.message || String(error);
      console.error(`❌ Job ${jobId} failed (Pub/Sub):`, errorMessage);

      // Update job status to failed (v4: pass leaseOwner, add finalized flag)
      await this.updateJob(jobId, {
        status: 'failed',
        error: errorMessage,
        finalized: true,
        completedAt: Date.now()
      }, leaseOwner);

      // Send error notification
      await sendErrorNotification({
        jobId,
        address,
        error: errorMessage,
        phase: existingJob?.phase || 'Unknown',
        attempts: 1,
        timestamp: Date.now(),
        userId: jobData.userId,
        userEmail: jobData.userEmail,
        source: jobData.source
      });

      // Rethrow to trigger HTTP 500 → Pub/Sub retry
      throw error;
    }
    }); // End of runWithJobContext
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
        userId: job.userId,
        userEmail: job.userEmail,
        source: job.source
      });

      // Acknowledge to remove from processing
      await this.redis.xack(STREAM, GROUP, messageId);
      jobLog(`💀 Job ${jobId} moved to DLQ after ${attempts} attempts`);
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

      jobLog(`🔄 Job ${jobId} retried immediately (attempt ${attempts}/${MAX_ATTEMPTS})`);
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
            jobLog(`♻️  Reclaimed ${claimed.length} stuck jobs`);

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
    jobLog('🛑 Stopping worker...');
    this.isProcessing = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.reclaimInterval) {
      clearInterval(this.reclaimInterval);
    }

    jobLog('✅ Worker stopped');
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
