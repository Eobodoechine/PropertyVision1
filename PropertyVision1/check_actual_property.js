// Check actual property details for 3623 Stanford Cir with correct coordinates
const apiKey = process.env.RAPIDAPI_KEY;

async function checkActualProperty() {
  console.log('🔍 CHECKING ACTUAL 3623 STANFORD CIR PROPERTY DETAILS\n');
  
  // Use CORRECT coordinates from Google Maps
  const centerLat = 33.6743599;  // Correct latitude
  const centerLon = -84.2175796; // Correct longitude
  
  console.log(`📍 Using CORRECT coordinates: ${centerLat}, ${centerLon}`);
  
  const radiusInDegrees = 0.2 * 0.0145; // Small radius around exact location
  
  const searchBoundary = [
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
  ];
  
  const searchPayload = {
    limit: 100,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["for_sale", "sold", "off_market"],
    type: ["single_family"]
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
  
  console.log(`📊 Found ${properties.length} properties in correct area`);
  
  // Look for Stanford Cir properties
  const stanfordProperties = properties.filter(prop => {
    const address = prop.location?.address?.line || '';
    return address.toLowerCase().includes('stanford');
  });
  
  console.log(`\n🏠 Stanford Cir properties found: ${stanfordProperties.length}`);
  
  if (stanfordProperties.length > 0) {
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
      console.log(`   Price: $${price?.toLocaleString() || 'null'}`);
      console.log(`   Sold Date: ${soldDate || 'null'}`);
      
      if (address.includes('3623')) {
        console.log(`   ⭐ THIS IS THE ACTUAL SUBJECT PROPERTY`);
      }
    });
  } else {
    console.log('❌ No Stanford Cir properties found in correct area');
    console.log('\nShowing all properties in area:');
    
    properties.slice(0, 10).forEach((prop, i) => {
      const address = prop.location?.address?.line || 'Unknown';
      console.log(`${i+1}. ${address}`);
    });
  }
  
  // Now test comparables search with correct coordinates
  console.log('\n🔍 TESTING COMPARABLE SEARCH WITH CORRECT COORDINATES:\n');
  
  const compRadiusInDegrees = 1 * 0.0145; // 1 mile radius
  
  const compSearchBoundary = [
    [centerLon - compRadiusInDegrees, centerLat - compRadiusInDegrees],
    [centerLon + compRadiusInDegrees, centerLat - compRadiusInDegrees],
    [centerLon + compRadiusInDegrees, centerLat + compRadiusInDegrees],
    [centerLon - compRadiusInDegrees, centerLat + compRadiusInDegrees],
    [centerLon - compRadiusInDegrees, centerLat - compRadiusInDegrees]
  ];
  
  const compPayload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [compSearchBoundary] },
    status: ["sold"],
    type: ["single_family"]
  };
  
  const compResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
    },
    body: JSON.stringify(compPayload)
  });
  
  const compData = await compResponse.json();
  const compProperties = compData?.data?.home_search?.results || [];
  
  console.log(`📊 Comparable search with CORRECT coordinates: ${compProperties.length} properties found`);
  
  // Filter for valid comparables (assuming we find the actual property details)
  const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
  let validComps = 0;
  
  compProperties.forEach(prop => {
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
    
    if (price && price > 10000 && 
        sqft && sqft >= 800 && sqft <= 1500 && // Reasonable range
        soldDate && soldDate >= oneYearAgo) {
      validComps++;
    }
  });
  
  console.log(`📈 Potential valid comparables with correct location: ${validComps}`);
}

checkActualProperty().catch(console.error);
