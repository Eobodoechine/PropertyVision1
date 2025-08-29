// Debug subject property details for 3623 Stanford Cir
const apiKey = process.env.RAPIDAPI_KEY;

async function debugSubjectProperty() {
  console.log('🔍 DEBUGGING SUBJECT PROPERTY: 3623 Stanford Cir, Decatur, GA 30034\n');
  
  // Get coordinates first
  const mapsResponse = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('3623 Stanford Cir, Decatur, GA 30034')}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
  const mapsData = await mapsResponse.json();
  
  if (mapsData.results && mapsData.results.length > 0) {
    const location = mapsData.results[0].geometry.location;
    console.log(`📍 Coordinates: ${location.lat}, ${location.lng}`);
    console.log(`📍 Formatted address: ${mapsData.results[0].formatted_address}`);
  }
  
  // Search for the exact property
  const centerLat = 33.7001;
  const centerLon = -84.2908;
  const radiusInDegrees = 0.1 * 0.0145; // Very small radius to find exact property
  
  const searchBoundary = [
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
  ];
  
  const searchPayload = {
    limit: 50,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["for_sale", "sold", "off_market"],
    type: ["single_family"]
  };
  
  console.log('🔍 Searching for exact subject property...\n');
  
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
  
  console.log(`📊 Found ${properties.length} properties in immediate area`);
  
  // Look for Stanford Cir properties
  const stanfordProperties = properties.filter(prop => {
    const address = prop.location?.address?.line || '';
    return address.toLowerCase().includes('stanford');
  });
  
  console.log(`\n🏠 Stanford Cir properties found: ${stanfordProperties.length}`);
  
  stanfordProperties.forEach((prop, i) => {
    const address = prop.location?.address?.line || 'Unknown';
    const sqft = prop.description?.sqft;
    const beds = prop.description?.beds;
    const baths = prop.description?.baths;
    const yearBuilt = prop.description?.year_built;
    const status = prop.status;
    const price = prop.last_sold_price || prop.list_price;
    const soldDate = prop.last_sold_date;
    
    console.log(`\n${i+1}. ${address}`);
    console.log(`   Status: ${status}`);
    console.log(`   Beds/Baths: ${beds || 'null'}/${baths || 'null'}`);
    console.log(`   Size: ${sqft || 'null'} sqft`);
    console.log(`   Year Built: ${yearBuilt || 'null'}`);
    console.log(`   Price: $${price || 'null'}`);
    console.log(`   Sold Date: ${soldDate || 'null'}`);
    
    if (address.includes('3623')) {
      console.log(`   ⭐ THIS IS THE SUBJECT PROPERTY`);
    }
  });
  
  // If we didn't find 3623 Stanford, search wider
  if (!stanfordProperties.some(prop => prop.location?.address?.line?.includes('3623'))) {
    console.log('\n🔍 Subject property not found in immediate area, searching wider...');
    
    const widerRadiusInDegrees = 0.5 * 0.0145;
    const widerSearchBoundary = [
      [centerLon - widerRadiusInDegrees, centerLat - widerRadiusInDegrees],
      [centerLon + widerRadiusInDegrees, centerLat - widerRadiusInDegrees],
      [centerLon + widerRadiusInDegrees, centerLat + widerRadiusInDegrees],
      [centerLon - widerRadiusInDegrees, centerLat + widerRadiusInDegrees],
      [centerLon - widerRadiusInDegrees, centerLat - widerRadiusInDegrees]
    ];
    
    const widerPayload = {
      limit: 200,
      offset: 0,
      boundary: { coordinates: [widerSearchBoundary] },
      status: ["for_sale", "sold", "off_market"],
      type: ["single_family"]
    };
    
    const widerResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      },
      body: JSON.stringify(widerPayload)
    });
    
    const widerData = await widerResponse.json();
    const widerProperties = widerData?.data?.home_search?.results || [];
    
    const widerStanford = widerProperties.filter(prop => {
      const address = prop.location?.address?.line || '';
      return address.toLowerCase().includes('stanford');
    });
    
    console.log(`📊 Wider search found ${widerStanford.length} Stanford Cir properties`);
    
    widerStanford.forEach((prop, i) => {
      const address = prop.location?.address?.line || 'Unknown';
      if (address.includes('3623')) {
        console.log(`\n⭐ FOUND SUBJECT PROPERTY: ${address}`);
        console.log(`   Beds/Baths: ${prop.description?.beds || 'null'}/${prop.description?.baths || 'null'}`);
        console.log(`   Size: ${prop.description?.sqft || 'null'} sqft`);
        console.log(`   Year Built: ${prop.description?.year_built || 'null'}`);
      }
    });
  }
}

debugSubjectProperty().catch(console.error);
