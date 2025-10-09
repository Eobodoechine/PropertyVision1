import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

// Cloud Run automatically captures console output and sends to Cloud Logging
// No need for LoggingWinston transport - it causes timeouts with private-ranges-only VPC egress
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
    // Console transport - Cloud Run captures this automatically for Cloud Logging
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
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

// Cloud Run automatically captures console.log/error/warn output
// No need to override console methods - let them write directly to stdout/stderr

export default logger;
