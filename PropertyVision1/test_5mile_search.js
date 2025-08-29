const apiKey = process.env.RAPIDAPI_KEY;

async function test5MileSearch() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Testing 5-mile radius search around ${centerLat}, ${centerLon}`);
  
  const boundary = [
    [centerLon - radius, centerLat - radius],
    [centerLon + radius, centerLat - radius],
    [centerLon + radius, centerLat + radius],
    [centerLon - radius, centerLat + radius],
    [centerLon - radius, centerLat - radius]
  ];
  
  const payload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [boundary] },
    status: ["sold", "for_sale", "off_market", "pending", "new", "price_reduced"]
  };
  
  try {
    const response = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      const data = await response.json();
      const count = data?.data?.home_search?.results?.length || 0;
      const totalCount = data?.data?.home_search?.count || 0;
      console.log(`5-mile radius results: ${count} properties returned (API says ${totalCount} total)`);
      return { count, totalCount };
    } else {
      console.log(`API error: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return null;
  }
}

test5MileSearch().then(result => {
  if (result) {
    console.log(`Answer: Within 5 miles, there are ${result.count} properties available`);
  }
});
