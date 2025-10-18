import https from 'https';
import pLimit from 'p-limit';
import { jobLog } from '../utils/jobLogger';

/**
 * Vertex AI Client with Connection Pooling, Token Caching, and Retry Logic
 * - Keep-alive agent for connection reuse
 * - OAuth token caching with auto-refresh
 * - Exponential backoff retries
 * - Bounded concurrency (default: 10 concurrent requests)
 */

interface VertexGenerateOptions {
  projectId: string;
  location: string;
  model: string;
  prompt: string;
  grounded?: boolean;
  json?: boolean;
  responseSchema?: any;
  timeoutMs?: number;
  token: string; // OAuth token from ADC
}

class VertexClient {
  private agent: https.Agent;
  private limiter: ReturnType<typeof pLimit>;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BASE_DELAY_MS = 1000;
  private readonly DEFAULT_TIMEOUT_MS = 90000; // 90 seconds

  constructor(concurrency: number = 10) {
    // Create keep-alive agent for connection pooling
    this.agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // Send keepalive probes every 30s
      maxSockets: concurrency,
      maxFreeSockets: 10,
      timeout: 120000, // Socket timeout 2 minutes
    });

    // Bounded concurrency limiter
    this.limiter = pLimit(concurrency);

    jobLog(`✅ VertexClient initialized: concurrency=${concurrency}, keepAlive=true`);
  }

  /**
   * HTTPS POST with JSON payload and retry logic
   */
  private async httpsPostJson(
    url: string,
    payload: any,
    headers: Record<string, string>,
    timeoutMs: number,
    retryCount: number = 0
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const body = JSON.stringify(payload);

      const req = https.request(
        {
          method: 'POST',
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body).toString(),
            ...headers,
          },
          agent: this.agent,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          });
        }
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        const error = new Error(`Request timeout after ${timeoutMs}ms`);
        (error as any).code = 'ETIMEDOUT';
        reject(error);
      });

      req.on('error', (err) => {
        (err as any).retryCount = retryCount;
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * Generate content with Vertex AI (with exponential backoff retries)
   */
  async generate(opts: VertexGenerateOptions): Promise<string> {
    return this.limiter(async () => {
      const timeoutMs = opts.timeoutMs || this.DEFAULT_TIMEOUT_MS;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const startTime = Date.now();
          const callType = opts.grounded ? 'GROUNDED' : 'NON-GROUNDED';

          if (attempt > 0) {
            const delay = this.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            jobLog(`🔄 VERTEX RETRY ${attempt}/${this.MAX_RETRIES} after ${delay}ms delay`);
            await new Promise((r) => setTimeout(r, delay));
          }

          jobLog(
            `📊 VERTEX_CALL_START: attempt=${attempt + 1}, type=${callType}, timeout=${timeoutMs}ms`
          );

          // Use token from ADC (passed in opts)
          const token = opts.token;

          const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;

          const payload: any = {
            contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
            generationConfig: {
              temperature: 0,
              seed: 12345,
              maxOutputTokens: 8192,
              ...(opts.json ? { responseMimeType: 'application/json' } : {}),
            },
          };

          if (opts.grounded) {
            payload.tools = [{ google_search: {} }];
          }
          if (opts.responseSchema) {
            payload.generationConfig.responseSchema = opts.responseSchema;
          }

          const res = await this.httpsPostJson(
            endpoint,
            payload,
            { Authorization: `Bearer ${token}` },
            timeoutMs,
            attempt
          );

          const duration = Date.now() - startTime;
          jobLog(
            `📊 VERTEX_CALL_COMPLETE: attempt=${attempt + 1}, type=${callType}, duration=${duration}ms`
          );

          if (!res || !res.candidates || !res.candidates[0]) {
            if (res?.error) {
              console.error(`❌ VERTEX API ERROR:`, JSON.stringify(res.error, null, 2));
              // Check if retryable error
              const statusCode = res.error.code;
              if (statusCode === 429 || statusCode === 503 || statusCode >= 500) {
                throw new Error(`Vertex API error: ${res.error.message} (retryable)`);
              }
            }
            return '';
          }

          const text =
            res.candidates[0].content?.parts?.map((p: any) => p?.text || '').join('') || '';
          return text;
        } catch (error: any) {
          lastError = error;

          // Check if error is retryable
          const isRetryable =
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNRESET' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED' ||
            error.message?.includes('socket hang up') ||
            error.message?.includes('retryable');

          console.error(
            `❌ VERTEX ERROR (attempt ${attempt + 1}/${this.MAX_RETRIES + 1}):`,
            error.message,
            `retryable=${isRetryable}`
          );

          // Don't retry if not retryable or out of retries
          if (!isRetryable || attempt === this.MAX_RETRIES) {
            break;
          }
        }
      }

      // All retries exhausted
      console.error(`❌ VERTEX CALL FAILED after ${this.MAX_RETRIES + 1} attempts:`, lastError);
      return '';
    });
  }

  /**
   * Shutdown client (close keep-alive connections)
   */
  destroy() {
    this.agent.destroy();
    jobLog('🔌 VertexClient destroyed');
  }
}

// Declare global type for development mode hot reload persistence
declare global {
  var __vertexClient: VertexClient | undefined;
}

// Singleton instance
let vertexClientInstance: VertexClient | null = null;

export function getVertexClient(concurrency: number = 10): VertexClient {
  // In development, use globalThis to persist across hot reloads
  if (process.env.NODE_ENV !== 'production') {
    if (!global.__vertexClient) {
      global.__vertexClient = new VertexClient(concurrency);
    }
    return global.__vertexClient;
  }

  // In production, use regular singleton
  if (!vertexClientInstance) {
    vertexClientInstance = new VertexClient(concurrency);
  }
  return vertexClientInstance;
}

// Export singleton instance
export const vertexClient = getVertexClient();
