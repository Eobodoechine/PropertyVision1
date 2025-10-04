// Precise Haversine Distance Calculation for 2221 Plantation Dr
// Using exact coordinates from V5 logs

const lat1 = 33.66944;   // Subject: 3128 McKenzie Rd
const lon1 = -84.466385;
const lat2 = 33.681132;  // Comp: 2221 Plantation Dr
const lon2 = -84.496334;

console.log('🏠 HAVERSINE DISTANCE CALCULATION');
console.log('================================');
console.log(`📍 Subject (3128 McKenzie Rd): ${lat1}, ${lon1}`);
console.log(`📍 Comp (2221 Plantation Dr): ${lat2}, ${lon2}`);
console.log('');

// Step 1: Convert degrees to radians
const lat1Rad = lat1 * Math.PI / 180;
const lon1Rad = lon1 * Math.PI / 180;
const lat2Rad = lat2 * Math.PI / 180;
const lon2Rad = lon2 * Math.PI / 180;

console.log('Step 1: Convert to radians');
console.log(`lat1 = ${lat1}° × π/180 = ${lat1Rad.toFixed(7)} radians`);
console.log(`lon1 = ${lon1}° × π/180 = ${lon1Rad.toFixed(7)} radians`);
console.log(`lat2 = ${lat2}° × π/180 = ${lat2Rad.toFixed(7)} radians`);
console.log(`lon2 = ${lon2}° × π/180 = ${lon2Rad.toFixed(7)} radians`);
console.log('');

// Step 2: Calculate differences
const deltaLat = lat2Rad - lat1Rad;
const deltaLon = lon2Rad - lon1Rad;

console.log('Step 2: Calculate differences');
console.log(`Δlat = lat2 - lat1 = ${lat2Rad.toFixed(7)} - ${lat1Rad.toFixed(7)} = ${deltaLat.toFixed(7)} radians`);
console.log(`Δlon = lon2 - lon1 = ${lon2Rad.toFixed(7)} - ${lon1Rad.toFixed(7)} = ${deltaLon.toFixed(7)} radians`);
console.log('');

// Step 3: Apply Haversine formula
const sinDeltaLat2 = Math.sin(deltaLat / 2);
const sinDeltaLon2 = Math.sin(deltaLon / 2);
const cosLat1 = Math.cos(lat1Rad);
const cosLat2 = Math.cos(lat2Rad);

console.log('Step 3: Apply Haversine formula');
console.log(`sin²(Δlat/2) = sin²(${(deltaLat/2).toFixed(7)}) = ${(sinDeltaLat2 * sinDeltaLat2).toFixed(10)}`);
console.log(`sin²(Δlon/2) = sin²(${(deltaLon/2).toFixed(7)}) = ${(sinDeltaLon2 * sinDeltaLon2).toFixed(10)}`);
console.log(`cos(lat1) = cos(${lat1Rad.toFixed(7)}) = ${cosLat1.toFixed(7)}`);
console.log(`cos(lat2) = cos(${lat2Rad.toFixed(7)}) = ${cosLat2.toFixed(7)}`);

const a = (sinDeltaLat2 * sinDeltaLat2) + (cosLat1 * cosLat2 * sinDeltaLon2 * sinDeltaLon2);
console.log(`a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlon/2)`);
console.log(`a = ${(sinDeltaLat2 * sinDeltaLat2).toFixed(10)} + ${cosLat1.toFixed(7)} × ${cosLat2.toFixed(7)} × ${(sinDeltaLon2 * sinDeltaLon2).toFixed(10)}`);
console.log(`a = ${(sinDeltaLat2 * sinDeltaLat2).toFixed(10)} + ${(cosLat1 * cosLat2 * sinDeltaLon2 * sinDeltaLon2).toFixed(10)} = ${a.toFixed(10)}`);
console.log('');

// Step 4: Calculate central angle
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
console.log('Step 4: Calculate central angle');
console.log(`c = 2 × atan2(√a, √(1-a))`);
console.log(`c = 2 × atan2(√${a.toFixed(10)}, √${(1-a).toFixed(10)})`);
console.log(`c = 2 × atan2(${Math.sqrt(a).toFixed(10)}, ${Math.sqrt(1-a).toFixed(10)})`);
console.log(`c = 2 × ${(Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(10)} = ${c.toFixed(10)} radians`);
console.log('');

// Step 5: Calculate distance (using Earth's radius in miles)
const earthRadiusMiles = 3959; // Earth's radius in miles
const distance = earthRadiusMiles * c;

console.log('Step 5: Calculate distance');
console.log(`distance = R × c = ${earthRadiusMiles} miles × ${c.toFixed(10)} = ${distance.toFixed(10)} miles`);
console.log('');

console.log('🎯 FINAL RESULT:');
console.log(`📐 Calculated Distance: ${distance.toFixed(2)} miles`);
console.log(`📐 V5 Reported Distance: 1.90 miles`);
console.log(`📊 Difference: ${Math.abs(distance - 1.90).toFixed(3)} miles`);

// Also test with a simpler haversine implementation to verify
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const simplifiedDistance = haversine(lat1, lon1, lat2, lon2);
console.log(`🔄 Verification with simplified formula: ${simplifiedDistance.toFixed(2)} miles`);