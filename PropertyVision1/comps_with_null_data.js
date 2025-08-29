const apiKey = process.env.RAPIDAPI_KEY;

async function getCompsIncludingNullData() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`API call for SOLD townhomes (comps) including null data within 5 miles...`);
  
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
    status: ["sold"],  // Only sold properties (actual comps)
    type: ["townhomes"]
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
      const soldTownhomes = data?.data?.home_search?.results || [];
      const totalCount = data?.data?.home_search?.count || 0;
      
      console.log(`API Response:`);
      console.log(`- SOLD townhomes returned: ${soldTownhomes.length}`);
      console.log(`- API total count: ${totalCount}`);
      
      // Analyze data completeness including null values
      let withSqft = 0;
      let withNullSqft = 0;
      let withPrice = 0;
      let withSoldDate = 0;
      let recentSales6mo = 0;
      let recentSales12mo = 0;
      
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      
      // Subject property criteria
      const subjectSqft = 1150;
      const minSqft = subjectSqft * 0.8; // 920
      const maxSqft = subjectSqft * 1.2; // 1380
      
      let potentialComps6mo = 0;
      let potentialComps12mo = 0;
      let nullSqftButRecent = 0;
      
      console.log(`\nAnalyzing SOLD townhomes for comp potential...`);
      
      soldTownhomes.forEach((prop, index) => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        
        // Data completeness tracking
        if (sqft && sqft > 0) {
          withSqft++;
        } else {
          withNullSqft++;
        }
        
        if (price && price > 0) withPrice++;
        if (soldDate) withSoldDate++;
        
        if (soldDate && soldDate >= sixMonthsAgo) recentSales6mo++;
        if (soldDate && soldDate >= oneYearAgo) recentSales12mo++;
        
        // Check comp potential
        const hasRecentSale6mo = soldDate && soldDate >= sixMonthsAgo;
        const hasRecentSale12mo = soldDate && soldDate >= oneYearAgo;
        const hasPrice = price && price > 0;
        
        if (sqft && sqft >= minSqft && sqft <= maxSqft && hasPrice) {
          if (hasRecentSale6mo) potentialComps6mo++;
          if (hasRecentSale12mo) potentialComps12mo++;
        }
        
        // Track properties with null sqft but recent sales (could be researched)
        if ((!sqft || sqft <= 0) && hasRecentSale12mo && hasPrice) {
          nullSqftButRecent++;
          
          if (index < 10) { // Show first 10 examples
            console.log(`${index+1}. ${address} - ${beds}bed/${baths}bath, NULL sqft, $${price}, sold ${soldDate.toISOString().split('T')[0]}`);
          }
        }
      });
      
      console.log(`\n--- DATA COMPLETENESS ---`);
      console.log(`Total SOLD townhomes: ${soldTownhomes.length}`);
      console.log(`With sqft data: ${withSqft}`);
      console.log(`With NULL/missing sqft: ${withNullSqft}`);
      console.log(`With price data: ${withPrice}`);
      console.log(`With sold date: ${withSoldDate}`);
      
      console.log(`\n--- RECENT SALES ---`);
      console.log(`Recent sales (6 months): ${recentSales6mo}`);
      console.log(`Recent sales (12 months): ${recentSales12mo}`);
      
      console.log(`\n--- COMP POTENTIAL ---`);
      console.log(`Size-appropriate comps (920-1380 sqft):`);
      console.log(`- 6-month comps: ${potentialComps6mo}`);
      console.log(`- 12-month comps: ${potentialComps12mo}`);
      
      console.log(`\nNull sqft but recent sales (research candidates): ${nullSqftButRecent}`);
      
      if (nullSqftButRecent > 10) {
        console.log(`... and ${nullSqftButRecent - 10} more properties with null sqft but recent sales`);
      }
      
      console.log(`\nANSWER: Found ${soldTownhomes.length} sold townhomes total, ${potentialComps12mo} size-appropriate 12-month comps, plus ${nullSqftButRecent} null-sqft properties with recent sales that could be researched`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getCompsIncludingNullData();
