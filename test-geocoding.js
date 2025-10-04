const https = require('https');

const GOOGLE_MAPS_API_KEY = 'AIzaSyC6NducOs7Esf4RG4omIO6OqleLq7Ww1pc';

function geocodeWithTimeout(address, timeoutMs) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let completed = false;

    // Set timeout
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        const elapsed = Date.now() - startTime;
        console.log(`⏰ Geocoding timeout after ${elapsed}ms for ${address}`);
        resolve({ success: false, reason: 'timeout', elapsed });
      }
    }, timeoutMs);

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}&components=country:US&region=us`;

    console.log(`🔍 Starting geocoding request for: ${address}`);
    console.log(`⏱️  Timeout set to: ${timeoutMs}ms`);

    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);

        const elapsed = Date.now() - startTime;

        try {
          const parsed = JSON.parse(data);
          if (parsed.results?.length > 0) {
            const coords = { lat: parsed.results[0].geometry.location.lat, lon: parsed.results[0].geometry.location.lng };
            console.log(`✅ Geocoding success after ${elapsed}ms`);
            console.log(`   Coordinates: ${coords.lat}, ${coords.lon}`);
            console.log(`   Formatted address: ${parsed.results[0].formatted_address}`);
            resolve({ success: true, coords, elapsed, formatted: parsed.results[0].formatted_address });
          } else {
            console.log(`❌ No geocoding results after ${elapsed}ms`);
            console.log(`   API Status: ${parsed.status}`);
            resolve({ success: false, reason: 'no_results', elapsed, status: parsed.status });
          }
        } catch (error) {
          console.log(`❌ JSON parse error after ${elapsed}ms: ${error.message}`);
          resolve({ success: false, reason: 'parse_error', elapsed, error: error.message });
        }
      });
    });

    req.on('error', (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;
      console.log(`❌ Request error after ${elapsed}ms: ${error.message}`);
      resolve({ success: false, reason: 'request_error', elapsed, error: error.message });
    });

    req.on('timeout', () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      const elapsed = Date.now() - startTime;
      console.log(`❌ Socket timeout after ${elapsed}ms`);
      req.destroy();
      resolve({ success: false, reason: 'socket_timeout', elapsed });
    });
  });
}

async function runTests() {
  const testAddress = "2612 clairmont rd, atlanta, ga, 30329";

  console.log('\n========================================');
  console.log('TEST 1: Geocoding with 5-second timeout');
  console.log('========================================\n');
  const result5s = await geocodeWithTimeout(testAddress, 5000);
  console.log(`\nResult:`, result5s);

  console.log('\n\n========================================');
  console.log('TEST 2: Geocoding with 30-second timeout');
  console.log('========================================\n');
  const result30s = await geocodeWithTimeout(testAddress, 30000);
  console.log(`\nResult:`, result30s);

  console.log('\n\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`5s timeout:  ${result5s.success ? 'SUCCESS' : 'FAILED'} (${result5s.elapsed}ms) - ${result5s.reason || 'OK'}`);
  console.log(`30s timeout: ${result30s.success ? 'SUCCESS' : 'FAILED'} (${result30s.elapsed}ms) - ${result30s.reason || 'OK'}`);

  if (result5s.success && result30s.success) {
    console.log('\n✅ CONCLUSION: Both timeouts work. The 5s timeout is sufficient.');
  } else if (!result5s.success && result30s.success) {
    console.log('\n⚠️  CONCLUSION: 5s timeout is TOO SHORT. API takes longer than 5 seconds.');
    console.log(`   Actual response time: ${result30s.elapsed}ms`);
  } else if (!result5s.success && !result30s.success) {
    console.log('\n❌ CONCLUSION: Geocoding is failing for a different reason (not timeout).');
    console.log(`   30s result: ${result30s.reason}`);
  }
}

runTests().catch(console.error);
