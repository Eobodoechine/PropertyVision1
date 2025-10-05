import express from "express";
import { GoogleAuth } from "google-auth-library";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8080;
const PROXY_SHARED_KEY = process.env.PROXY_SHARED_KEY!;
const GCP_PROJECT = process.env.GCP_PROJECT || "agile-device-472202-i8";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";

// Initialize Google Auth with ADC (Application Default Credentials)
const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

// Generate unique request ID
function generateReqId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// Truncate text for logging
function truncate(text: string, maxLen: number = 300): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "... (truncated)";
}

// Diagnostic logging helper with structured fields
function diag(event: string, data?: any) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...data
  }));
}

// Sleep utility for retry backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    shouldRetry: (error: any) => boolean;
    onRetry?: (attempt: number, error: any) => void;
  }
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === options.maxAttempts || !options.shouldRetry(error)) {
        throw error;
      }

      const jitter = Math.random() * 0.3; // ±30% jitter
      const delay = Math.min(
        options.baseDelayMs * Math.pow(2, attempt - 1) * (1 + jitter),
        options.maxDelayMs
      );

      if (options.onRetry) {
        options.onRetry(attempt, error);
      }

      await sleep(delay);
    }
  }

  throw lastError;
}

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "vertex-proxy",
    project: GCP_PROJECT,
    location: VERTEX_LOCATION
  });
});

