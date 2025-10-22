// Job-aware logger that sends to both console and Cloud Logging
import logger from './logger';

let currentJobId: string | null = null;

export function setJobContext(jobId: string | null) {
  currentJobId = jobId;
}

export function jobLog(...args: any[]): void {
  // Format message for Winston
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');

  if (currentJobId) {
    const shortId = currentJobId.slice(0, 8);
    const prefixedMessage = `[${shortId}] ${message}`;
    // Send to both console (for terminal) and Winston (for Cloud Logging)
    console.log(prefixedMessage);
    logger.info(prefixedMessage, { jobId: currentJobId, source: 'jobLog' });
  } else {
    console.log(message);
    logger.info(message, { source: 'jobLog' });
  }
}

// Gracefully close Winston logger and wait for all transports to flush
export async function closeLogger(): Promise<void> {
  return new Promise((resolve) => {
    logger.close(() => {
      resolve();
    });
  });
}
