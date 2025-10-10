import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// AsyncLocalStorage for trace context propagation
interface TraceContext {
  traceId?: string;
  spanId?: string;
  jobId?: string;
  address?: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

const loggingWinston = new LoggingWinston({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  logName: 'propertyvision-api',
});

const isProduction = process.env.NODE_ENV === 'production';

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
    // Console transport for all environments
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    // Google Cloud Logging for ALL environments (production + development)
    loggingWinston,
    // Development/Local: File-based logging
    ...(!isProduction ? [
      new winston.transports.File({
        filename: path.join(__dirname, '../../logs/error.log'),
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
      new winston.transports.File({
        filename: path.join(__dirname, '../../logs/searches.log'),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
    ] : []),
  ],
});

// Helper to log search requests
export function logSearchRequest(data: {
  address: string;
  userId?: string;
  sessionId?: string;
  ip?: string;
}) {
  logger.info('Search request received', {
    eventType: 'SEARCH_REQUEST',
    ...data,
  });
}

// Helper to log search results
export function logSearchResult(data: {
  address: string;
  userId?: string;
  sessionId?: string;
  arv: number | null;
  twoBathArv: number | null;
  compsCount: number;
  qualifiedCompsCount: number;
  executionTimeMs: number;
  success: boolean;
}) {
  logger.info('Search completed', {
    eventType: 'SEARCH_RESULT',
    ...data,
  });
}

// Helper to log errors
export function logSearchError(data: {
  address: string;
  userId?: string;
  sessionId?: string;
  error: Error;
  stage?: string;
}) {
  logger.error('Search failed', {
    eventType: 'SEARCH_ERROR',
    address: data.address,
    userId: data.userId,
    sessionId: data.sessionId,
    stage: data.stage,
    errorMessage: data.error.message,
    errorStack: data.error.stack,
  });
}

/**
 * Extract trace ID from X-Cloud-Trace-Context header
 * Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
 */
function parseTraceHeader(header: string | undefined): { traceId: string; spanId?: string } | null {
  if (!header) return null;
  const [traceId, spanId] = header.split('/');
  return traceId ? { traceId, spanId: spanId?.split(';')[0] } : null;
}

/**
 * Get fully qualified trace path for Cloud Logging
 */
function getTracePath(traceId: string): string {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || 'agile-device-472202-i8';
  return `projects/${projectId}/traces/${traceId}`;
}

/**
 * Set trace context from HTTP request (call in API handlers)
 */
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

/**
 * Update trace context (e.g., add jobId after job starts)
 */
export function updateTraceContext(updates: Partial<TraceContext>): void {
  const current = traceStorage.getStore() || {};
  traceStorage.enterWith({ ...current, ...updates });
}

/**
 * Get current trace context
 */
export function getTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}

/**
 * Get trace metadata for logging
 */
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

  if (context.jobId) {
    metadata.jobId = context.jobId;
  }

  if (context.address) {
    metadata.address = context.address;
  }

  return metadata;
}

// Override console.log to send to Cloud Logging in addition to stdout
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args: any[]) => {
  originalConsoleLog(...args); // Keep stdout output
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  const metadata = getTraceMetadata();
  logger.info(message, {
    source: 'console.log',
    ...metadata,
    // Flatten jobId and address to top level for easier Cloud Logging queries
    ...(metadata.jobId && { jobId: metadata.jobId }),
    ...(metadata.address && { address: metadata.address }),
  });
};

console.error = (...args: any[]) => {
  originalConsoleError(...args);
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  const metadata = getTraceMetadata();
  logger.error(message, {
    source: 'console.error',
    ...metadata,
    ...(metadata.jobId && { jobId: metadata.jobId }),
    ...(metadata.address && { address: metadata.address }),
  });
};

console.warn = (...args: any[]) => {
  originalConsoleWarn(...args);
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  const metadata = getTraceMetadata();
  logger.warn(message, {
    source: 'console.warn',
    ...metadata,
    ...(metadata.jobId && { jobId: metadata.jobId }),
    ...(metadata.address && { address: metadata.address }),
  });
};

export default logger;
