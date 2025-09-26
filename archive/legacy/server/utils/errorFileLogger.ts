import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Centralized, file-backed error logger.
// Writes to server/logs/errors.log so you can commit and push.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.resolve(__dirname, '..', 'logs');
const logFile = path.join(logDir, 'errors.log');

// Ensure log directory exists
function ensureDir() {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // ignore
  }
}

function stringifyError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  try {
    return { message: JSON.stringify(err) };
  } catch {
    return { message: String(err) };
  }
}

export function logError(err: unknown, context?: Record<string, unknown>) {
  ensureDir();
  const ts = new Date().toISOString();
  const payload = stringifyError(err);
  const safeContext = context ? safeSerialize(context) : undefined;
  const line = [
    `[${ts}] ERROR`,
    payload.message,
    payload.stack ? `\nSTACK ${payload.stack}` : '',
    safeContext ? `\nCTX ${safeContext}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+$/g, '')
    .concat('\n');

  try {
    fs.appendFileSync(logFile, line, { encoding: 'utf8' });
  } catch {
    // ignore write failures
  }
}

// Basic serializer that avoids dumping huge objects or circular refs
function safeSerialize(value: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, function (_key, val) {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      if (typeof val === 'string' && val.length > 500) return val.slice(0, 500) + '…';
      return val;
    });
  } catch {
    try {
      return String(value);
    } catch {
      return '[Unserializable]';
    }
  }
}

export function setupGlobalErrorLogging() {
  // Attach once
  if ((global as any).__errorLoggerAttached) return;
  (global as any).__errorLoggerAttached = true;

  // Capture unhandled errors
  process.on('uncaughtException', (err) => {
    logError(err, { type: 'uncaughtException' });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logError(reason, { type: 'unhandledRejection' });
  });

  // Mirror console.error to file as well
  const origConsoleError = console.error.bind(console);
  console.error = (...args: any[]) => {
    try {
      const msg = args.map(a => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : typeof a === 'string' ? a : safeSerialize(a))).join(' ');
      logError(msg, { type: 'console.error' });
    } catch {
      // ignore
    }
    origConsoleError(...args);
  };
}

export function getErrorLogPath() {
  ensureDir();
  return logFile;
}

