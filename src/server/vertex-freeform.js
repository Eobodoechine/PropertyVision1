import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { jobLog } from './utils/jobLogger';

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

// Configure Node.js v20 globalAgent with better timeout management
// Close idle sockets after 4s (before Vertex AI server's ~5s timeout) to prevent ECONNRESET
https.globalAgent.options = {
    ...https.globalAgent.options,
    freeSocketTimeout: 4000,  // Close idle sockets proactively
    timeout: 60000,
    keepAlive: true,  // Already true in v20, but being explicit
    keepAliveMsecs: 30000
};

// 🔍 DIAGNOSTIC: Track concurrent API calls and socket usage
let activeVertexCalls = 0;
let peakConcurrency = 0;

// 📊 STATISTICS: Track retry success across all Vertex calls in this worker instance
let vertexStats = {
    totalCalls: 0,
    successFirstAttempt: 0,
    successAfterRetry: 0,
    totalFailures: 0,
    socketReusedCount: 0,
    socketNewCount: 0,
    errorCodes: {},
    retriesByAttempt: { 1: 0, 2: 0, 3: 0 }  // Track how many retries were needed
};

// Retry configuration based on Node.js issue #55330 workarounds
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;  // Exponential backoff: 1s, 2s, 4s

// 🔧 DIAGNOSTIC: Track auth client instances and token caching
let authClientInstanceCount = 0;
const tokenCache = { token: null, fetchedAt: null };

/**
 * Log comprehensive statistics about Vertex API calls
 */
function logVertexStats() {
    const totalAttempts = vertexStats.totalCalls;
    if (totalAttempts === 0) return;

    const successRate = ((vertexStats.successFirstAttempt + vertexStats.successAfterRetry) / totalAttempts * 100).toFixed(1);
    const retryRate = (vertexStats.successAfterRetry / totalAttempts * 100).toFixed(1);
    const failureRate = (vertexStats.totalFailures / totalAttempts * 100).toFixed(1);
    const totalSockets = vertexStats.socketReusedCount + vertexStats.socketNewCount;
    const reuseRate = totalSockets > 0 ? (vertexStats.socketReusedCount / totalSockets * 100).toFixed(1) : 0;

    jobLog(`📈 VERTEX_API_STATS (this worker session):`);
    jobLog(`   Total calls: ${totalAttempts}`);
    jobLog(`   Success on first attempt: ${vertexStats.successFirstAttempt} (${((vertexStats.successFirstAttempt / totalAttempts * 100).toFixed(1))}%)`);
    jobLog(`   Success after retry: ${vertexStats.successAfterRetry} (${retryRate}%)`);
    jobLog(`   Failed after all retries: ${vertexStats.totalFailures} (${failureRate}%)`);
    jobLog(`   Overall success rate: ${successRate}%`);
    jobLog(`   Socket reuse rate: ${vertexStats.socketReusedCount}/${totalSockets} (${reuseRate}%)`);
    jobLog(`   Retries by attempt: 1st=${vertexStats.retriesByAttempt[1]}, 2nd=${vertexStats.retriesByAttempt[2]}, 3rd=${vertexStats.retriesByAttempt[3]}`);
    jobLog(`   Error breakdown: ${JSON.stringify(vertexStats.errorCodes)}`);
    jobLog(`   Peak concurrency: ${peakConcurrency}`);
}

/**
 * Retry wrapper with exponential backoff and comprehensive logging
 * Implements workarounds from Node.js issue #55330
 */
