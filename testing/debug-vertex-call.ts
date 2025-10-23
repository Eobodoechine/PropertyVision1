import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Copy helper functions
async function getServiceAccountToken(sa: any, scope: string): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: sa.token_uri, exp, iat };
  const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const unsigned = `${base64url(header)}.${base64url(claims)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const resp = await httpsPostForm(sa.token_uri, body.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' }, 20000);
  if (!resp?.access_token) throw new Error('sa-token-failed');
  return resp.access_token as string;
}

async function httpsPostForm(url: string, body: string, headers: Record<string,string>, timeoutMs: number): Promise<any> {
  return await new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch {}; reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function debugVertexCall() {
  console.log('🔍 DEBUGGING VERTEX AI CALL');
  console.log('============================================================');

  const saPath = process.env.GCP_SA_JSON!;
  console.log(`📄 Service Account Path: ${saPath}`);

  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  console.log(`🏢 Project ID: ${sa.project_id}`);
  console.log(`📧 Client Email: ${sa.client_email}`);

  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';

  console.log(`\n🚀 Making Vertex AI call...`);
  console.log(`📍 Location: ${location}`);
  console.log(`🤖 Model: ${model}`);

  try {
    // Get token
    console.log(`\n🔑 Getting access token...`);
    const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
    console.log(`✅ Token obtained (length: ${token.length})`);

    // Make API call
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    console.log(`\n🌐 API URL: ${url}`);

    const payload = {
      contents: [{
        role: 'user',
        parts: [{ text: 'Hello! Can you extract 2331 square feet from this text: "4-bedroom home with 2,331 sq ft of living area"?' }]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 100,
        topP: 0.1,
        topK: 1
      }
    };

    console.log(`\n📤 Payload:`);
    console.log(JSON.stringify(payload, null, 2));

    const resp = await httpsPostForm(url, JSON.stringify(payload), {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }, 15000);

    console.log(`\n📥 Full Response:`);
    console.log(JSON.stringify(resp, null, 2));

    const responseText = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log(`\n📝 Extracted Text: "${responseText}"`);

    if (!responseText) {
      console.log(`❌ No response text found!`);

      // Check for errors
      if (resp?.error) {
        console.log(`🚨 API Error:`, resp.error);
      }

      if (resp?.candidates?.[0]?.finishReason) {
        console.log(`🛑 Finish Reason: ${resp.candidates[0].finishReason}`);
      }
    } else {
      console.log(`✅ Response received successfully!`);
    }

  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
    console.log(`Stack:`, error.stack);
  }
}

debugVertexCall().catch(console.error);