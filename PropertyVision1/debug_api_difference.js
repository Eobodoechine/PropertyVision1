// Debug why API returns different properties with/without sqft filters
const apiKey = process.env.RAPIDAPI_KEY;

async function debugAPIDifference() {
  console.log('🔍 DEBUGGING: API Filter Difference Analysis\n');
  
  const centerLat = 33.7001;
  const centerLon = -84.2908;
  const radiusInDegrees = 1 * 0.0145;
  
  const searchBoundary = [
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
    [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
    [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
  ];
  
  // Test 1: API call WITH sqft filters (main system)
  const withFiltersPayload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["sold"],
    type: ["single_family"],
    sqft_min: 864,
    sqft_max: 1296
  };
  
  console.log('📊 TEST 1: API Call WITH sqft filters (864-1296)');
  
  const withFiltersResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
    },
    body: JSON.stringify(withFiltersPayload)
  });
  
  const withFiltersData = await withFiltersResponse.json();
  const withFiltersProperties = withFiltersData?.data?.home_search?.results || [];
  
  console.log(`Results: ${withFiltersProperties.length} properties`);
  
  // Show first 10 with their actual sqft
  console.log('\nFirst 10 properties with sqft filter:');
  withFiltersProperties.slice(0, 10).forEach((prop, i) => {
    const address = prop.location?.address?.line || 'Unknown';
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date).toISOString().split('T')[0] : 'null';
    console.log(`${i+1}. ${address} - ${sqft}sqft - $${price} - ${soldDate}`);
  });
  
  // Test 2: API call WITHOUT sqft filters (mile-by-mile)
  const withoutFiltersPayload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["sold"],
    type: ["single_family"]
  };
  
  console.log('\n📊 TEST 2: API Call WITHOUT sqft filters');
  
  const withoutFiltersResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
    },
    body: JSON.stringify(withoutFiltersPayload)
  });
  
  const withoutFiltersData = await withoutFiltersResponse.json();
  const withoutFiltersProperties = withoutFiltersData?.data?.home_search?.results || [];
  
  console.log(`Results: ${withoutFiltersProperties.length} properties`);
  
  // Show first 10 WITHOUT filters
  console.log('\nFirst 10 properties without sqft filter:');
  withoutFiltersProperties.slice(0, 10).forEach((prop, i) => {
    const address = prop.location?.address?.line || 'Unknown';
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date).toISOString().split('T')[0] : 'null';
    console.log(`${i+1}. ${address} - ${sqft}sqft - $${price} - ${soldDate}`);
  });
  
  // Find properties in 864-1296 range from unfiltered results
  console.log('\n📊 FILTERING CLIENT-SIDE (864-1296 sqft from unfiltered results):');
  
  const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
  const clientSideFiltered = [];
  
  withoutFiltersProperties.forEach((prop, index) => {
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
    const address = prop.location?.address?.line || 'Unknown';
    
    if (price && price > 10000 && 
        sqft && sqft >= 864 && sqft <= 1296 && 
        soldDate && soldDate >= oneYearAgo) {
      const pricePerSqft = Math.round(price / sqft);
      clientSideFiltered.push({
        address,
        price,
        sqft,
        pricePerSqft,
        soldDate: soldDate.toISOString().split('T')[0]
      });
    }
  });
  
  console.log(`Valid comparables found with client-side filtering: ${clientSideFiltered.length}`);
  
  if (clientSideFiltered.length > 0) {
    console.log('\nValid comparables:');
    clientSideFiltered.slice(0, 15).forEach((comp, i) => {
      console.log(`${i+1}. ${comp.address} - $${comp.price.toLocaleString()} | ${comp.sqft}sqft | $${comp.pricePerSqft}/sqft | ${comp.soldDate}`);
    });
  }
  
  console.log('\n🎯 CONCLUSION:');
  console.log(`API with sqft filters: ${withFiltersProperties.length} properties`);
  console.log(`API without sqft filters: ${withoutFiltersProperties.length} properties`);
  console.log(`Client-side filtered from unfiltered: ${clientSideFiltered.length} valid comparables`);
  
  // Check if API filters are working correctly
  const oversizedFromFiltered = withFiltersProperties.filter(prop => {
    const sqft = prop.description?.sqft;
    return sqft && (sqft < 864 || sqft > 1296);
  });
  
  console.log(`\n⚠️ API FILTER ISSUE: ${oversizedFromFiltered.length} properties outside 864-1296 range returned despite sqft filter`);
  
  if (oversizedFromFiltered.length > 0) {
    console.log('Sample oversized properties from "filtered" API:');
    oversizedFromFiltered.slice(0, 5).forEach((prop, i) => {
      const address = prop.location?.address?.line || 'Unknown';
      const sqft = prop.description?.sqft;
      console.log(`${i+1}. ${address} - ${sqft}sqft (outside 864-1296 range)`);
    });
  }
}

debugAPIDifference().catch(console.error);
