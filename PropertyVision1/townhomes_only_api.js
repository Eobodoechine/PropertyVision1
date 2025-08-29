const apiKey = process.env.RAPIDAPI_KEY;

async function getTownhomesOnly() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`API call for townhomes only within 5 miles...`);
  
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
    status: ["sold", "for_sale", "off_market", "pending", "new", "price_reduced"],
    type: ["townhomes"]  // Filter specifically for townhomes
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
      
      console.log(`API Response:`);
      console.log(`- Townhomes returned: ${count}`);
      console.log(`- API total count: ${totalCount}`);
      
      // Quick analysis of the returned townhomes
      const townhomes = data?.data?.home_search?.results || [];
      let withSqft = 0;
      let under1150 = 0;
      
      townhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        if (sqft && sqft > 0) {
          withSqft++;
          if (sqft < 1150) {
            under1150++;
          }
        }
      });
      
      console.log(`\nQuick analysis of API townhomes:`);
      console.log(`- With sqft data: ${withSqft} out of ${count}`);
      console.log(`- Smaller than 1150 sqft: ${under1150} out of ${withSqft}`);
      
      console.log(`\nANSWER: Direct API call for townhomes only returns ${count} properties`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getTownhomesOnly();
