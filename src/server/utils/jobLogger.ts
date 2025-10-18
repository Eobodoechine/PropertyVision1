// Lightweight logger with optional job context using AsyncLocalStorage.
// No external imports to avoid cycles.
import { AsyncLocalStorage } from 'async_hooks';

const jobContextStorage = new AsyncLocalStorage<string>();

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

export function jobLog(...args: any[]): void {
  const currentJobId = jobContextStorage.getStore();
  if (currentJobId) {
    const shortId = currentJobId.slice(0, 8);
    console.log(`[${shortId}]`, ...args);
  } else {
    console.log(...args);
  }
}
