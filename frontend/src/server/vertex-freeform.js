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
// REMOVED: groundedFreeform function - replaced with deterministic vertexGenerate
// Service account token generation
async function getServiceAccountToken(sa, scope) {
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
    const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
    const endpoint = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;
    const payload = {
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
            temperature: 0, // Maximum determinism
            seed: 12345, // Fixed seed for reproducibility
            maxOutputTokens: 65535, // Maximum tokens for Gemini 2.5 Pro on Vertex AI (2025)
            ...(opts.json ? { responseMimeType: 'application/json' } : {})
        },
    };
    // Use legacy grounding tool name expected by this project
    if (opts.grounded)
        payload.tools = [{ google_search: {} }];
    if (opts.responseSchema)
        payload.generationConfig.responseSchema = opts.responseSchema;
    const res = await httpsPostJson(endpoint, payload, { Authorization: `Bearer ${token}` }, opts.timeoutMs);
    const text = res?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    return text;
}
