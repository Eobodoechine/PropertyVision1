const apiKey = process.env.RAPIDAPI_KEY;

async function getCompsWithDistances() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Getting comparable sales organized by distance from 2173 Wellington Circle...`);
  
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
    status: ["sold"],
    type: ["townhomes"]
  };
  
  // Function to calculate distance between two coordinates
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
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
      
      // Subject property
      const subjectSqft = 1150;
      const minSqft = subjectSqft * 0.8; // 920
      const maxSqft = subjectSqft * 1.2; // 1380
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      
      // Find valid comps with distances
      const validComps = [];
      
      soldTownhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        const lat = prop.location?.address?.coordinate?.lat;
        const lon = prop.location?.address?.coordinate?.lon;
        
        // Check if valid comp
        if (sqft && sqft >= minSqft && sqft <= maxSqft && 
            price && price > 0 && 
            soldDate && soldDate >= oneYearAgo &&
            lat && lon) {
          
          const distance = calculateDistance(centerLat, centerLon, lat, lon);
          const pricePerSqft = Math.round(price / sqft);
          const isRecent6mo = soldDate >= sixMonthsAgo;
          
          validComps.push({
            address,
            sqft,
            beds,
            baths,
            price,
            soldDate: soldDate.toISOString().split('T')[0],
            pricePerSqft,
            distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
            isRecent6mo,
            lat,
            lon
          });
        }
      });
      
      // Sort by distance (closest first)
      validComps.sort((a, b) => a.distance - b.distance);
      
      console.log(`\n=== COMPARABLE SALES ORGANIZED BY DISTANCE ===`);
      console.log(`Subject: 2173 Wellington Circle, Lithonia, GA 30058`);
      console.log(`3bed/2bath, 1150 sqft, built 1985\n`);
      
      validComps.forEach((comp, index) => {
        const recentFlag = comp.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
        console.log(`${index + 1}. ${comp.address}${recentFlag}`);
        console.log(`   Distance: ${comp.distance} miles`);
        console.log(`   ${comp.beds}bed/${comp.baths}bath, ${comp.sqft} sqft`);
        console.log(`   Sold: ${comp.soldDate}`);
        console.log(`   Price: $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft)`);
        console.log('');
      });
      
      // Summary statistics
      const avgDistance = Math.round((validComps.reduce((sum, comp) => sum + comp.distance, 0) / validComps.length) * 100) / 100;
      const closestDistance = validComps[0]?.distance || 0;
      const farthestDistance = validComps[validComps.length - 1]?.distance || 0;
      
      console.log(`=== DISTANCE SUMMARY ===`);
      console.log(`Total valid comps: ${validComps.length}`);
      console.log(`Closest comp: ${closestDistance} miles`);
      console.log(`Farthest comp: ${farthestDistance} miles`);
      console.log(`Average distance: ${avgDistance} miles`);
      
      const within1Mile = validComps.filter(comp => comp.distance <= 1).length;
      const within2Miles = validComps.filter(comp => comp.distance <= 2).length;
      const within3Miles = validComps.filter(comp => comp.distance <= 3).length;
      
      console.log(`\nDistance distribution:`);
      console.log(`- Within 1 mile: ${within1Mile} comps`);
      console.log(`- Within 2 miles: ${within2Miles} comps`);
      console.log(`- Within 3 miles: ${within3Miles} comps`);
      console.log(`- Within 5 miles: ${validComps.length} comps`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getCompsWithDistances();
