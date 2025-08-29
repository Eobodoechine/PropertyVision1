// Test distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Wellington Circle subject
const subjectLat = 33.717826;
const subjectLon = -84.136012;

// Test with sample properties from debug
const properties = [
  { address: "2212 Marbut Farms Gln", lat: 33.723502, lon: -84.132118 },
  { address: "6454 Wellington Chase Ct", lat: 33.718356, lon: -84.127034 },
  { address: "2240 Cherokee Valley Dr", lat: 33.722413, lon: -84.140199 }
];

console.log('Distance calculations:');
properties.forEach(prop => {
  const distance = calculateDistance(subjectLat, subjectLon, prop.lat, prop.lon);
  console.log(`${prop.address}: ${distance.toFixed(1)} miles`);
});
