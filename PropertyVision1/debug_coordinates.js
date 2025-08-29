const apiKey = process.env.RAPIDAPI_KEY;

async function debugPropertyCoordinates() {
  try {
    const centerLat = 33.717826;
    const centerLon = -84.136012;
    
    const radiusInDegrees = 1 * 0.0145;
    const boundary = [
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
      [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
      [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
    ];
    
    const searchPayload = {
      limit: 5,
      offset: 0,
      boundary: { coordinates: [boundary] },
      status: ["sold"],
      sqft_min: 762,
      sqft_max: 1142
    };
    
    const response = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      },
      body: JSON.stringify(searchPayload)
    });
    
    const data = await response.json();
    const properties = data?.data?.home_search?.results || [];
    
    console.log('🔍 COORDINATE DEBUG: Checking first 3 properties');
    properties.slice(0, 3).forEach((prop, index) => {
      console.log(`Property ${index + 1}:`);
      console.log(`  Address: ${prop.location?.address?.line || 'Unknown'}`);
      console.log(`  Coordinates: lat=${prop.location?.address?.coordinate?.lat || 'MISSING'}, lon=${prop.location?.address?.coordinate?.lon || 'MISSING'}`);
      console.log(`  Location object:`, JSON.stringify(prop.location, null, 2));
      console.log('');
    });
    
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

debugPropertyCoordinates();