async function httpsPostJsonWithRetry(url, payload, headers, timeoutMs = 60000, callType = 'VERTEX') {
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const attemptStart = Date.now();
        const isRetry = attempt > 1;

        // Log attempt start
        jobLog(`🔄 VERTEX_ATTEMPT_${attempt}/${MAX_RETRIES}: ${callType}`);
        jobLog(`   Type: ${isRetry ? 'RETRY' : 'INITIAL'}`);
        if (lastError) {
            jobLog(`   Previous error: ${lastError.code || 'unknown'}`);
            jobLog(`   Previous message: ${lastError.message}`);
        }
        if (isRetry) {
            const elapsed = Date.now() - startTime;
            jobLog(`   Time elapsed since first attempt: ${elapsed}ms`);
        }

        try {
            const result = await httpsPostJson(url, payload, headers, timeoutMs);
            const duration = Date.now() - attemptStart;
            const totalDuration = Date.now() - startTime;

            // Check for API-level 429 errors in the response
            if (result && result.error) {
                const errorCode = result.error.code;
                const errorStatus = result.error.status;

                if (errorCode === 429 || errorStatus === 'RESOURCE_EXHAUSTED') {
                    // Treat 429 as a retryable error
                    const hasRetriesLeft = attempt < MAX_RETRIES;

                    jobLog(`⚠️  VERTEX_API_429: attempt=${attempt}/${MAX_RETRIES}`);
                    jobLog(`   Status: ${errorStatus}`);
                    jobLog(`   Code: ${errorCode}`);
                    jobLog(`   Duration: ${duration}ms`);

                    if (!hasRetriesLeft) {
                        jobLog(`🛑 RETRY_EXHAUSTED_429: All retries exhausted for 429 error`);
                        vertexStats.totalFailures++;
                        return result;  // Return the error response
                    }

                    // Schedule retry with exponential backoff + jitter
                    const jitter = Math.random() * 1000; // 0-1000ms random jitter
                    const delay = (RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)) + jitter;
                    jobLog(`⏳ RETRY_SCHEDULED_429: waiting ${Math.floor(delay)}ms (base + jitter) before retry ${attempt + 1}`);

                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;  // Retry
                }
            }

            // Success logging
            jobLog(`✅ VERTEX_ATTEMPT_SUCCESS: attempt=${attempt}/${MAX_RETRIES}`);
            jobLog(`   Duration: ${duration}ms`);
            jobLog(`   Total time (including retries): ${totalDuration}ms`);

            if (attempt > 1) {
                jobLog(`🎯 RETRY_SUCCESS: Succeeded after ${attempt} attempts`);
                vertexStats.successAfterRetry++;
            } else {
                vertexStats.successFirstAttempt++;
            }
            vertexStats.retriesByAttempt[attempt]++;

            return result;

        } catch (error) {
            lastError = error;
            const duration = Date.now() - attemptStart;
            const totalDuration = Date.now() - startTime;

            // Error logging
            jobLog(`❌ VERTEX_ATTEMPT_FAILED: attempt=${attempt}/${MAX_RETRIES}`);
            jobLog(`   Error code: ${error.code || 'unknown'}`);
            jobLog(`   Error message: ${error.message}`);
            jobLog(`   Duration: ${duration}ms`);
            jobLog(`   Total time: ${totalDuration}ms`);

            // Track error codes
            const errorCode = error.code || 'UNKNOWN';
            vertexStats.errorCodes[errorCode] = (vertexStats.errorCodes[errorCode] || 0) + 1;

            // Retry decision logic
            const isRetryableError =
                error.code === 'ETIMEDOUT' ||
                error.code === 'ECONNRESET' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'ECONNREFUSED' ||
                error.code === 'EPIPE' ||
                error.message?.includes('socket hang up');

            const hasRetriesLeft = attempt < MAX_RETRIES;
            const shouldRetry = isRetryableError && hasRetriesLeft;

            jobLog(`🤔 RETRY_DECISION:`);
            jobLog(`   Is retryable error: ${isRetryableError ? '✅ YES' : '❌ NO'}`);
            jobLog(`   Error type: ${errorCode}`);
            jobLog(`   Has retries left: ${hasRetriesLeft ? `✅ YES (${MAX_RETRIES - attempt} remaining)` : '❌ NO (exhausted)'}`);
            jobLog(`   Will retry: ${shouldRetry ? '✅ YES' : '❌ NO'}`);

            if (!shouldRetry) {
                jobLog(`🛑 RETRY_EXHAUSTED: returning empty result after ${attempt} attempts`);
                jobLog(`   Final error: ${errorCode} - ${error.message}`);
                vertexStats.totalFailures++;
                throw error;  // Re-throw to be caught by caller
            }

            // Exponential backoff delay + jitter
            const jitter = Math.random() * 1000; // 0-1000ms random jitter
            const delay = (RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)) + jitter;
            jobLog(`⏳ RETRY_SCHEDULED: waiting ${Math.floor(delay)}ms (base + jitter) before retry ${attempt + 1}`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should never reach here, but just in case
    throw lastError || new Error('Max retries exceeded');
}

