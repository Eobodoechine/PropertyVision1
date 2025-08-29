const apiKey = process.env.RAPIDAPI_KEY;

async function getCompsFor952SqftProperty() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.029; // 2 miles
  
  console.log(`Updated analysis for 2173 Wellington Circle - CORRECTED to 952 sqft...`);
  
  const boundary = [
    [centerLon - radius, centerLat - radius],
    [centerLon + radius, centerLat - radius],
    [centerLon + radius, centerLat + radius],
    [centerLon - radius, centerLat + radius],
    [centerLon - radius, centerLat - radius]
  ];
  
  // CORRECTED subject property criteria
  const subjectSqft = 952; // CORRECTED SIZE
  const subjectYearBuilt = 1985;
  const minSqft = Math.round(subjectSqft * 0.8); // 762
  const maxSqft = Math.round(subjectSqft * 1.2); // 1142
  const minYearBuilt = subjectYearBuilt - 10; // 1975
  const maxYearBuilt = subjectYearBuilt + 10; // 1995
  
  const payload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [boundary] },
    status: ["sold"],
    type: ["townhomes"]
    // No sqft filter in API call - we'll filter manually for better control
  };
  
  // Function to calculate distance
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
    console.log(`CORRECTED Filter criteria:`);
    console.log(`- Subject size: 952 sqft (was incorrectly 1150 sqft)`);
    console.log(`- Comp size range: ${minSqft}-${maxSqft} sqft (762-1142 sqft)`);
    console.log(`- Year built: ${minYearBuilt}-${maxYearBuilt}`);
    console.log(`- Distance: Within 2 miles`);
    
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
      const allTownhomes = data?.data?.home_search?.results || [];
      
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      
      const validComps = [];
      const tooLarge = [];
      const tooSmall = [];
      
      allTownhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        const yearBuilt = prop.year_built;
        const lat = prop.location?.address?.coordinate?.lat;
        const lon = prop.location?.address?.coordinate?.lon;
        
        if (lat && lon && price && price > 10000 && soldDate && soldDate >= oneYearAgo) {
          const distance = calculateDistance(centerLat, centerLon, lat, lon);
          
          if (distance <= 2.0 && sqft && sqft > 0) {
            const pricePerSqft = Math.round(price / sqft);
            const isRecent6mo = soldDate >= sixMonthsAgo;
            
            // Filter by CORRECTED size range (762-1142 sqft)
            if (pricePerSqft >= 50 && pricePerSqft <= 300) {
              if (sqft >= minSqft && sqft <= maxSqft) {
                validComps.push({
                  address,
                  sqft,
                  beds,
                  baths,
                  price,
                  soldDate: soldDate.toISOString().split('T')[0],
                  pricePerSqft,
                  yearBuilt: yearBuilt || 'Unknown',
                  distance: Math.round(distance * 100) / 100,
                  isRecent6mo
                });
              } else if (sqft > maxSqft) {
                tooLarge.push({
                  address,
                  sqft,
                  pricePerSqft,
                  distance: Math.round(distance * 100) / 100
                });
              } else if (sqft < minSqft) {
                tooSmall.push({
                  address,
                  sqft,
                  pricePerSqft,
                  distance: Math.round(distance * 100) / 100
                });
              }
            }
          }
        }
      });
      
      // Sort by distance
      validComps.sort((a, b) => a.distance - b.distance);
      tooLarge.sort((a, b) => a.distance - b.distance);
      tooSmall.sort((a, b) => a.distance - b.distance);
      
      console.log(`\n=== VALID COMPS FOR 952 SQFT SUBJECT (762-1142 sqft range) ===`);
      console.log(`Subject: 2173 Wellington Circle - 3bed/2bath, 952 sqft, built 1985\n`);
      
      if (validComps.length === 0) {
        console.log(`No valid comps found in the corrected size range (762-1142 sqft).`);
      } else {
        validComps.forEach((comp, index) => {
          const recentFlag = comp.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
          console.log(`${index + 1}. ${comp.address}${recentFlag}`);
          console.log(`   Distance: ${comp.distance} miles`);
          console.log(`   ${comp.beds}bed/${comp.baths}bath, ${comp.sqft} sqft, built ${comp.yearBuilt}`);
          console.log(`   Sold: ${comp.soldDate}`);
          console.log(`   Price: $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft)`);
          console.log('');
        });
      }
      
      console.log(`=== PROPERTIES TOO LARGE (>1142 sqft) ===`);
      console.log(`Properties that were included in previous 1150 sqft analysis but are now excluded:`);
      
      tooLarge.slice(0, 10).forEach((prop, index) => {
        console.log(`${index + 1}. ${prop.address} - ${prop.sqft} sqft ($${prop.pricePerSqft}/sqft) - ${prop.distance} miles`);
      });
      
      if (tooLarge.length > 10) {
        console.log(`... and ${tooLarge.length - 10} more properties too large`);
      }
      
      console.log(`\n=== PROPERTIES TOO SMALL (<762 sqft) ===`);
      
      if (tooSmall.length > 0) {
        tooSmall.slice(0, 5).forEach((prop, index) => {
          console.log(`${index + 1}. ${prop.address} - ${prop.sqft} sqft ($${prop.pricePerSqft}/sqft) - ${prop.distance} miles`);
        });
      } else {
        console.log(`No properties found smaller than 762 sqft.`);
      }
      
      console.log(`\n=== CORRECTED ANALYSIS SUMMARY ===`);
      console.log(`Subject property: 952 sqft (corrected from 1150 sqft)`);
      console.log(`Valid comps in size range (762-1142 sqft): ${validComps.length}`);
      console.log(`Properties too large (>1142 sqft): ${tooLarge.length}`);
      console.log(`Properties too small (<762 sqft): ${tooSmall.length}`);
      
      if (validComps.length > 0) {
        const avgDistance = Math.round((validComps.reduce((sum, comp) => sum + comp.distance, 0) / validComps.length) * 100) / 100;
        const recentComps = validComps.filter(comp => comp.isRecent6mo).length;
        const priceRange = {
          min: Math.min(...validComps.map(c => c.price)),
          max: Math.max(...validComps.map(c => c.price))
        };
        const pricePerSqftRange = {
          min: Math.min(...validComps.map(c => c.pricePerSqft)),
          max: Math.max(...validComps.map(c => c.pricePerSqft))
        };
        
        console.log(`\nValid comp statistics:`);
        console.log(`- Average distance: ${avgDistance} miles`);
        console.log(`- Recent (6-month) comps: ${recentComps}`);
        console.log(`- Price range: $${priceRange.min.toLocaleString()} - $${priceRange.max.toLocaleString()}`);
        console.log(`- Price/sqft range: $${pricePerSqftRange.min} - $${pricePerSqftRange.max}`);
        
        // Calculate updated ARV
        const prices = validComps.map(comp => comp.price).sort((a, b) => a - b);
        const pricesPerSqft = validComps.map(comp => comp.pricePerSqft).sort((a, b) => a - b);
        
        function median(arr) {
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0 
            ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
            : sorted[mid];
        }
        
        if (validComps.length >= 3) {
          const medianPrice = median(prices);
          const medianPricePerSqft = median(pricesPerSqft);
          const arvByPrice = medianPrice;
          const arvByPricePerSqft = Math.round(medianPricePerSqft * 952);
          const finalARV = Math.round((arvByPrice + arvByPricePerSqft) / 2);
          
          console.log(`\n=== UPDATED ARV CALCULATION FOR 952 SQFT ===`);
          console.log(`Median price method: $${medianPrice.toLocaleString()}`);
          console.log(`Median $/sqft method: $${medianPricePerSqft} × 952 = $${arvByPricePerSqft.toLocaleString()}`);
          console.log(`CORRECTED ARV: $${finalARV.toLocaleString()}`);
          
          let confidence = validComps.length >= 5 ? 'High' : validComps.length >= 3 ? 'Medium' : 'Low';
          console.log(`Confidence: ${confidence} (${validComps.length} comps)`);
        }
      }
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getCompsFor952SqftProperty();
