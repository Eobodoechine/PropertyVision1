import { getCurrentJobId } from './jobLogger';

// Probes log to the console only; the host collects stdout. (Google Cloud Logging was removed.)

/**
 * Extract caller file:line:col from Error stack trace
 * @param depth Stack depth to examine (default: 2)
 */
function callsite(depth = 2) {
  const s = new Error().stack?.split('\n')[depth] || '';
  const m = s.match(/\((.*?):(\d+):(\d+)\)/);
  return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]) } : {};
}

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

type ProbeCommon = {
  probe: string;
  level?: Level;
  msg?: string;
  phase?: string;
  file?: string;
  line?: number;
  col?: number;
  jobId?: string;
  t0?: number;
  durMs?: number;
};

/**
 * Structured probe logging with automatic file:line:col capture
 *
 * Usage:
 *   probe({ probe: 'VERTEX_HTTP_ATTEMPT', attempt: 1, reqId: 'abc123' });
 *   probe({ probe: 'CACHE_HIT', level: 'DEBUG', key: 'vertex:result:abc' });
 *   probe({ probe: 'ERROR_OCCURRED', level: 'ERROR', msg: 'Timeout', httpStatus: 504 });
 */
export function probe(p: ProbeCommon & Record<string, any> = {}) {
  const { file, line, col } = callsite(3);
  const jobId = getCurrentJobId();

  const payload = {
    level: 'INFO',
    ...p,
    jobId,
    file: p.file || file,
    line: p.line || line,
    col: p.col || col,
  };

  // Always log to console (for local viewing and Cloud Run stdout capture)
  // Add [shortId] prefix like jobLog does
  const shortId = jobId ? jobId.slice(0, 8) : null;
  if (shortId) {
    console.log(`[${shortId}]`, JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}
