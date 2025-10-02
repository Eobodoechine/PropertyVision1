import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Override console.log to send to Cloud Logging in addition to stdout
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args: any[]) => {
  originalConsoleLog(...args); // Keep stdout output
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  logger.info(message, { source: 'console.log' });
};

console.error = (...args: any[]) => {
  originalConsoleError(...args);
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  logger.error(message, { source: 'console.error' });
};

console.warn = (...args: any[]) => {
  originalConsoleWarn(...args);
  const message = args.map(arg =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  ).join(' ');
  logger.warn(message, { source: 'console.warn' });
};

export default logger;