async function httpsPostJson(url, payload, headers, timeoutMs = 60000) {
    // 🔍 DIAGNOSTIC: Increment concurrent call counter
    activeVertexCalls++;
    if (activeVertexCalls > peakConcurrency) {
        peakConcurrency = activeVertexCalls;
    }

    return await new Promise((resolve, reject) => {
        const u = new URL(url);
        const body = JSON.stringify(payload);

        // 🔍 DIAGNOSTIC: Check HTTP agent state BEFORE making request
        const globalAgent = https.globalAgent;
        const hostname = u.hostname;
        const socketKey = `${hostname}:443:`;

        const activeSockets = globalAgent.sockets[socketKey] || [];
        const freeSockets = globalAgent.freeSockets[socketKey] || [];
        const queuedRequests = globalAgent.requests[socketKey] || [];

        // Track socket ages and reuse count
        const socketAges = freeSockets.map(s => Date.now() - (s._socketStart || Date.now()));
        const avgSocketAge = socketAges.length > 0 ? socketAges.reduce((a,b) => a+b, 0) / socketAges.length : 0;
        const oldestSocket = socketAges.length > 0 ? Math.max(...socketAges) : 0;

        jobLog(`🔍 SOCKET DIAG [call ${activeVertexCalls}/${peakConcurrency} peak]:`);
        jobLog(`   maxSockets: ${globalAgent.maxSockets}`);
        jobLog(`   active sockets: ${activeSockets.length}`);
        jobLog(`   free sockets: ${freeSockets.length}`);
        jobLog(`   queued requests: ${queuedRequests.length}`);
        jobLog(`   hostname: ${hostname}`);
        jobLog(`🔧 DIAG_SOCKET_AGES: avg=${Math.round(avgSocketAge)}ms, oldest=${Math.round(oldestSocket)}ms, free_sockets_detail=${freeSockets.length}`);
        jobLog(`🔧 DIAG_CONCURRENCY_SNAPSHOT: current=${activeVertexCalls}, peak=${peakConcurrency}, utilization=${((activeVertexCalls/Math.max(peakConcurrency,1))*100).toFixed(1)}%`);

        const requestStartTime = Date.now();
        const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
            let data = '';
            res.on('data', c => (data += c));
            res.on('end', () => {
                // 🔍 DIAGNOSTIC: Decrement counter when complete
                activeVertexCalls--;
                const requestDuration = Date.now() - requestStartTime;

                // Log successful completion with socket state
                const socketReused = req.socket?._reusedSocket || false;
                const socketAge = req.socket?._socketStart ? Date.now() - req.socket._socketStart : 'unknown';

                jobLog(`🔍 SOCKET FREED: active calls now ${activeVertexCalls}`);
                jobLog(`✅ DIAG_REQUEST_SUCCESS: duration=${requestDuration}ms, socket_reused=${socketReused}, socket_age=${socketAge}ms, response_bytes=${data.length}`);

                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve({ raw: data });
                }
            });
        });

        // 🔍 DIAGNOSTIC: Track socket lifecycle events
        req.on('socket', (socket) => {
            const isReused = socket._reusedSocket || false;
            const socketId = socket.remoteAddress ? `${socket.remoteAddress}:${socket.remotePort}` : 'not-connected-yet';

            // Track socket start time for age calculation
            if (!socket._socketStart) {
                socket._socketStart = Date.now();
            }
            const socketAge = Date.now() - (socket._socketStart || Date.now());

            jobLog(`🔌 SOCKET_ASSIGNED: id=${socketId}`);
            jobLog(`   Reused: ${isReused ? '✅ YES (from pool)' : '❌ NO (new connection)'}`);
            jobLog(`   Destroyed: ${socket.destroyed}`);
            jobLog(`   Writable: ${socket.writable}`);
            jobLog(`   Readable: ${socket.readable}`);
            jobLog(`🔧 DIAG_SOCKET_ASSIGNED: socket_id=${socketId}, reused=${isReused}, age_ms=${socketAge}, destroyed=${socket.destroyed}, writable=${socket.writable}`);

            // Track socket reuse statistics
            if (isReused) {
                vertexStats.socketReusedCount++;
            } else {
                vertexStats.socketNewCount++;
            }

            socket.on('connect', () => {
                const connectedId = `${socket.remoteAddress}:${socket.remotePort}`;
                jobLog(`🔌 SOCKET_CONNECTED: id=${connectedId}`);
            });

            socket.on('close', (hadError) => {
                const ageAtClose = socket._socketStart ? Date.now() - socket._socketStart : 'unknown';
                jobLog(`🔌 SOCKET_CLOSED: id=${socketId}, hadError=${hadError}`);
                jobLog(`🔧 DIAG_SOCKET_CLOSED: socket_id=${socketId}, had_error=${hadError}, age_at_close=${ageAtClose}ms`);
            });

            socket.on('error', (err) => {
                const socketAgeAtError = socket._socketStart ? Date.now() - socket._socketStart : 'unknown';
                jobLog(`🔌 SOCKET_ERROR: id=${socketId}, error=${err.code || err.message}`);
                jobLog(`🔧 DIAG_SOCKET_ERROR: socket_id=${socketId}, error_code=${err.code}, error_msg=${err.message}, socket_age=${socketAgeAtError}ms, reused=${isReused}`);
            });
        });

        // Implement timeout to prevent indefinite hangs
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            activeVertexCalls--;
            const error = new Error(`Request timeout after ${timeoutMs}ms`);
            error.code = 'ETIMEDOUT';
            reject(error);
        });

        req.on('error', (err) => {
            // 🔍 DIAGNOSTIC: Enhanced error logging with socket state
            activeVertexCalls--;
            const socketReused = req.socket?._reusedSocket || false;
            const socketDestroyed = req.socket?.destroyed || false;
            const socketAge = req.socket?._socketStart ? Date.now() - req.socket._socketStart : 'unknown';

            // Capture full socket pool state at error time
            const errorSocketState = {
                active: (globalAgent.sockets[socketKey] || []).length,
                free: (globalAgent.freeSockets[socketKey] || []).length,
                queued: (globalAgent.requests[socketKey] || []).length
            };

            jobLog(`🔍 REQUEST ERROR: ${err.message}`);
            jobLog(`   error code: ${err.code}`);
            jobLog(`   socket reused: ${socketReused}`);
            jobLog(`   socket destroyed: ${socketDestroyed}`);
            jobLog(`   active calls: ${activeVertexCalls}`);
            jobLog(`   peak concurrency: ${peakConcurrency}`);

            // Enhanced diagnostic logging
            jobLog(`❌ DIAG_ERROR_CONTEXT: error_code=${err.code}, error_msg=${err.message}`);
            jobLog(`🔧 DIAG_ERROR_SOCKET: socket_reused=${socketReused}, socket_age=${socketAge}ms, socket_destroyed=${socketDestroyed}`);
            jobLog(`🔧 DIAG_ERROR_POOL: active=${errorSocketState.active}, free=${errorSocketState.free}, queued=${errorSocketState.queued}`);
            jobLog(`🔧 DIAG_ERROR_CONCURRENCY: current_calls=${activeVertexCalls}, peak_calls=${peakConcurrency}, utilization=${((activeVertexCalls/Math.max(peakConcurrency,1))*100).toFixed(1)}%`);

            reject(err);
        });

        req.write(body);
        req.end();
    });
}
// REMOVED: groundedFreeform function - replaced with deterministic vertexGenerate
// Service account token generation
async function getServiceAccountToken(sa, scope) {
    jobLog('🔍 TOKEN DEBUG 1: getServiceAccountToken called');
    jobLog('🔍 TOKEN DEBUG 2: sa type:', typeof sa);
    jobLog('🔍 TOKEN DEBUG 3: sa is null/undefined:', sa === null || sa === undefined);
    jobLog('🔍 TOKEN DEBUG 4: sa keys:', sa ? Object.keys(sa) : 'NO SA OBJECT');
    jobLog('🔍 TOKEN DEBUG 5: sa.private_key exists:', !!sa?.private_key);
    jobLog('🔍 TOKEN DEBUG 6: sa.private_key type:', typeof sa?.private_key);
    jobLog('🔍 TOKEN DEBUG 7: sa.private_key length:', sa?.private_key?.length || 'NO LENGTH');
    jobLog('🔍 TOKEN DEBUG 8: sa.client_email:', sa?.client_email || 'NO CLIENT EMAIL');

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
    const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const unsigned = `${base64url(header)}.${base64url(claims)}`;
    // Import crypto synchronously for ES modules
    const { createSign } = await import('node:crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(unsigned);
    jobLog('🔍 TOKEN DEBUG 9: About to call sign.sign(sa.private_key)');
    jobLog('🔍 TOKEN DEBUG 10: Final sa.private_key check:', !!sa.private_key);

    // Fix private key format - replace literal \n with actual newlines
    const formattedPrivateKey = sa.private_key.replace(/\\n/g, '\n');
    jobLog('🔍 TOKEN DEBUG 11: Private key formatted, checking format...');

    const signature = sign.sign(formattedPrivateKey).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 60000);
    if (!resp?.access_token)
        throw new Error('sa-token-failed');
    return resp.access_token;
}
async function httpsPostForm(url, body, headers, timeoutMs) {
    return await new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try {
                resolve(JSON.parse(data));
            }
            catch {
                resolve(null);
            } });
        });

        // Implement timeout to prevent indefinite hangs
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            const error = new Error(`Request timeout after ${timeoutMs}ms`);
            error.code = 'ETIMEDOUT';
            reject(error);
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// Direct vertex generate function for LLM parsing
export async function vertexGenerate(opts) {
    const caller = opts.caller || 'unknown';
    const callId = `${caller}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    jobLog(`📞 VERTEX_CALL from ${caller}, call_id=${callId}`);
    jobLog(`🔧 DIAG_CALL_START: call_id=${callId}, caller=${caller}, grounded=${opts.grounded}, timeout=${opts.timeoutMs}ms`);
    jobLog(`🔍 VERTEX DEBUG 1: vertexGenerate called with opts keys:`, Object.keys(opts));
    jobLog(`🔍 VERTEX DEBUG 2: projectId="${opts.projectId}", location="${opts.location}", model="${opts.model}"`);
    jobLog(`🔍 VERTEX DEBUG 3: prompt length=${opts.prompt?.length}, grounded=${opts.grounded}, json=${opts.json}`);
    jobLog(`🔍 VERTEX DEBUG 4: timeoutMs=${opts.timeoutMs}`);

    jobLog(`🔍 VERTEX DEBUG 5: Getting service account token`);
    // Accept either opts.token (v13.3 style) or opts.sa (legacy style)
    const token = opts.token || await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
    jobLog(`🔍 VERTEX DEBUG 6: Token obtained, length=${token?.length}`);

    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
    jobLog(`🔍 VERTEX DEBUG 7: Endpoint=${endpoint}`);

    const payload = {
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
            temperature: 0, // Maximum determinism
            seed: 12345, // Fixed seed for reproducibility
            maxOutputTokens: 8192, // Maximum tokens for Gemini 2.0 Flash on Vertex AI (reduced from 65535)
            ...(opts.json ? { responseMimeType: 'application/json' } : {})
        },
    };

    // Use legacy grounding tool name expected by this project
    if (opts.grounded)
        payload.tools = [{ google_search: {} }];
    if (opts.responseSchema)
        payload.generationConfig.responseSchema = opts.responseSchema;

    jobLog(`🔍 VERTEX DEBUG 8: Payload created, contents length=${payload.contents.length}`);
    jobLog(`🔍 VERTEX DEBUG 9: Payload generationConfig:`, JSON.stringify(payload.generationConfig));
    jobLog(`🔍 VERTEX DEBUG 10: About to call httpsPostJson`);

    // Enhanced logging for future analysis
    const callType = opts.grounded ? 'GROUNDED' : 'NON-GROUNDED';
    const startTime = Date.now();
    vertexStats.totalCalls++;

    jobLog(`📊 VERTEX_CALL_START: type=${callType}, grounded=${opts.grounded}, json=${opts.json}, timeout=${opts.timeoutMs}ms`);
    jobLog(`🔬 IMPLEMENTATION: Using retry logic v1.0 with exponential backoff`);
    jobLog(`🔬 AGENT_CONFIG: freeSocketTimeout=${https.globalAgent.options.freeSocketTimeout}ms, maxSockets=${https.globalAgent.maxSockets}`);

    let res;
    try {
        // Use retry wrapper instead of direct httpsPostJson call
        res = await httpsPostJsonWithRetry(
            endpoint,
            payload,
            { Authorization: `Bearer ${token}` },
            opts.timeoutMs,
            callType
        );
    } catch (error) {
        const duration = Date.now() - startTime;
        if (error.code === 'ETIMEDOUT') {
            jobLog(`❌ VERTEX_TIMEOUT_ERROR: type=${callType}, duration=${duration}ms, timeout=${opts.timeoutMs}ms`);
            jobLog(`❌ VERTEX_TIMEOUT_DETAILS: caller=${caller}, error=${error.message}`);
        } else {
            jobLog(`❌ VERTEX_HTTP_ERROR: type=${callType}, duration=${duration}ms, error=${error.code || 'unknown'}`);
            jobLog(`❌ VERTEX_HTTP_ERROR_DETAILS: caller=${caller}, message=${error.message}`);
        }
        jobLog(`📊 VERTEX_CALL_FAILED: type=${callType}, duration=${duration}ms, error=${error.code}`);

        // Log statistics for this failed call
        logVertexStats();

        return '';
    }

    const duration = Date.now() - startTime;
    jobLog(`📊 VERTEX_CALL_COMPLETE: type=${callType}, duration=${duration}ms, success=${!!res}`);
    jobLog(`🔍 VERTEX DEBUG 11: httpsPostJson returned, response type:`, typeof res);
    jobLog(`🔍 VERTEX DEBUG 12: Response keys:`, res ? Object.keys(res) : 'null');
    jobLog(`🔍 VERTEX DEBUG 13: Full response:`, JSON.stringify(res, null, 2));

    if (!res) {
        jobLog(`🔍 VERTEX DEBUG 14: NULL RESPONSE - returning empty string`);
        jobLog(`❌ VERTEX_EXIT_NULL_RESPONSE: caller=${caller}`);
        return '';
    }

    if (!res.candidates) {
        jobLog(`🔍 VERTEX DEBUG 15: NO CANDIDATES - response:`, res);
        if (res.error) {
            jobLog(`🔍 VERTEX DEBUG 15.1: ERROR DETAILS:`, JSON.stringify(res.error, null, 2));
            const errorCode = res.error.code || 'unknown';
            const errorStatus = res.error.status || 'unknown';
            jobLog(`❌ VERTEX_EXIT_NO_CANDIDATES: caller=${caller}, reason=${errorStatus}, httpCode=${errorCode}`);
        } else {
            jobLog(`❌ VERTEX_EXIT_NO_CANDIDATES: caller=${caller}, reason=NO_ERROR_OBJECT`);
        }
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 16: Candidates found, length=${res.candidates.length}`);

    if (!res.candidates[0]) {
        jobLog(`🔍 VERTEX DEBUG 17: NO FIRST CANDIDATE`);
        jobLog(`❌ VERTEX_EXIT_NO_FIRST_CANDIDATE: caller=${caller}`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 18: First candidate:`, JSON.stringify(res.candidates[0], null, 2));

    if (!res.candidates[0].content) {
        jobLog(`🔍 VERTEX DEBUG 19: NO CONTENT in first candidate`);
        jobLog(`❌ VERTEX_EXIT_NO_CONTENT: caller=${caller}`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 20: Content found:`, JSON.stringify(res.candidates[0].content, null, 2));

    if (!res.candidates[0].content.parts) {
        jobLog(`🔍 VERTEX DEBUG 21: NO PARTS in content`);
        jobLog(`❌ VERTEX_EXIT_NO_PARTS: caller=${caller}`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 22: Parts found, length=${res.candidates[0].content.parts.length}`);

    const parts = res.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
        jobLog(`🔍 VERTEX DEBUG 23.${i}: Part ${i}:`, JSON.stringify(parts[i], null, 2));
    }

    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    jobLog(`🔍 VERTEX DEBUG 24: Final extracted text: "${text}"`);
    jobLog(`🔍 VERTEX DEBUG 25: Final text length: ${text.length}`);
    jobLog(`✅ VERTEX_SUCCESS: caller=${caller}, textLength=${text.length}`);

    // Log cumulative statistics periodically (every 10 calls)
    if (vertexStats.totalCalls % 10 === 0) {
        logVertexStats();
    }

    return text;
}

// Authentication helper functions for vertexDeduplicator
export async function getCloudAuthClient() {
    const b64 = process.env.GCP_SA_JSON_B64;
    const jsonPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;

    authClientInstanceCount++;
    const instanceId = authClientInstanceCount;
    jobLog(`🔑 DIAG_AUTH_CLIENT_CREATE: instance_id=${instanceId}, has_b64=${!!b64}, has_json_path=${!!jsonPath}`);

    if (b64 || jsonPath) {
        let json;
        if (b64) {
            // Base64-encoded JSON credentials
            json = Buffer.from(b64, 'base64').toString('utf8');
        } else if (jsonPath) {
            // File path to JSON credentials
            json = fs.readFileSync(jsonPath, 'utf-8');
        }
        const credentials = JSON.parse(json);
        const auth = new GoogleAuth({ credentials, scopes: VERTEX_SCOPES });
        jobLog(`🔑 DIAG_AUTH_CLIENT_CREATED: instance_id=${instanceId}, type=explicit_credentials`);
        return auth.getClient();
    }

    // Default: keyless ADC on Cloud Run
    const auth = new GoogleAuth({ scopes: VERTEX_SCOPES });
    jobLog(`🔑 DIAG_AUTH_CLIENT_CREATED: instance_id=${instanceId}, type=ADC`);
    return auth.getClient();
}

export async function resolveProjectId(auth) {
    const explicit =
        process.env.VERTEX_AI_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT;
    if (explicit) return explicit;
    const a = auth ?? new GoogleAuth();
    const pid = await a.getProjectId();
    return typeof pid === 'string' ? pid : String(pid);
}

export function resolveLocation() {
    return process.env.VERTEX_AI_LOCATION || 'us-central1';
}

export async function getAccessTokenViaAuth() {
    const now = Date.now();

    // Check if token is cached and fresh (within 55 minutes = 3300000ms)
    if (tokenCache.token && tokenCache.fetchedAt && (now - tokenCache.fetchedAt) < 3300000) {
        const age = now - tokenCache.fetchedAt;
        jobLog(`🎫 DIAG_TOKEN_CACHE_HIT: age=${age}ms, will_reuse=true`);
        return tokenCache.token;
    }

    jobLog(`🎫 DIAG_TOKEN_FETCH_START: cached=${!!tokenCache.token}, cache_age=${tokenCache.fetchedAt ? now - tokenCache.fetchedAt : 'none'}ms`);
    const fetchStart = Date.now();

    const authClient = await getCloudAuthClient();
    const tokenObj = await authClient.getAccessToken();
    const token = typeof tokenObj === 'string'
        ? tokenObj
        : (tokenObj?.token || tokenObj?.access_token);

    if (!token) throw new Error('Failed to obtain access token via ADC');

    const fetchDuration = Date.now() - fetchStart;
    tokenCache.token = token;
    tokenCache.fetchedAt = Date.now();

    jobLog(`🎫 DIAG_TOKEN_FETCHED: duration=${fetchDuration}ms, length=${token.length}, cached_for_reuse=true`);
    return token;
}
