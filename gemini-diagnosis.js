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

async function diagnose() {
  console.log('='.repeat(80));
  console.log('CONSULTING GEMINI FOR DIAGNOSTIC ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  // Round 1: Present the raw facts
  const round1Prompt = `I ran a test to evaluate a code change (adding randomized "jitter" to retry delays). Here are the raw results:

**Test Setup:**
- 5 jobs submitted at 100ms intervals
- All jobs process the same property address
- Each job makes API calls to Vertex AI (same API we're using now)
- Goal: Reduce HTTP 429 "RESOURCE_EXHAUSTED" errors

**Results:**
Job 1: Started 00:02:48, Ended 00:04:32 (103 seconds)
  - 536 x 429 errors
  - 9,708 log lines
  - Status: Completed successfully

Job 2: Started 00:04:32, Ended 00:06:09 (97 seconds)
  - 123 x 429 errors
  - 12,299 log lines
  - Status: Completed successfully

Job 3: Started 00:05:07, Ended 00:05:31 (24 seconds)
  - 6 x 429 errors
  - 132 log lines
  - Status: Failed (never reached main processing phase)

Job 4: Started 00:05:30, Ended 00:05:35 (5 seconds)
  - 6 x 429 errors
  - 75 log lines
  - Status: Failed (never reached main processing phase)

Job 5: Started 00:05:31, Ended 00:05:36 (5 seconds)
  - 6 x 429 errors
  - 75 log lines
  - Status: Failed (never reached main processing phase)

**Previous Baseline (different property address, day before):**
- Job 1: 193 errors
- Job 2: 208 errors
- Jobs 3-5: Failed immediately

**Additional Facts:**
- Job 1 ended at 00:04:32, Job 2 started at 00:04:32 (no overlap)
- Jobs 3, 4, 5 ran during Job 2's execution
- All jobs use single worker (only one worker was running)
- Job processing duration: Baseline 136-139s, Current test 97-103s

What patterns or anomalies do you notice in this data?`;

  console.log('ROUND 1: Presenting raw data...\n');
  const response1 = await callGemini(round1Prompt);
  console.log('GEMINI RESPONSE:\n');
  console.log(response1);
  console.log('\n' + '='.repeat(80) + '\n');

  // Round 2: Follow up on Gemini's observations
  const round2Prompt = `Based on your analysis, here's additional context:

**Error Distribution by Phase:**

Job 1 (536 total errors):
- Subject Property phase: 50 errors (9%)
- Comparable Search phase: 486 errors (91%)

Job 2 (123 total errors):
- Subject Property phase: 0 errors (0%)
- Comparable Search phase: 123 errors (100%)

Jobs 3-5 (6 errors each):
- Subject Property phase: 6 errors (100%)
- Comparable Search phase: Never reached this phase

**Jitter Implementation:**
- Retry delays are randomized: 1482ms, 1033ms, 1119ms, 1467ms, 1330ms (not fixed at 1000ms, 2000ms, etc.)
- Found 43 jitter messages in Job 1 logs
- Found 16 jitter messages in Job 2 logs
- All retry messages show "(base + jitter)" formula

**Job 1 survived 50 Subject Property errors but completed.**
**Jobs 3-5 could not survive 6 Subject Property errors and failed.**

Given this additional information, what might explain:
1. The 4.4x difference in errors between Job 1 (536) and Job 2 (123)?
2. Why Jobs 3-5 failed with minimal errors while Job 1 succeeded with many errors?`;

  console.log('ROUND 2: Providing phase-specific details...\n');
  const response2 = await callGemini(round2Prompt);
  console.log('GEMINI RESPONSE:\n');
  console.log(response2);
  console.log('\n' + '='.repeat(80) + '\n');

  // Round 3: Ask about statistical validity
  const round3Prompt = `Considering the test results:

**Variance Analysis:**
- Job 1 vs Job 2 error ratio: 4.4:1 (536 vs 123)
- Coefficient of variation: 88%
- Mean errors: 330
- Only 2 completed jobs out of 5

**Baseline comparison:**
- Baseline job 1 vs 2 ratio: 1.08:1 (193 vs 208)
- Coefficient of variation: 5.3%
- Different property address
- Different execution timing

**The question:**
We initially concluded "40% improvement" by comparing Job 2 (123 errors) to baseline (193-208 errors).

Is this comparison statistically valid? What would you need to see to confidently say whether the code change (jitter) improved, worsened, or had no effect on error rates?`;

  console.log('ROUND 3: Asking about statistical validity...\n');
  const response3 = await callGemini(round3Prompt);
  console.log('GEMINI RESPONSE:\n');
  console.log(response3);
  console.log('\n' + '='.repeat(80) + '\n');

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
  const response4 = await callGemini(round4Prompt);
  console.log('GEMINI RESPONSE:\n');
  console.log(response4);
  console.log('\n' + '='.repeat(80) + '\n');

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
  const response5 = await callGemini(round5Prompt);
  console.log('GEMINI RESPONSE:\n');
  console.log(response5);
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('DIAGNOSIS COMPLETE');
}

diagnose().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
