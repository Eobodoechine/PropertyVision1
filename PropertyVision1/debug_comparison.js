// Debug comparison: Main system vs Mile-by-mile filtering
const apiKey = process.env.RAPIDAPI_KEY;

console.log('🔍 DEBUGGING: Why main system finds 1 vs mile-by-mile finds 14 comparables\n');

// Main system filters from storage.ts
function mainSystemFiltering(properties) {
  console.log('📊 MAIN SYSTEM FILTERING LOGIC:');
  
  const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
  const validComps = [];
  
  console.log(`Date filter: Sales after ${oneYearAgo.toISOString().split('T')[0]}`);
  console.log('Size filter: 864-1296 sqft');
  console.log('Price filter: $50-300/sqft\n');
  
  properties.forEach((prop, index) => {
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
    const address = prop.location?.address?.line || 'Unknown';
    
    console.log(`${index + 1}. ${address} - Type: ${prop.description?.type || 'Unknown'}`);
    console.log(`   Price: $${price || 'null'} | Size: ${sqft || 'null'}sqft | Date: ${soldDate ? soldDate.toISOString().split('T')[0] : 'null'}`);
    
    // Main system logic from storage.ts lines 773-775
    if (price && price > 10000 && soldDate && soldDate >= oneYearAgo && sqft && sqft > 0) {
      const pricePerSqft = Math.round(price / sqft);
      
      // Check if it passes the additional filters
      if (pricePerSqft >= 50 && pricePerSqft <= 300) {
        console.log(`   → VALID COMPARABLE: $${pricePerSqft}/sqft`);
        validComps.push({
          address,
          price,
          sqft,
          pricePerSqft,
          soldDate: soldDate.toISOString().split('T')[0]
        });
      } else {
        console.log(`   → EXCLUDED: price per sqft $${pricePerSqft} outside $50-300 range`);
      }
    } else {
      let reasons = [];
      if (!price || price <= 10000) reasons.push('no valid price');
      if (!soldDate || soldDate < oneYearAgo) reasons.push('old sale date');
      if (!sqft || sqft <= 0) reasons.push('missing sqft');
      console.log(`   → EXCLUDED: ${reasons.join(', ')}`);
    }
  });
  
  return validComps;
}

// Mile-by-mile filtering (simpler logic)
function mileByMileFiltering(properties) {
  console.log('\n📊 MILE-BY-MILE FILTERING LOGIC:');
  
  const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
  const validComps = [];
  
  console.log(`Date filter: Sales after ${oneYearAgo.toISOString().split('T')[0]}`);
  console.log('Size filter: 864-1296 sqft');
  console.log('Price filter: Basic validation only\n');
  
  properties.forEach((prop, index) => {
    const sqft = prop.description?.sqft;
    const price = prop.last_sold_price;
    const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
    const address = prop.location?.address?.line || 'Unknown';
    
    if (index < 20) { // Show first 20 for comparison
      console.log(`${index + 1}. ${address}`);
      console.log(`   Price: $${price || 'null'} | Size: ${sqft || 'null'}sqft | Date: ${soldDate ? soldDate.toISOString().split('T')[0] : 'null'}`);
      
      // Mile-by-mile logic (from our test)
      if (price && price > 10000 && sqft && sqft > 0 && soldDate && soldDate >= oneYearAgo) {
        if (sqft >= 864 && sqft <= 1296) {
          const pricePerSqft = Math.round(price / sqft);
          console.log(`   → VALID COMPARABLE: $${pricePerSqft}/sqft`);
          validComps.push({
            address,
            price,
            sqft,
            pricePerSqft,
            soldDate: soldDate.toISOString().split('T')[0]
          });
        } else {
          console.log(`   → EXCLUDED: size ${sqft} outside 864-1296 range`);
        }
      } else {
        let reasons = [];
        if (!price || price <= 10000) reasons.push('no valid price');
        if (!soldDate || soldDate < oneYearAgo) reasons.push('old sale date');
        if (!sqft || sqft <= 0) reasons.push('missing sqft');
        console.log(`   → EXCLUDED: ${reasons.join(', ')}`);
      }
    }
  });
  
  return validComps;
}

async function debugComparison() {
  // Get the same data the main system would get
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
  
  // Main system search with filters (like searchWithFilters function)
  const mainSystemPayload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["sold"],
    type: ["single_family"],
    sqft_min: 864,
    sqft_max: 1296
  };
  
  console.log('🔍 MAIN SYSTEM API CALL (with sqft filters):');
  console.log(`Payload: ${JSON.stringify(mainSystemPayload, null, 2)}\n`);
  
  const mainResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
    },
    body: JSON.stringify(mainSystemPayload)
  });
  
  const mainData = await mainResponse.json();
  const mainProperties = mainData?.data?.home_search?.results || [];
  
  console.log(`📊 MAIN SYSTEM RESULTS: ${mainProperties.length} properties returned by API\n`);
  
  const mainValidComps = mainSystemFiltering(mainProperties);
  
  console.log(`\n🎯 MAIN SYSTEM SUMMARY: ${mainValidComps.length} valid comparables found`);
  
  // Now test mile-by-mile approach (no sqft filters in API call)
  const mileByMilePayload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [searchBoundary] },
    status: ["sold"],
    type: ["single_family"]
    // No sqft_min/sqft_max filters
  };
  
  console.log('\n🔍 MILE-BY-MILE API CALL (no sqft filters):');
  console.log(`Payload: ${JSON.stringify(mileByMilePayload, null, 2)}\n`);
  
  const mileResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
    },
    body: JSON.stringify(mileByMilePayload)
  });
  
  const mileData = await mileResponse.json();
  const mileProperties = mileData?.data?.home_search?.results || [];
  
  console.log(`📊 MILE-BY-MILE RESULTS: ${mileProperties.length} properties returned by API\n`);
  
  const mileValidComps = mileByMileFiltering(mileProperties);
  
  console.log(`\n🎯 MILE-BY-MILE SUMMARY: ${mileValidComps.length} valid comparables found`);
  
  console.log('\n🔍 CONCLUSION:');
  console.log(`Main system: ${mainValidComps.length} comparables`);
  console.log(`Mile-by-mile: ${mileValidComps.length} comparables`);
  
  if (mileValidComps.length > mainValidComps.length) {
    console.log('\n💡 HYPOTHESIS: Main system sqft_min/sqft_max API filters are too restrictive');
    console.log('   Mile-by-mile gets more properties by filtering client-side instead of API-side');
  }
}

debugComparison().catch(console.error);
