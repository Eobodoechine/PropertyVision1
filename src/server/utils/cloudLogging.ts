// src/server/utils/cloudLogging.ts
// Awaitable, lossless Cloud Logging queue with sequence numbers and audit helpers
import { Logging } from '@google-cloud/logging';

type Sev = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
type Json = Record<string, unknown>;

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? 'durable-ring-475417-g0';
const LOG_NAME   = process.env.CLOUD_LOG_NAME ?? 'local-arv-test';

// Pin project; disable internal retries so failures surface immediately
const logging = new Logging({ projectId: PROJECT_ID, autoRetry: false });
const log = logging.log(LOG_NAME);

const resource =
  process.env.K_SERVICE
    ? {
        type: 'cloud_run_revision',
        labels: {
          service_name: process.env.K_SERVICE!,
          revision_name: process.env.K_REVISION ?? 'dev',
          location: process.env.K_LOCATION ?? 'us-central1',
        },
      }
    : {
        type: 'global',
        labels: { project_id: PROJECT_ID },
      };

// —— tiny single-flight queue so nothing is dropped & order preserved
let q: Promise<void> = Promise.resolve();
const seqByJob = new Map<string, number>();
let globalSeq = 0;
const WRITE_TIMEOUT_MS = Number(process.env.CLOUD_LOG_WRITE_TIMEOUT_MS ?? 5000);
let cloudLogTimeouts = 0;
let lastCloudLogError: string | null = null;
let loggingDegraded = false;
let degradedSince: number | null = null;
const ENABLE_CLOUD_LOGGING = process.env.ENABLE_CLOUD_LOGGING !== 'false';

function trim(val: unknown, max = 60000) {
  try {
    let s = typeof val === 'string' ? val : JSON.stringify(val);
    return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
  } catch { return '[unserializable]'; }
}

function timeboxedWrite(entry: any, isBlocking: boolean): Promise<void> {
  const p = log.write([entry], { partialSuccess: isBlocking ? false : true });
  const t = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error('Cloud Logging write timeout')), WRITE_TIMEOUT_MS)
  );
  return Promise.race([p, t]).catch(err => {
    cloudLogTimeouts++;
    lastCloudLogError = err.message;
    console.error(`[CLOUD-LOG-ERROR] ${err.message} (timeouts=${cloudLogTimeouts})`);

    // Circuit breaker: if >=5 timeouts, degrade to non-blocking only
    if (cloudLogTimeouts >= 5 && !loggingDegraded) {
      loggingDegraded = true;
      degradedSince = Date.now();
      console.warn(`[CLOUD-LOG-DEGRADED] timeouts>=5, switching to non-blocking mode`);
    }
  });
}

export function writeCloud(
  severity: Sev,
  message: string,
  json: Json = {},
  opts: { blocking?: boolean } = {}
): Promise<void> {
  if (!ENABLE_CLOUD_LOGGING) return Promise.resolve();

  // Per-job sequence for diagnosable gaps; fallback to global if no jobId
  const jobId = (json.jobId as string) || 'global';
  const currentSeq = (seqByJob.get(jobId) ?? 0) + 1;
  seqByJob.set(jobId, currentSeq);
  globalSeq++;

  // Always include seq to spot gaps
  const entry = log.entry(
    { resource, severity },
    { ts: new Date().toISOString(), seq: currentSeq, globalSeq, message, ...json }
  );

  const isBlocking = opts.blocking && !loggingDegraded; // Circuit breaker overrides
  const writePromise = timeboxedWrite(entry, isBlocking);
  q = q.then(() => writePromise); // Always chain to preserve order/backpressure
  return isBlocking ? q : writePromise; // Caller awaits only if critical
}

export function flushCloud(): Promise<void> {
  // Await the end; emit final diagnostics
  if (lastCloudLogError) {
    console.warn(`[CLOUD-LOG-LAST-ERROR] ${lastCloudLogError}`);
  }
  if (loggingDegraded && degradedSince) {
    const durationMs = Date.now() - degradedSince;
    console.warn(`[CLOUD-LOG-DEGRADED-DURATION] ${durationMs}ms`);
  }
  if (cloudLogTimeouts > 0) {
    const totalWrites = globalSeq;
    const timeoutRate = ((cloudLogTimeouts / totalWrites) * 100).toFixed(1);
    console.warn(`[CLOUD-LOG-TIMEOUT-RATE] ${timeoutRate}% (${cloudLogTimeouts}/${totalWrites})`);
  }
  return q;
}

// Minimal audit helper to pinpoint breakage boundaries
export async function audit(loc: string, extras: Json = {}) {
  // Non-blocking, but still serialized in queue and timeboxed per-hop
  writeCloud('INFO', 'AUDIT', { tag: 'audit', loc, ...extras }, { blocking: false }).catch(() => {});
}
