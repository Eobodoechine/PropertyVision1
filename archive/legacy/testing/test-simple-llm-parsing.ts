import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Vertex AI helper functions
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

async function vertexGenerate(prompt: string): Promise<string> {
  const saPath = process.env.GCP_SA_JSON!;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';

  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 100,
      topP: 0.1,
      topK: 1
    }
  };

  const resp = await httpsPostForm(url, JSON.stringify(payload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, 15000);

  return resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function testSimpleParsing() {
  console.log('🧪 TESTING SIMPLE LLM PROPERTY PARSING');
  console.log('============================================================');

  // Test the problematic case that confused regex
  const testText = "4-bedroom, 2.5-bathroom home with 2,331 sq ft of living area on a 7,111 sq ft lot.";

  console.log(`📄 Test Text: "${testText}"`);
  console.log('');

  // Method 1: Direct extraction
  console.log('🔍 METHOD 1: Direct Question');
  const method1 = await vertexGenerate(`What is the house square footage (not lot size) in this text?

"${testText}"

Give only the number.`);
  console.log(`Response: "${method1}"`);
  console.log('');

  // Method 2: JSON format
  console.log('🔍 METHOD 2: JSON Format');
  const method2 = await vertexGenerate(`Extract house square footage from: "${testText}"

Return JSON format: {"sqft": number}`);
  console.log(`Response: "${method2}"`);
  console.log('');

  // Method 3: Multiple choice
  console.log('🔍 METHOD 3: Multiple Choice');
  const method3 = await vertexGenerate(`In this text: "${testText}"

Which number is the HOUSE square footage?
A) 2,331
B) 7,111

Answer with just the letter and number.`);
  console.log(`Response: "${method3}"`);
  console.log('');

  // Method 4: Step by step
  console.log('🔍 METHOD 4: Step by Step');
  const method4 = await vertexGenerate(`Text: "${testText}"

Step 1: Find all square footage numbers
Step 2: Identify which is house vs lot
Step 3: Return house sqft number only`);
  console.log(`Response: "${method4}"`);
  console.log('');

  console.log('📊 ANALYSIS:');
  console.log('============================================================');
  console.log('The goal is to extract 2,331 (house) not 7,111 (lot)');
  console.log('Best method will clearly distinguish between house and lot size');
}

testSimpleParsing().catch(console.error);