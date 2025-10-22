/**
 * Vertex AI Circuit Breaker
 *
 * Prevents cascading failures during 429 storms by temporarily pausing
 * deduplication calls when quota is exhausted.
 *
 * When open, the worker returns 200 OK to Pub/Sub (ACK), preventing
 * retry storms. Pub/Sub's retry policy (30s-600s backoff) will redeliver
 * the message after quota recovers.
 */

import { jobLog } from './jobLogger';

let windowStart = 0;
let strikeCount = 0;
let openUntil = 0;

const STRIKE_THRESHOLD = 5;       // Open after 5x 429 errors
const WINDOW_MS = 60000;          // Reset strikes every 60s
const OPEN_DURATION_MS = 60000;   // Stay open for 60s

/**
 * Record a 429 error - may trip the breaker
 */
export function record429(): void {
  const now = Date.now();

  // Reset window if expired
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    strikeCount = 0;
  }

  strikeCount++;
  jobLog(`⚠️  Circuit breaker: 429 strike ${strikeCount}/${STRIKE_THRESHOLD} in current window`);

  // Trip breaker if threshold reached
  if (strikeCount >= STRIKE_THRESHOLD) {
    openUntil = now + OPEN_DURATION_MS;
    jobLog(`🔴 Circuit breaker OPEN until ${new Date(openUntil).toISOString()} (${OPEN_DURATION_MS / 1000}s)`);
  }
}

/**
 * Check if breaker is open - throws if so
 *
 * Call this before making Vertex AI calls to fail fast.
 *
 * @throws Error if breaker is open
 */
export function ensureClosed(): void {
  const now = Date.now();

  if (now < openUntil) {
    const remainingMs = openUntil - now;
    const error = new Error(`VERTEX_BREAKER_OPEN: Retry after ${Math.ceil(remainingMs / 1000)}s`);
    (error as any).code = 'BREAKER_OPEN';
    throw error;
  }
}

/**
 * Check status without throwing
 *
 * @returns boolean - True if breaker is currently open
 */
export function isOpen(): boolean {
  return Date.now() < openUntil;
}

/**
 * Get remaining time until breaker closes
 *
 * @returns number - Milliseconds until breaker closes (0 if closed)
 */
export function getRemainingMs(): number {
  const now = Date.now();
  return Math.max(0, openUntil - now);
}
