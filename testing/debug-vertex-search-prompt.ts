import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Direct Vertex AI call to understand what's happening at the raw level
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
    req.write(body);
    req.end();
  });
}

async function makeRawVertexCall(prompt: string, temperature: number = 0): Promise<string> {
  const saPath = process.env.GCP_SA_JSON!;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';

  const token = await getServiceAccountToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature,
      maxOutputTokens: 4000,
      topP: 0.8,
      topK: 40
    }
  };

  const resp = await httpsPostForm(url, JSON.stringify(payload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, 20000);

  return resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function debugVertexSearchPrompts() {
  console.log('🔬 VERTEX AI SEARCH PROMPT ANALYSIS');
  console.log('============================================================');

  const address = '185 Jordan Pl, Fayetteville, GA 30215';

  // Test different prompt variations that might affect consistency
  const promptTests = [
    {
      name: 'Bailey Oaks Specific',
      prompt: `Find recently sold homes in Bailey Oaks subdivision near ${address} in Fayetteville GA. Focus on properties sold in the last 18 months.`
    },
    {
      name: 'Deterministic Search',
      prompt: `Search real estate databases for single-family homes sold within 3 miles of ${address} in Fayetteville GA 30215 in the last 18 months. List properties with addresses, sale prices, and sale dates.`
    }
  ];

  for (const test of promptTests) {
    console.log(`\n🔍 Testing: ${test.name}`);
    console.log('------------------------------------------------------------');

    // Run the same prompt 3 times to check consistency
    for (let run = 1; run <= 3; run++) {
      console.log(`   Run ${run}/3...`);

      try {
        const response = await makeRawVertexCall(test.prompt);

        // Extract property addresses from response (simple regex)
        const addresses = [...response.matchAll(/\d+\s+[A-Za-z\s]+(?:Street|St|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Road|Rd|Circle|Cir|Avenue|Ave)[^,\n]*/g)]
          .map(match => match[0].trim())
          .filter(addr => addr.length > 10);

        console.log(`      Found ${addresses.length} potential properties`);

        // Look for Bailey Oaks/Jordan Pl specifically
        const baileyOaksAddresses = addresses.filter(addr =>
          addr.toLowerCase().includes('bailey') ||
          addr.toLowerCase().includes('jordan')
        );

        if (baileyOaksAddresses.length > 0) {
          console.log(`      🎯 Bailey Oaks/Jordan: ${baileyOaksAddresses.length} properties`);
          baileyOaksAddresses.forEach(addr => console.log(`         - ${addr}`));
        } else {
          console.log(`      ⚠️  No Bailey Oaks/Jordan properties found`);
        }

        // Show first few other addresses found
        const otherAddresses = addresses.filter(addr =>
          !addr.toLowerCase().includes('bailey') &&
          !addr.toLowerCase().includes('jordan')
        ).slice(0, 3);

        if (otherAddresses.length > 0) {
          console.log(`      📍 Other properties: ${otherAddresses.join(', ')}`);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error: any) {
        console.log(`      ❌ Error: ${error.message}`);
      }
    }
  }

  console.log('\n🌡️  TEMPERATURE CONSISTENCY TEST');
  console.log('============================================================');

  // Test temperature 0 vs 0.5 for consistency
  const basePrompt = `Find recently sold homes in Bailey Oaks subdivision near ${address} in Fayetteville GA. List addresses and sale information.`;

  for (const temp of [0, 0.5]) {
    console.log(`\nTemperature: ${temp}`);

    for (let run = 1; run <= 2; run++) {
      console.log(`   Run ${run}/2...`);

      try {
        const response = await makeRawVertexCall(basePrompt, temp);
        const baileyCount = (response.toLowerCase().match(/bailey/g) || []).length;
        const jordanCount = (response.toLowerCase().match(/jordan/g) || []).length;

        console.log(`      Bailey mentions: ${baileyCount}, Jordan mentions: ${jordanCount}`);

      } catch (error) {
        console.log(`      ❌ Failed`);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  console.log('\n🎯 INSIGHTS:');
  console.log('============================================================');
  console.log('Analysis complete - check which prompt formats work best');
}

debugVertexSearchPrompts().catch(console.error);