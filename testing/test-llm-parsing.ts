import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

// Copy the vertex AI helper functions
function hasServiceAccount(): boolean {
  const p = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
  return Boolean(p && p.trim().length > 0);
}

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

async function vertexGenerate(opts: { sa: any; projectId: string; location: string; model: string; prompt: string; timeoutMs: number }): Promise<string> {
  const token = await getServiceAccountToken(opts.sa, 'https://www.googleapis.com/auth/cloud-platform');
  const url = `https://${opts.location}-aiplatform.googleapis.com/v1/projects/${opts.projectId}/locations/${opts.location}/publishers/google/models/${opts.model}:generateContent`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 200,
      topP: 0.1,
      topK: 1
    }
  };

  const resp = await httpsPostForm(url, JSON.stringify(payload), {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }, opts.timeoutMs);

  return resp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function testLLMParsing() {
  console.log('🤖 TESTING LLM-BASED PROPERTY PARSING vs REGEX');
  console.log('============================================================');

  if (!hasServiceAccount()) {
    console.log('❌ No service account configured - skipping LLM test');
    return;
  }

  const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON as string;
  const sa = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const projectId = sa.project_id;
  const location = 'us-central1';
  const model = 'gemini-2.5-pro';
  const timeoutMs = 15000;

  // Test cases - simulating actual Vertex AI responses that cause parsing issues
  const testCases = [
    {
      name: "Case 1: House size first, lot mentioned later",
      text: "4-bedroom, 2.5-bathroom home with 2,331 sq ft of living area on a 7,111 sq ft lot.",
      expectedSqft: 2331,
      expectedBeds: 4,
      expectedBaths: 2.5
    },
    {
      name: "Case 2: Lot size mentioned first",
      text: "Situated on 7,111 square feet lot, the home offers 2,331 sq ft of interior space.",
      expectedSqft: 2331,
      expectedBeds: null,
      expectedBaths: null
    },
    {
      name: "Case 3: Mixed property description",
      text: "Built in 1998, this property has 2,331 square feet with lot size: 7,111 square feet.",
      expectedSqft: 2331,
      expectedBeds: null,
      expectedBaths: null
    },
    {
      name: "Case 4: Complex description",
      text: "This Bailey Oaks home features 4 bedrooms, 2.5 bathrooms, built 1998. Total 7,111 sqft including lot area, with 2,331 sq ft living space.",
      expectedSqft: 2331,
      expectedBeds: 4,
      expectedBaths: 2.5
    }
  ];

  // LLM extraction function
  async function extractWithLLM(text: string): Promise<{sqft: number | null, beds: number | null, baths: number | null}> {
    const prompt = `Extract property details from this real estate description. Be very precise:

"${text}"

Extract these exact details:
1. House square footage (interior/living space only, NOT lot size)
2. Number of bedrooms
3. Number of bathrooms (use decimals like 2.5 for half baths)

Return ONLY in this exact format:
SQFT: [number or UNKNOWN]
BEDS: [number or UNKNOWN]
BATHS: [number or UNKNOWN]

Examples:
SQFT: 2331
BEDS: 4
BATHS: 2.5`;

    try {
      const response = await vertexGenerate({ sa, projectId, location, model, prompt, timeoutMs });
      console.log(`      🤖 LLM response: ${response.trim()}`);

      // Parse LLM response
      const sqftMatch = response.match(/SQFT:\s*(\d+|UNKNOWN)/i);
      const bedsMatch = response.match(/BEDS:\s*(\d+|UNKNOWN)/i);
      const bathsMatch = response.match(/BATHS:\s*([\d.]+|UNKNOWN)/i);

      return {
        sqft: sqftMatch && sqftMatch[1] !== 'UNKNOWN' ? Number(sqftMatch[1]) : null,
        beds: bedsMatch && bedsMatch[1] !== 'UNKNOWN' ? Number(bedsMatch[1]) : null,
        baths: bathsMatch && bathsMatch[1] !== 'UNKNOWN' ? Number(bathsMatch[1]) : null
      };
    } catch (error) {
      console.log(`      ❌ LLM extraction failed: ${error}`);
      return { sqft: null, beds: null, baths: null };
    }
  }

  // Original regex parsing (simplified)
  function extractWithRegex(text: string): {sqft: number | null, beds: number | null, baths: number | null} {
    const clean = (s: string) => s.replace(/[,\s]/g, '').trim();

    // Original problematic SQFT logic
    const sqftMatch = text.match(/([0-9,]+)\s*(?:sq\s*ft|square\s*feet)/i);
    const sqft = sqftMatch ? Number(clean(sqftMatch[1])) : null;

    // Beds
    const bedsMatch = text.match(/([0-9]{1,2})\s*(?:bedroom|bed|BR)/i);
    const beds = bedsMatch ? Number(bedsMatch[1]) : null;

    // Baths
    const bathsMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bathroom|bath|BA)/i);
    const baths = bathsMatch ? Number(bathsMatch[1]) : null;

    return { sqft, beds, baths };
  }

  console.log('');
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`${i + 1}. ${testCase.name}`);
    console.log(`   Text: "${testCase.text}"`);
    console.log('');

    // Test regex parsing
    const regexResult = extractWithRegex(testCase.text);
    console.log(`   📏 REGEX Results:`);
    console.log(`      SQFT: ${regexResult.sqft} ${regexResult.sqft === testCase.expectedSqft ? '✅' : '❌'}`);
    console.log(`      BEDS: ${regexResult.beds} ${regexResult.beds === testCase.expectedBeds ? '✅' : '❌'}`);
    console.log(`      BATHS: ${regexResult.baths} ${regexResult.baths === testCase.expectedBaths ? '✅' : '❌'}`);

    // Test LLM parsing
    console.log(`   🤖 LLM Results:`);
    const llmResult = await extractWithLLM(testCase.text);
    console.log(`      SQFT: ${llmResult.sqft} ${llmResult.sqft === testCase.expectedSqft ? '✅' : '❌'}`);
    console.log(`      BEDS: ${llmResult.beds} ${llmResult.beds === testCase.expectedBeds ? '✅' : '❌'}`);
    console.log(`      BATHS: ${llmResult.baths} ${llmResult.baths === testCase.expectedBaths ? '✅' : '❌'}`);

    console.log('   ⏱️  Waiting 2 seconds between tests...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('');
  }

  console.log('📊 COMPARISON SUMMARY');
  console.log('============================================================');
  console.log('✅ LLM Parsing Benefits:');
  console.log('   • Context-aware (knows house vs lot size)');
  console.log('   • Natural language understanding');
  console.log('   • Self-adapting to new formats');
  console.log('   • No regex maintenance');
  console.log('');
  console.log('⚠️  Considerations:');
  console.log('   • Slight latency increase (~1-2 seconds per property)');
  console.log('   • Additional API call cost');
  console.log('   • Deterministic with temperature=0');
}

testLLMParsing().catch(console.error);