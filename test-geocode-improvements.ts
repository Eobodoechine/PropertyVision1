import https from 'https';
import crypto from 'crypto';

// Configuration
const GEO_PROXY_URL = 'https://geo-proxy-839845580521.us-central1.run.app';
const PROXY_SHARED_KEY = process.env.PROXY_SHARED_KEY || '';
const TEST_ADDRESS = '430 burgundy terrace, atlanta, ga, 30354';

// Keep-alive agent for connection reuse
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  keepAliveMsecs: 30000
});

// Geocode via proxy WITH improvements
async function geocodeViaProxyImproved(
  address: string,
  timeoutMs: number,
  maxRetries: number = 3
): Promise<{ lat: number; lon: number } | null> {

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const t0 = Date.now();

    try {
      const result = await new Promise<{ lat: number; lon: number } | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const body = JSON.stringify({ address });
        const url = new URL(`${GEO_PROXY_URL}/geocode`);

        const req = https.request({
          method: 'POST',
          hostname: url.hostname,
          path: url.pathname,
          agent: keepAliveAgent,  // ✅ USE KEEP-ALIVE AGENT
          headers: {
            'content-type': 'application/json',
            'x-proxy-key': PROXY_SHARED_KEY,
            'content-length': Buffer.byteLength(body).toString()
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            clearTimeout(timer);
            const total = Date.now() - t0;
            console.log(`✅ Attempt ${attempt + 1}: Response in ${total}ms (status: ${res.statusCode})`);

            try {
              const j = JSON.parse(data);
              const first = j?.results?.[0];
              if (!first) {
                reject(new Error('No results from geocoder'));
                return;
              }
              resolve({
                lat: first.geometry.location.lat,
                lon: first.geometry.location.lng
              });
            } catch (e) {
              reject(new Error(`Parse error: ${e}`));
            }
          });
        });

        req.on('error', (e: any) => {
          clearTimeout(timer);
          reject(new Error(`Request error: ${e.message}`));
        });

        req.write(body);
        req.end();
      });

      // Success - return result
      return result;

    } catch (error: any) {
      const elapsed = Date.now() - t0;
      console.log(`❌ Attempt ${attempt + 1} failed after ${elapsed}ms: ${error.message}`);

      // If last attempt, throw error
      if (attempt === maxRetries - 1) {
        console.log(`💥 All ${maxRetries} attempts failed`);
        return null;
      }

      // Exponential backoff: 500ms, 1000ms, 2000ms
      const backoffMs = 500 * Math.pow(2, attempt);
      console.log(`⏳ Waiting ${backoffMs}ms before retry...`);
      await new Promise(res => setTimeout(res, backoffMs));
    }
  }

  return null;
}

// Original implementation (for comparison)
async function geocodeViaProxyOriginal(
  address: string,
  timeoutMs: number
): Promise<{ lat: number; lon: number } | null> {
  const t0 = Date.now();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log(`❌ Original: Timeout after ${timeoutMs}ms`);
      resolve(null);
    }, timeoutMs);

    const body = JSON.stringify({ address });
    const url = new URL(`${GEO_PROXY_URL}/geocode`);

    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      // ❌ NO AGENT - creates new connection each time
      headers: {
        'content-type': 'application/json',
        'x-proxy-key': PROXY_SHARED_KEY,
        'content-length': Buffer.byteLength(body).toString()
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        const total = Date.now() - t0;
        console.log(`✅ Original: Response in ${total}ms (status: ${res.statusCode})`);

        try {
          const j = JSON.parse(data);
          const first = j?.results?.[0];
          if (!first) return resolve(null);
          resolve({
            lat: first.geometry.location.lat,
            lon: first.geometry.location.lng
          });
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', (e: any) => {
      clearTimeout(timer);
      console.log(`❌ Original: Error - ${e.message}`);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

// Run tests
async function runTests() {
  console.log('🧪 Testing Geocoding Improvements\n');
  console.log(`📍 Test address: ${TEST_ADDRESS}`);
  console.log(`🔗 Geo-proxy: ${GEO_PROXY_URL}\n`);

  if (!PROXY_SHARED_KEY) {
    console.error('❌ PROXY_SHARED_KEY environment variable not set!');
    console.log('\nRun with: PROXY_SHARED_KEY=your-key npx tsx test-geocode-improvements.ts');
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: Original Implementation (5s timeout, no retry)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const t1 = Date.now();
  const result1 = await geocodeViaProxyOriginal(TEST_ADDRESS, 5000);
  const elapsed1 = Date.now() - t1;

  if (result1) {
    console.log(`\n✅ Success: ${result1.lat}, ${result1.lon}`);
  } else {
    console.log(`\n❌ Failed after ${elapsed1}ms`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: Improved Implementation (20s timeout, 3 retries, keep-alive)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const t2 = Date.now();
  const result2 = await geocodeViaProxyImproved(TEST_ADDRESS, 20000, 3);
  const elapsed2 = Date.now() - t2;

  if (result2) {
    console.log(`\n✅ Success: ${result2.lat}, ${result2.lon}`);
  } else {
    console.log(`\n❌ Failed after ${elapsed2}ms`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Original:  ${result1 ? '✅ PASSED' : '❌ FAILED'} (${elapsed1}ms)`);
  console.log(`Improved:  ${result2 ? '✅ PASSED' : '❌ FAILED'} (${elapsed2}ms)`);

  if (result2 && !result1) {
    console.log('\n🎉 Improvements FIXED the issue!');
  } else if (result1 && result2) {
    console.log('\n✅ Both work (improvements may help under load)');
  } else if (!result1 && !result2) {
    console.log('\n⚠️  Both failed - geo-proxy may not be reachable or key is wrong');
  }
}

runTests().catch(console.error);
