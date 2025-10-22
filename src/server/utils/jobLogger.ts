// Lightweight logger with optional job context using AsyncLocalStorage.
// Uses awaitable Cloud Logging queue for development mode.
import { AsyncLocalStorage } from 'async_hooks';
import { writeCloud } from './cloudLogging.js';

const jobContextStorage = new AsyncLocalStorage<string>();

type Sev = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
type Json = Record<string, unknown>;

export function setJobContext(jobId: string | null) {
  // This is a no-op now - kept for backward compatibility
  // The real context is set via runWithJobContext
}

/**
 * Run a function with job context that persists across async operations
 */
export function runWithJobContext<T>(jobId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return jobContextStorage.run(jobId, fn);
}

/**
 * Get the current job ID from async context
 */
export function getCurrentJobId(): string | null {
  return jobContextStorage.getStore() || null;
}

function short(jobId?: string | null) {
  if (!jobId) return '--------';
  return jobId.replace(/-/g, '').slice(0, 8);
}

function safe(x: unknown) {
  try {
    return typeof x === 'string' ? x : JSON.stringify(x);
  } catch {
    return '[unserializable]';
  }
}

function isPlainObject(v: any): boolean {
  return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Backward-compatible logger that accepts both old variadic and new specific signatures:
 *
 * NEW style: await jobLog('msg', {extras}, {severity:'INFO', awaitCloud:true})
 * OLD style: jobLog('msg'), jobLog('a', {x:1}, 'b')
 *
 * All calls route through writeCloud() to ensure sequence numbers and diagnostics work.
 */
export async function jobLog(...args: any[]): Promise<void> {
  if (!args.length) return;

  let message = '';
  let extras: Json = {};
  let opts: { severity?: Sev; awaitCloud?: boolean } = {};

  // Detect call pattern: NEW specific vs OLD variadic
  // NEW: (msg: string, extras?: Json, opts?: {severity, awaitCloud})
  if (
    typeof args[0] === 'string' &&
    args.length <= 3 &&
    (args[1] === undefined || isPlainObject(args[1])) &&
    (args[2] === undefined || isPlainObject(args[2]))
  ) {
    // NEW specific style
    message = args[0] as string;
    extras = (args[1] ?? {}) as Json;
    opts = (args[2] ?? {}) as JobLogOpts;
  } else {
    // OLD variadic style → join strings; preserve objects in extras.legacy
    const strings: string[] = [];
    const objects: Json[] = [];

    for (const a of args) {
      if (isPlainObject(a)) {
        objects.push(a as Json);
      } else {
        strings.push(safe(a));
      }
    }

    message = strings.join(' ');
    if (objects.length > 0) {
      extras.legacy = objects;
    }
  }

  // Resolve job context
  const jobId = (extras.jobId as string) || getCurrentJobId();
  const sid = (extras.shortId as string) || short(jobId);
  const sev = (opts.severity ?? 'INFO') as Sev;

  // Console: always prints (unchanged from original behavior)
  const line = `[${sid}] ${message}${Object.keys(extras).length ? ' ' + safe(extras) : ''}`;
  if (sev === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }

  // Cloud Logging: enqueue in development mode or when explicitly enabled
  if (process.env.NODE_ENV === 'development' || process.env.ENABLE_CLOUD_LOGGING === 'true') {
    const isCritical = opts.awaitCloud === true;
    const p = writeCloud(sev, message, { ...extras, jobId, shortId: sid }, { blocking: isCritical });
    if (isCritical) await p;
    else p.catch(() => {}); // Fire-and-forget - prevent unhandled rejection
  }
}

type JobLogOpts = { severity?: Sev; awaitCloud?: boolean };
