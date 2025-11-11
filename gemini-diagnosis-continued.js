import 'dotenv/config';
import https from 'https';
import { GoogleAuth } from 'google-auth-library';

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

async function callGemini(prompt) {
  const auth = new GoogleAuth({ scopes: VERTEX_SCOPES });
  const token = await auth.getAccessToken();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'durable-ring-475417-g0';
  const location = 'us-central1';
  const model = 'gemini-2.0-flash-exp';

  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192
    }
  };

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(endpoint);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.candidates && response.candidates[0] && response.candidates[0].content) {
            const text = response.candidates[0].content.parts[0].text;
            resolve(text);
          } else if (response.error) {
            reject(new Error(`API Error: ${JSON.stringify(response.error)}`));
          } else {
            reject(new Error(`Unexpected response: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function diagnose() {
  console.log('='.repeat(80));
  console.log('CONTINUING GEMINI DIAGNOSTIC ANALYSIS (Rounds 4-5)');
  console.log('='.repeat(80));
  console.log('');

  console.log('Waiting 30 seconds to avoid quota issues...\n');
  await sleep(30000);

  // Round 4: Ask about Google Cloud quota behavior
  const round4Prompt = `Context about the API being tested:

**Google Cloud Vertex AI API:**
- Uses "Dynamic Shared Quota" (DSQ) system
- Quota is allocated at PROJECT level (not per-worker or per-job)
- DSQ deprioritizes "spiky" traffic patterns
- All 5 jobs hit the same project quota pool

**Test timeline visualization:**
\`\`\`
00:02:48 ████████████████████████████████████ Job 1 (103s, 536 errors)
00:04:32 ────────────────────────────────────████████████████████████████████ Job 2 (97s, 123 errors)
00:05:07 ────────────────────────────────────────────────█ Job 3 (24s, failed)
00:05:30 ──────────────────────────────────────────────────────█ Job 4 (5s, failed)
00:05:31 ───────────────────────────────────────────────────────█ Job 5 (5s, failed)
\`\`\`

**Key timing facts:**
- Job 1 ran completely alone (no other jobs active)
- Job 2 started exactly when Job 1 ended
- Jobs 3-5 ran during Job 2 (brief overlap: 5-24 seconds)

Given that:
- Job 1 had 536 errors while running ALONE
- Job 2 had 123 errors (also mostly alone, except last ~30s with Jobs 3-5)
- Jobs 3-5 failed during brief overlap with Job 2

What might this tell us about quota behavior, and does it affect our ability to conclude the code change was effective?`;

  console.log('ROUND 4: Asking about quota behavior...\n');
  try {
    const response4 = await callGemini(round4Prompt);
    console.log('GEMINI RESPONSE:\n');
    console.log(response4);
    console.log('\n' + '='.repeat(80) + '\n');
  } catch (err) {
    console.log('ERROR in Round 4:', err.message);
    console.log('Continuing to Round 5 after delay...\n');
  }

  console.log('Waiting 30 seconds before Round 5...\n');
  await sleep(30000);

  // Round 5: Final diagnostic question
  const round5Prompt = `Final diagnostic question:

**Goal of the test:** Determine if adding randomized jitter to retry delays reduces HTTP 429 errors.

**What we observed:**
1. Job 1: 536 errors (2.8x WORSE than baseline 193)
2. Job 2: 123 errors (40% BETTER than baseline 193-208)
3. Jobs ran sequentially, not concurrently
4. 88% variance between completed jobs
5. Jobs are 29% faster (97-103s vs 136-139s baseline)
6. Different property address than baseline
7. Jobs 3-5 failed in early phase

**Your diagnosis:**
Can we conclude that jitter reduced 429 errors? If not, what specific information is missing or what assumptions are invalid? What would a proper test look like?`;

  console.log('ROUND 5: Final diagnostic question...\n');
  try {
    const response5 = await callGemini(round5Prompt);
    console.log('GEMINI RESPONSE:\n');
    console.log(response5);
    console.log('\n' + '='.repeat(80) + '\n');
  } catch (err) {
    console.log('ERROR in Round 5:', err.message);
  }

  console.log('DIAGNOSIS COMPLETE');
}

diagnose().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
