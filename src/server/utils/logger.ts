import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';

interface TraceContext {
  traceId?: string;
  spanId?: string;
  jobId?: string;
  address?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

// Logs go to the console only; the host collects them. (Google Cloud Logging was removed.)

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'propertyvision-backend',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
  // Prevent transport errors from crashing the process
  exitOnError: false,
});

// Handle transport errors gracefully
logger.on('error', (error) => {
  console.error('Winston transport error (non-fatal):', error.message);
});

// Trace context management for Cloud Logging correlation
function parseTraceHeader(header: string | undefined): { traceId: string; spanId?: string } | null {
  if (!header) return null;
  const [traceId, spanId] = header.split('/');
  return traceId ? { traceId, spanId: spanId?.split(';')[0] } : null;
}

function getTracePath(traceId: string): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'agile-device-472202-i8';
  return `projects/${projectId}/traces/${traceId}`;
}

export function setTraceContext(req: any, additionalContext?: Partial<TraceContext>): void {
  const traceHeader = req.headers?.['x-cloud-trace-context'] || req.headers?.['traceparent'];
  const parsed = parseTraceHeader(traceHeader);
  const context: TraceContext = {
    traceId: parsed?.traceId,
    spanId: parsed?.spanId,
    ...additionalContext
  };
  traceStorage.enterWith(context);
}

export function updateTraceContext(updates: Partial<TraceContext>): void {
  const current = traceStorage.getStore() || {};
  traceStorage.enterWith({ ...current, ...updates });
}

export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

function getTraceMetadata(): any {
  const context = getTraceContext();
  if (!context) return {};
  const metadata: any = {};
  if (context.traceId) {
    metadata['logging.googleapis.com/trace'] = getTracePath(context.traceId);
  }
  if (context.spanId) {
    metadata['logging.googleapis.com/spanId'] = context.spanId;
  }
  return metadata;
}

// API-layer structured logs
export function logSearchRequest(data: {
  address: string; userId?: string; sessionId?: string; ip?: string;
}) {
  logger.info('Search request received', { eventType: 'SEARCH_REQUEST', ...data, ...getTraceMetadata() });
}

export function logSearchResult(data: {
  address: string; userId?: string; sessionId?: string;
  arv: number | null; twoBathArv: number | null;
  compsCount: number; qualifiedCompsCount: number;
  executionTimeMs: number; success: boolean;
}) {
  logger.info('Search completed', { eventType: 'SEARCH_RESULT', ...data, ...getTraceMetadata() });
}

export function logSearchError(data: {
  address: string; userId?: string; sessionId?: string;
  error: Error; stage?: string;
}) {
  logger.error('Search failed', {
    eventType: 'SEARCH_ERROR',
    address: data.address,
    userId: data.userId,
    sessionId: data.sessionId,
    stage: data.stage,
    errorMessage: data.error?.message,
    errorStack: data.error?.stack,
    ...getTraceMetadata(),
  });
}

export default logger;
