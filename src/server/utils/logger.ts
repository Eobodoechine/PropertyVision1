import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';

const loggingWinston = new LoggingWinston({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  logName: 'propertyvision-api',
});

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
    loggingWinston,
  ],
});

// API-layer structured logs
export function logSearchRequest(data: {
  address: string; userId?: string; sessionId?: string; ip?: string;
}) {
  logger.info('Search request received', { eventType: 'SEARCH_REQUEST', ...data });
}

export function logSearchResult(data: {
  address: string; userId?: string; sessionId?: string;
  arv: number | null; twoBathArv: number | null;
  compsCount: number; qualifiedCompsCount: number;
  executionTimeMs: number; success: boolean;
}) {
  logger.info('Search completed', { eventType: 'SEARCH_RESULT', ...data });
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
  });
}

export default logger;
