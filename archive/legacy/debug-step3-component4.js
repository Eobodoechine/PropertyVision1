// DEBUG Component 4: Filtering & Validation
import https from 'https';

const TEST_ADDRESS = '185 Jordan Pl, Fayetteville, GA 30215';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

console.log('🔍 TESTING COMPONENT 4: Filtering & Validation');
console.log('===============================================');

// Mock comparable properties from the logs with conflicting data
const TEST_COMPARABLES = [
  {
    address: '165 McElwaney Way, Fayetteville, GA 30215',
    price: 450000,
    sqft: 2885, // First value from logs
    beds: 4,
    baths: 2.5,
    yearBuilt: 1993
  },
  {
    address: '165 McElwaney Way, Fayetteville, GA 30215',
    price: 450000,
    sqft: 2619, // Second value from logs - same property, different sqft!
    beds: 4,
    baths: 2.5,
    yearBuilt: 1993
  },
  {
    address: '611 Bernhard Rd, Fayetteville, GA 30215',
    price: 365500,
    sqft: 2034,
    beds: 3,
    baths: 2,
    yearBuilt: 1996
  },
  {
    address: '235 Surrey Park Dr, Fayetteville, GA 30215',
    price: 428000,
    sqft: 1914,
    beds: 4,
    baths: 2,
    yearBuilt: 1997
  }
];

const SUBJECT_DETAILS = {
  address: TEST_ADDRESS,
  sqft: 2331,
  beds: 4,
  baths: 2.5,
  yearBuilt: 1998,
  lat: 33.4634, // Approximate coordinates for test
  lon: -84.4557
};

async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.log('⚠️  No Google Maps API key, using mock coordinates');
    // Return mock coordinates for test addresses
    const mockCoords = {
      '165 McElwaney Way, Fayetteville, GA 30215': { lat: 33.4623, lon: -84.4234 },
      '611 Bernhard Rd, Fayetteville, GA 30215': { lat: 33.3945, lon: -84.5234 },
      '235 Surrey Park Dr, Fayetteville, GA 30215': { lat: 33.4123, lon: -84.3987 }
    };
    return mockCoords[address] || { lat: 33.45, lon: -84.45 };
  }

  return new Promise((resolve, reject) => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;

    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.status === 'OK' && data.results?.[0]) {
            const location = data.results[0].geometry.location;
            resolve({ lat: location.lat, lon: location.lng });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function validateComparable(comp, subject) {
  const validationResults = {
    comp: comp,
    validations: []
  };

  // Bedroom validation
  const bedroomDiff = Math.abs(comp.beds - subject.beds);
  const bedroomOk = bedroomDiff <= 1;
  validationResults.validations.push({
    test: 'bedroom',
    passed: bedroomOk,
    message: `${comp.beds}BR vs ${subject.beds}BR (diff: ${bedroomDiff} ${bedroomOk ? '≤ 1' : '> 1'})`
  });

  // Size validation (20% variance)
  const sizeVariance = Math.abs(comp.sqft - subject.sqft) / subject.sqft * 100;
  const sizeOk = sizeVariance <= 20;
  validationResults.validations.push({
    test: 'size',
    passed: sizeOk,
    message: `${sizeVariance.toFixed(1)}% variance (${sizeOk ? 'within' : 'exceeds'} 20% limit)`
  });

  return validationResults;
}

async function testFilteringLogic() {
  console.log('🧪 Testing filtering and validation logic');
  console.log(`📍 Subject: ${SUBJECT_DETAILS.address}`);
  console.log(`🏠 Subject specs: ${SUBJECT_DETAILS.sqft}sqft, ${SUBJECT_DETAILS.beds}BR/${SUBJECT_DETAILS.baths}BA`);

  console.log('\n📊 Testing comparable validation:');

  for (const comp of TEST_COMPARABLES) {
    console.log(`\n🔍 FILTERING ${comp.address}: ${comp.beds}BR/${comp.baths}BA, ${comp.sqft}sqft vs Subject: ${SUBJECT_DETAILS.beds}BR/${SUBJECT_DETAILS.baths}BA, ${SUBJECT_DETAILS.sqft}sqft`);

    const validation = validateComparable(comp, SUBJECT_DETAILS);

    validation.validations.forEach(v => {
      const icon = v.passed ? '✅' : '❌';
      const test = v.test.toUpperCase();
      console.log(`   ${icon} ${test} OK ${comp.address}: ${v.message}`);
    });

    // Test distance calculation
    const compCoords = await geocodeAddress(comp.address);
    if (compCoords) {
      const distance = calculateDistance(
        SUBJECT_DETAILS.lat, SUBJECT_DETAILS.lon,
        compCoords.lat, compCoords.lon
      );

      console.log(`   📍 Distance: ${distance.toFixed(2)} miles`);

      // Apply distance filters as per logs
      if (distance > 2.0) {
        console.log(`   ❌ REJECTED ${comp.address}: Too far (${distance.toFixed(2)}mi > 2mi limit)`);
      } else if (distance > 1.0) {
        console.log(`   ⚠️  EXTENDED DISTANCE ${comp.address}: (${distance.toFixed(2)}mi > 1mi ideal)`);
      } else {
        console.log(`   ✅ IDEAL DISTANCE ${comp.address}: (${distance.toFixed(2)}mi ≤ 1mi ideal)`);
      }
    }
  }

  // Test deduplication logic
  console.log('\n🔗 Testing deduplication logic:');

  const addresses = TEST_COMPARABLES.map(c => c.address);
  const uniqueAddresses = [...new Set(addresses)];

  console.log(`Original comparables: ${TEST_COMPARABLES.length}`);
  console.log(`Unique addresses: ${uniqueAddresses.length}`);

  if (TEST_COMPARABLES.length !== uniqueAddresses.length) {
    console.log('🚨 DUPLICATE DETECTED: Same property with different data');

    // Find duplicates
    const addressCounts = {};
    addresses.forEach(addr => {
      addressCounts[addr] = (addressCounts[addr] || 0) + 1;
    });

    Object.entries(addressCounts).forEach(([addr, count]) => {
      if (count > 1) {
        console.log(`   Duplicate: ${addr} appears ${count} times`);
        const duplicates = TEST_COMPARABLES.filter(c => c.address === addr);
        duplicates.forEach((dup, i) => {
          console.log(`     ${i+1}. $${dup.price} - ${dup.sqft}sqft - ${dup.beds}BR/${dup.baths}BA`);
        });
      }
    });
  }
}

testFilteringLogic();