const apiKey = process.env.RAPIDAPI_KEY;

async function verifyClosestProperties() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.043; // 3 miles
  
  console.log(`Verifying closest properties to 2173 Wellington Circle...`);
  
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
  
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959;
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
      
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      
      const allProperties = [];
      
      soldTownhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        const lat = prop.location?.address?.coordinate?.lat;
        const lon = prop.location?.address?.coordinate?.lon;
        
        if (lat && lon && price && price > 0 && soldDate && soldDate >= oneYearAgo) {
          const distance = calculateDistance(centerLat, centerLon, lat, lon);
          
          if (distance <= 1.0) { // Only show properties within 1 mile
            const isRecent6mo = soldDate >= sixMonthsAgo;
            const pricePerSqft = sqft && sqft > 0 ? Math.round(price / sqft) : 'N/A';
            
            allProperties.push({
              address,
              distance: Math.round(distance * 100) / 100,
              sqft: sqft || 'NULL',
              price,
              pricePerSqft,
              soldDate: soldDate.toISOString().split('T')[0],
              isRecent6mo,
              beds: prop.description?.beds || 'N/A',
              baths: prop.description?.baths || 'N/A'
            });
          }
        }
      });
      
      // Sort by distance
      allProperties.sort((a, b) => a.distance - b.distance);
      
      console.log(`\n=== ACTUAL CLOSEST PROPERTIES (Within 1 Mile) ===`);
      console.log(`Subject: 2173 Wellington Circle, Lithonia, GA\n`);
      
      allProperties.forEach((prop, index) => {
        const recentFlag = prop.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
        console.log(`${index + 1}. ${prop.address}${recentFlag}`);
        console.log(`   Distance: ${prop.distance} miles`);
        console.log(`   ${prop.beds}bed/${prop.baths}bath, ${prop.sqft} sqft`);
        console.log(`   Sold: ${prop.soldDate}`);
        console.log(`   Price: $${prop.price.toLocaleString()} (${prop.pricePerSqft === 'N/A' ? 'N/A' : '$' + prop.pricePerSqft}/sqft)`);
        console.log('');
      });
      
      // Check for any Sherwood properties specifically
      const sherwoodProperties = soldTownhomes.filter(prop => {
        const address = (prop.location?.address?.line || '').toLowerCase();
        return address.includes('sherwood');
      });
      
      if (sherwoodProperties.length > 0) {
        console.log(`=== ALL SHERWOOD PROPERTIES FOUND ===`);
        sherwoodProperties.forEach(prop => {
          const address = prop.location?.address?.line || 'Unknown address';
          const lat = prop.location?.address?.coordinate?.lat;
          const lon = prop.location?.address?.coordinate?.lon;
          const distance = lat && lon ? calculateDistance(centerLat, centerLon, lat, lon) : 'Unknown';
          const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date).toISOString().split('T')[0] : 'Unknown';
          
          console.log(`${address} - ${typeof distance === 'number' ? distance.toFixed(2) + ' miles' : distance} - Sold: ${soldDate}`);
        });
      } else {
        console.log(`\nNo Sherwood properties found in the dataset.`);
      }
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

verifyClosestProperties();
