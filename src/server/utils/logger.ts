// Lightweight logger with optional job context.
// No imports to avoid cycles.
let currentJobId: string | null = null;

export function setJobContext(jobId: string | null) {
  currentJobId = jobId;
}

export function jobLog(...args: any[]): void {
  if (currentJobId) {
    const shortId = currentJobId.slice(0, 8);
    console.log(`[${shortId}]`, ...args);
  } else {
    console.log(...args);
  }
}