// Vertex AI proxy endpoint
app.post("/vertex/generate", async (req, res) => {
  const startTime = Date.now();
  const reqId = generateReqId();

  // Auth check
  const providedKey = req.get("x-proxy-key");
  if (!providedKey || providedKey !== PROXY_SHARED_KEY) {
    diag("vertex.proxy.auth-failed", { reqId, ip: req.ip });
    return res.status(401).json({ error: "unauthorized" });
  }

  const {
    prompt,
    model = "gemini-1.5-flash-002",
    timeoutMs,
    temperature = 0.1,
    maxOutputTokens = 8192,
    grounded = false,
    jobId,
    searchId
  } = req.body || {};

  if (!prompt) {
    diag("vertex.proxy.bad-request", { reqId, reason: "missing-prompt" });
    return res.status(400).json({ error: "prompt required" });
  }

  // Determine timeout based on whether it's a grounded search
  const effectiveTimeout = timeoutMs || (grounded ? 300000 : 30000);

  // Log incoming request
  diag("vertex.proxy.request", {
    reqId,
    jobId,
    searchId,
    model,
    grounded,
    promptLength: prompt.length,
    timeoutMs: effectiveTimeout,
    temperature,
    maxOutputTokens
  });

  try {
    // Retry wrapper for Vertex API call
    const result = await retryWithBackoff(
      async () => {
        // Get access token using ADC
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        if (!accessToken.token) {
          throw new Error("Failed to get access token");
        }

        // Construct Vertex AI REST API URL
        const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${model}:generateContent`;

        // Build request payload
        const payload: any = {
          contents: [{
            role: "user",
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            topP: 0.95,
            topK: 40
          }
        };

        // Add grounding tools if requested
        if (grounded) {
          payload.tools = [{
            google_search: {}
          }];
        }

        const payloadSizeBytes = JSON.stringify(payload).length;

        // Call Vertex AI with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

        const callStartTime = Date.now();

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken.token}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const callLatencyMs = Date.now() - callStartTime;

        if (!response.ok) {
          const errorText = await response.text();

          // Log error with details
          diag("vertex.proxy.error", {
            reqId,
            jobId,
            searchId,
            model,
            http: {
              status: response.status,
              statusText: response.statusText
            },
            error: {
              snippet: truncate(errorText, 300),
              code: response.status
            },
            timingMs: {
              total: callLatencyMs
            },
            payloadSizeBytes
          });

          // Create error object with status for retry logic
          const error: any = new Error(`Vertex API returned ${response.status}`);
          error.status = response.status;
          error.body = errorText;
          throw error;
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // Log successful response
        diag("vertex.proxy.response", {
          reqId,
          jobId,
          searchId,
          model,
          grounded,
          http: {
            status: 200
          },
          timingMs: {
            total: callLatencyMs
          },
          payloadSizeBytes,
          responseChars: text.length,
          hasContent: !!result.candidates?.[0]?.content
        });

        return { result, text, latencyMs: callLatencyMs };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        shouldRetry: (error: any) => {
          // Retry on 429 (rate limit), 5xx (server errors), or network errors
          const status = error.status;
          const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.name === 'FetchError';
          return status === 429 || (status >= 500 && status < 600) || isNetworkError;
        },
        onRetry: (attempt, error) => {
          diag("vertex.proxy.retry", {
            reqId,
            jobId,
            searchId,
            attempt,
            error: {
              message: error.message,
              status: error.status,
              code: error.code
            }
          });
        }
      }
    );

    const totalElapsedMs = Date.now() - startTime;

    // Return successful response
    return res.json({
      text: result.text,
      elapsedMs: totalElapsedMs,
      latencyMs: result.latencyMs,
      model,
      rawResponse: result.result
    });

  } catch (error: any) {
    const totalElapsedMs = Date.now() - startTime;

    if (error.name === 'AbortError') {
      diag("vertex.proxy.timeout", {
        reqId,
        jobId,
        searchId,
        model,
        timeoutMs: effectiveTimeout,
        timingMs: {
          total: totalElapsedMs
        }
      });
      return res.status(504).json({
        error: "timeout",
        message: `Request exceeded ${effectiveTimeout}ms timeout`,
        reqId
      });
    }

    // Log final error after all retries exhausted
    diag("vertex.proxy.error", {
      reqId,
      jobId,
      searchId,
      model,
      error: {
        message: error.message,
        snippet: truncate(error.stack || error.message, 300),
        code: error.code,
        status: error.status
      },
      timingMs: {
        total: totalElapsedMs
      }
    });

    // Return 502 for upstream failures, 503 for rate limits
    const statusCode = error.status === 429 ? 503 : 502;
    return res.status(statusCode).json({
      error: "upstream-failed",
      message: error.message,
      status: error.status,
      reqId
    });
  }
});

// Batch deduplication endpoint (for your specific use case)
app.post("/vertex/deduplicate", async (req, res) => {
  const startTime = Date.now();

  // Auth check
  const providedKey = req.get("x-proxy-key");
  if (!providedKey || providedKey !== PROXY_SHARED_KEY) {
    diag("vertex.dedupe.auth-failed", { ip: req.ip });
    return res.status(401).json({ error: "unauthorized" });
  }

  const {
    comparables,
    model = "gemini-1.5-flash-002",
    timeoutMs = 30000
  } = req.body || {};

  if (!comparables || !Array.isArray(comparables)) {
    diag("vertex.dedupe.bad-request", { reason: "missing-comparables" });
    return res.status(400).json({ error: "comparables array required" });
  }

  // Build deduplication prompt
  const prompt = `You are a real estate data deduplication expert. Analyze this list of ${comparables.length} property records and identify duplicates.

RECORDS:
${comparables.map((c: any, i: number) => `[${i}] ${c.address || c.street_address || "Unknown"} | ${c.sqft || "?"} sqft | $${c.sale_price || "?"}`).join("\n")}

Return ONLY valid JSON with this structure:
{
  "duplicate_groups": [[id1, id2], [id3, id4, id5]],
  "dropped_record_ids": [],
  "ambiguous_record_ids": [],
  "changes_log": []
}`;

  diag("vertex.dedupe.call", {
    model,
    comparablesCount: comparables.length,
    timeoutMs
  });

  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error("Failed to get access token");
    }

    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${model}:generateContent`;

    const payload = {
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        topP: 0.95,
        topK: 40
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken.token}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const elapsedMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      diag("vertex.dedupe.error", {
        status: response.status,
        error: errorText,
        elapsedMs
      });
      return res.status(response.status).json({
        error: "vertex-api-error",
        message: errorText
      });
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      diag("vertex.dedupe.parse-error", { text: text.substring(0, 200) });
      return res.status(500).json({
        error: "invalid-json-response",
        rawText: text
      });
    }

    const dedupeResult = JSON.parse(jsonMatch[0]);

    diag("vertex.dedupe.success", {
      elapsedMs,
      duplicateGroups: dedupeResult.duplicate_groups?.length || 0,
      droppedCount: dedupeResult.dropped_record_ids?.length || 0
    });

    return res.json({
      ...dedupeResult,
      elapsedMs,
      model
    });

  } catch (error: any) {
    const elapsedMs = Date.now() - startTime;

    if (error.name === 'AbortError') {
      diag("vertex.dedupe.timeout", { timeoutMs, elapsedMs });
      return res.status(504).json({
        error: "timeout",
        message: `Request exceeded ${timeoutMs}ms timeout`
      });
    }

    diag("vertex.dedupe.error", {
      error: error.message,
      elapsedMs
    });

    return res.status(502).json({
      error: "upstream-failed",
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  diag("vertex.proxy.started", { port: PORT, project: GCP_PROJECT });
});
