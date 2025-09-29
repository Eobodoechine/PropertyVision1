import 'dotenv/config';
import https from 'https';
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
console.log('🚨🚨🚨 VERTEX-FREEFORM.JS LOADED - TOKEN DEBUG VERSION 🚨🚨🚨');
// REMOVED: groundedFreeform function - replaced with deterministic vertexGenerate
// Service account token generation
async function getServiceAccountToken(sa, scope) {
    console.log('🔍 TOKEN DEBUG 1: getServiceAccountToken called');
    console.log('🔍 TOKEN DEBUG 2: sa type:', typeof sa);
    console.log('🔍 TOKEN DEBUG 3: sa is null/undefined:', sa === null || sa === undefined);
    console.log('🔍 TOKEN DEBUG 4: sa keys:', sa ? Object.keys(sa) : 'NO SA OBJECT');
    console.log('🔍 TOKEN DEBUG 5: sa.private_key exists:', !!sa?.private_key);
    console.log('🔍 TOKEN DEBUG 6: sa.private_key type:', typeof sa?.private_key);
    console.log('🔍 TOKEN DEBUG 7: sa.private_key length:', sa?.private_key?.length || 'NO LENGTH');
    console.log('🔍 TOKEN DEBUG 8: sa.client_email:', sa?.client_email || 'NO CLIENT EMAIL');

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
    console.log('🔍 TOKEN DEBUG 9: About to call sign.sign(sa.private_key)');
    console.log('🔍 TOKEN DEBUG 10: Final sa.private_key check:', !!sa.private_key);
    const signature = sign.sign(sa.private_key).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const assertion = `${unsigned}.${signature}`;
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);
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
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// Direct vertex generate function for LLM parsing
export async function vertexGenerate(opts) {
    console.log(`🔍 VERTEX DEBUG 1: vertexGenerate called with opts keys:`, Object.keys(opts));
    console.log(`🔍 VERTEX DEBUG 2: projectId="${opts.projectId}", location="${opts.location}", model="${opts.model}"`);
    console.log(`🔍 VERTEX DEBUG 3: prompt length=${opts.prompt?.length}, grounded=${opts.grounded}, json=${opts.json}`);
    console.log(`🔍 VERTEX DEBUG 4: timeoutMs=${opts.timeoutMs}`);

    console.log(`🔍 VERTEX DEBUG 5: Getting service account token`);
    const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
    console.log(`🔍 VERTEX DEBUG 6: Token obtained, length=${token?.length}`);

    const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
    console.log(`🔍 VERTEX DEBUG 7: Endpoint=${endpoint}`);

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

    console.log(`🔍 VERTEX DEBUG 8: Payload created, contents length=${payload.contents.length}`);
    console.log(`🔍 VERTEX DEBUG 9: Payload generationConfig:`, JSON.stringify(payload.generationConfig));
    console.log(`🔍 VERTEX DEBUG 10: About to call httpsPostJson`);

    const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);

    console.log(`🔍 VERTEX DEBUG 11: httpsPostJson returned, response type:`, typeof res);
    console.log(`🔍 VERTEX DEBUG 12: Response keys:`, res ? Object.keys(res) : 'null');
    console.log(`🔍 VERTEX DEBUG 13: Full response:`, JSON.stringify(res, null, 2));

    if (!res) {
        console.log(`🔍 VERTEX DEBUG 14: NULL RESPONSE - returning empty string`);
        return '';
    }

    if (!res.candidates) {
        console.log(`🔍 VERTEX DEBUG 15: NO CANDIDATES - response:`, res);
        if (res.error) {
            console.log(`🔍 VERTEX DEBUG 15.1: ERROR DETAILS:`, JSON.stringify(res.error, null, 2));
        }
        return '';
    }

    console.log(`🔍 VERTEX DEBUG 16: Candidates found, length=${res.candidates.length}`);

    if (!res.candidates[0]) {
        console.log(`🔍 VERTEX DEBUG 17: NO FIRST CANDIDATE`);
        return '';
    }

    console.log(`🔍 VERTEX DEBUG 18: First candidate:`, JSON.stringify(res.candidates[0], null, 2));

    if (!res.candidates[0].content) {
        console.log(`🔍 VERTEX DEBUG 19: NO CONTENT in first candidate`);
        return '';
    }

    console.log(`🔍 VERTEX DEBUG 20: Content found:`, JSON.stringify(res.candidates[0].content, null, 2));

    if (!res.candidates[0].content.parts) {
        console.log(`🔍 VERTEX DEBUG 21: NO PARTS in content`);
        return '';
    }

    console.log(`🔍 VERTEX DEBUG 22: Parts found, length=${res.candidates[0].content.parts.length}`);

    const parts = res.candidates[0].content.parts;
    for (let i = 0; i < parts.length; i++) {
        console.log(`🔍 VERTEX DEBUG 23.${i}: Part ${i}:`, JSON.stringify(parts[i], null, 2));
    }

    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    console.log(`🔍 VERTEX DEBUG 24: Final extracted text: "${text}"`);
    console.log(`🔍 VERTEX DEBUG 25: Final text length: ${text.length}`);

    return text;
}
