import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { jobLog } from './utils/jobLogger';

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

async function httpsPostJson(url, payload, headers, timeoutMs = 60000) {
    return await new Promise((resolve, reject) => {
        const u = new URL(url);
        const body = JSON.stringify(payload);
        const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString(), ...headers } }, (res) => {
            let data = '';
            res.on('data', c => (data += c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve({ raw: data });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ADC authentication helpers (exported for reuse in other files)
export async function getCloudAuthClient() {
    const b64 = process.env.GCP_SA_JSON_B64;
    const jsonPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;

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
        return auth.getClient();
    }

    // Default: keyless ADC on Cloud Run
    const auth = new GoogleAuth({ scopes: VERTEX_SCOPES });
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
    const authClient = await getCloudAuthClient();
    const tokenObj = await authClient.getAccessToken();
    const token = typeof tokenObj === 'string'
        ? tokenObj
        : (tokenObj?.token || tokenObj?.access_token);
    if (!token) throw new Error('Failed to obtain access token via ADC');
    return token;
}

// Direct vertex generate function for LLM parsing
export async function vertexGenerate(opts) {
    jobLog(`🔍 VERTEX DEBUG 1: vertexGenerate called with opts keys:`, Object.keys(opts));
    jobLog(`🔍 VERTEX DEBUG 2: projectId="${opts.projectId}", location="${opts.location}", model="${opts.model}"`);
    jobLog(`🔍 VERTEX DEBUG 3: prompt length=${opts.prompt?.length}, grounded=${opts.grounded}, json=${opts.json}`);
    jobLog(`🔍 VERTEX DEBUG 4: timeoutMs=${opts.timeoutMs}`);

    // Use token from opts (ADC-generated)
    const token = opts.token;
    jobLog(`🔍 VERTEX DEBUG 6: Token obtained, length=${token?.length}`);

    const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
    jobLog(`🔍 VERTEX DEBUG 7: Endpoint=${endpoint}`);

    const payload = {
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
            temperature: 0, // Maximum determinism
            seed: 12345, // Fixed seed for reproducibility
            maxOutputTokens: opts.maxOutputTokens || 8192, // Allow override, default 8192
            ...(opts.json ? { responseMimeType: 'application/json' } : {})
        },
    };

    // Use legacy grounding tool name expected by this project
    if (opts.grounded)
        payload.tools = [{ google_search: {} }];

    // Function calling takes precedence over responseSchema
    if (opts.functionDeclaration) {
        payload.tools = [{ function_declarations: [opts.functionDeclaration] }];
    } else if (opts.responseSchema) {
        payload.generationConfig.responseSchema = opts.responseSchema;
    }

    jobLog(`🔍 VERTEX DEBUG 8: Payload created, contents length=${payload.contents.length}`);
    jobLog(`🔍 VERTEX DEBUG 9: Payload generationConfig:`, JSON.stringify(payload.generationConfig));
    jobLog(`🔍 VERTEX DEBUG 10: About to call httpsPostJson`);

    // Enhanced logging for future analysis
    const callType = opts.grounded ? 'GROUNDED' : 'NON-GROUNDED';
    const startTime = Date.now();
    jobLog(`📊 VERTEX_CALL_START: type=${callType}, grounded=${opts.grounded}, json=${opts.json}, timeout=${opts.timeoutMs}ms`);

    const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);

    const duration = Date.now() - startTime;
    jobLog(`📊 VERTEX_CALL_COMPLETE: type=${callType}, duration=${duration}ms, success=${!!res}`);
    jobLog(`🔍 VERTEX DEBUG 11: httpsPostJson returned, response type:`, typeof res);
    jobLog(`🔍 VERTEX DEBUG 12: Response keys:`, res ? Object.keys(res) : 'null');
    jobLog(`🔍 VERTEX DEBUG 13: Full response:`, JSON.stringify(res, null, 2));

    if (!res) {
        jobLog(`🔍 VERTEX DEBUG 14: NULL RESPONSE - returning empty string`);
        return '';
    }

    if (!res.candidates) {
        jobLog(`🔍 VERTEX DEBUG 15: NO CANDIDATES - response:`, res);
        if (res.error) {
            jobLog(`🔍 VERTEX DEBUG 15.1: ERROR DETAILS:`, JSON.stringify(res.error, null, 2));
        }
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 16: Candidates found, length=${res.candidates.length}`);

    if (!res.candidates[0]) {
        jobLog(`🔍 VERTEX DEBUG 17: NO FIRST CANDIDATE`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 18: First candidate:`, JSON.stringify(res.candidates[0], null, 2));

    if (!res.candidates[0].content) {
        jobLog(`🔍 VERTEX DEBUG 19: NO CONTENT in first candidate`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 20: Content found:`, JSON.stringify(res.candidates[0].content, null, 2));

    if (!res.candidates[0].content.parts) {
        jobLog(`🔍 VERTEX DEBUG 21: NO PARTS in content`);
        return '';
    }

    jobLog(`🔍 VERTEX DEBUG 22: Parts found, length=${res.candidates[0].content.parts.length}`);

    const parts = res.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
        jobLog(`🔍 VERTEX DEBUG 23.${i}: Part ${i}:`, JSON.stringify(parts[i], null, 2));
    }

    // Check for function call response first
    const functionCallPart = parts.find(p => p.functionCall);
    if (functionCallPart) {
        const functionCall = functionCallPart.functionCall;
        jobLog(`🔍 VERTEX DEBUG 24: Function call detected: ${functionCall.name}`);
        jobLog(`🔍 VERTEX DEBUG 25: Function call args:`, JSON.stringify(functionCall.args));
        // Return the args as JSON string
        return JSON.stringify(functionCall.args);
    }

    // Otherwise extract text as before
    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    jobLog(`🔍 VERTEX DEBUG 24: Final extracted text: "${text}"`);
    jobLog(`🔍 VERTEX DEBUG 25: Final text length: ${text.length}`);

    return text;
}
