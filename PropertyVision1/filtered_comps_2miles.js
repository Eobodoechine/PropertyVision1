const apiKey = process.env.RAPIDAPI_KEY;

async function getFilteredComps2Miles() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.029; // 2 miles (roughly)
  
  console.log(`API call for SOLD townhomes with size/age filters + null data within 2 miles...`);
  
  const boundary = [
    [centerLon - radius, centerLat - radius],
    [centerLon + radius, centerLat - radius],
    [centerLon + radius, centerLat + radius],
    [centerLon - radius, centerLat + radius],
    [centerLon - radius, centerLat - radius]
  ];
  
  // Subject property criteria
  const subjectSqft = 1150;
  const subjectYearBuilt = 1985;
  const minSqft = Math.round(subjectSqft * 0.8); // 920
  const maxSqft = Math.round(subjectSqft * 1.2); // 1380
  const minYearBuilt = subjectYearBuilt - 10; // 1975
  const maxYearBuilt = subjectYearBuilt + 10; // 1995
  
  const payload = {
    limit: 400,
    offset: 0,
    boundary: { coordinates: [boundary] },
    status: ["sold"],
    type: ["townhomes"],
    sqft_min: minSqft,
    sqft_max: maxSqft,
    year_built_min: minYearBuilt,
    year_built_max: maxYearBuilt
  };
  
  // Function to calculate distance
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
    console.log(`Filter criteria applied:`);
    console.log(`- Size: ${minSqft}-${maxSqft} sqft`);
    console.log(`- Year built: ${minYearBuilt}-${maxYearBuilt}`);
    console.log(`- Distance: Within 2 miles`);
    console.log(`- Status: Sold only`);
    
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
      const filteredTownhomes = data?.data?.home_search?.results || [];
      const totalCount = data?.data?.home_search?.count || 0;
      
      console.log(`\nAPI Response:`);
      console.log(`- Pre-filtered townhomes returned: ${filteredTownhomes.length}`);
      console.log(`- API total count: ${totalCount}`);
      
      // Further filter and analyze
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      
      const validComps = [];
      const nullDataCandidates = [];
      
      filteredTownhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        const yearBuilt = prop.year_built;
        const lat = prop.location?.address?.coordinate?.lat;
        const lon = prop.location?.address?.coordinate?.lon;
        
        if (lat && lon) {
          const distance = calculateDistance(centerLat, centerLon, lat, lon);
          
          // Only include properties within 2 miles
          if (distance <= 2.0) {
            const hasPrice = price && price > 0 && price > 10000; // Filter out obvious data errors
            const hasRecentSale = soldDate && soldDate >= oneYearAgo;
            const isRecent6mo = soldDate && soldDate >= sixMonthsAgo;
            
            // Valid comp with complete data
            if (sqft && sqft > 0 && hasPrice && hasRecentSale) {
              const pricePerSqft = Math.round(price / sqft);
              
              // Filter out obvious outliers (< $50/sqft or > $300/sqft)
              if (pricePerSqft >= 50 && pricePerSqft <= 300) {
                validComps.push({
                  address,
                  sqft,
                  beds,
                  baths,
                  price,
                  soldDate: soldDate.toISOString().split('T')[0],
                  pricePerSqft,
                  yearBuilt,
                  distance: Math.round(distance * 100) / 100,
                  isRecent6mo
                });
              }
            }
            
            // Null data candidate (missing sqft or year built but has price and recent sale)
            if ((!sqft || sqft <= 0 || !yearBuilt) && hasPrice && hasRecentSale) {
              nullDataCandidates.push({
                address,
                sqft: sqft || 'NULL',
                beds,
                baths,
                price,
                soldDate: soldDate.toISOString().split('T')[0],
                yearBuilt: yearBuilt || 'NULL',
                distance: Math.round(distance * 100) / 100,
                isRecent6mo,
                missingData: [
                  ...(!sqft || sqft <= 0 ? ['sqft'] : []),
                  ...(!yearBuilt ? ['year_built'] : [])
                ]
              });
            }
          }
        }
      });
      
      // Sort by distance
      validComps.sort((a, b) => a.distance - b.distance);
      nullDataCandidates.sort((a, b) => a.distance - b.distance);
      
      console.log(`\n=== VALID COMPS WITH COMPLETE DATA (Within 2 Miles) ===`);
      console.log(`Subject: 2173 Wellington Circle - 3bed/2bath, 1150 sqft, built 1985\n`);
      
      if (validComps.length === 0) {
        console.log(`No valid comps found with complete data and realistic prices.`);
      } else {
        validComps.forEach((comp, index) => {
          const recentFlag = comp.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
          console.log(`${index + 1}. ${comp.address}${recentFlag}`);
          console.log(`   Distance: ${comp.distance} miles`);
          console.log(`   ${comp.beds}bed/${comp.baths}bath, ${comp.sqft} sqft, built ${comp.yearBuilt || 'Unknown'}`);
          console.log(`   Sold: ${comp.soldDate}`);
          console.log(`   Price: $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft)`);
          console.log('');
        });
      }
      
      if (nullDataCandidates.length > 0) {
        console.log(`=== RESEARCH CANDIDATES (Missing Data but Recent Sales) ===`);
        
        nullDataCandidates.slice(0, 15).forEach((candidate, index) => { // Show first 15
          const recentFlag = candidate.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
          console.log(`${index + 1}. ${candidate.address}${recentFlag}`);
          console.log(`   Distance: ${candidate.distance} miles`);
          console.log(`   ${candidate.beds}bed/${candidate.baths}bath, ${candidate.sqft} sqft, built ${candidate.yearBuilt}`);
          console.log(`   Sold: ${candidate.soldDate}`);
          console.log(`   Price: $${candidate.price.toLocaleString()}`);
          console.log(`   Missing: ${candidate.missingData.join(', ')}`);
          console.log('');
        });
        
        if (nullDataCandidates.length > 15) {
          console.log(`... and ${nullDataCandidates.length - 15} more research candidates`);
        }
      }
      
      console.log(`=== SUMMARY ===`);
      console.log(`Valid comps with complete data: ${validComps.length}`);
      console.log(`Research candidates (null data): ${nullDataCandidates.length}`);
      console.log(`Total potential comps: ${validComps.length + nullDataCandidates.length}`);
      
      if (validComps.length > 0) {
        const avgDistance = Math.round((validComps.reduce((sum, comp) => sum + comp.distance, 0) / validComps.length) * 100) / 100;
        const recentComps = validComps.filter(comp => comp.isRecent6mo).length;
        const priceRange = {
          min: Math.min(...validComps.map(c => c.price)),
          max: Math.max(...validComps.map(c => c.price))
        };
        console.log(`Average distance: ${avgDistance} miles`);
        console.log(`Recent (6-month) comps: ${recentComps}`);
        console.log(`Price range: $${priceRange.min.toLocaleString()} - $${priceRange.max.toLocaleString()}`);
      }
      
      // Now make a second call without year built filter to get more null data candidates
      console.log(`\n=== MAKING SECOND CALL WITHOUT YEAR BUILT FILTER ===`);
      
      const payload2 = {
        limit: 400,
        offset: 0,
        boundary: { coordinates: [boundary] },
        status: ["sold"],
        type: ["townhomes"],
        sqft_min: minSqft,
        sqft_max: maxSqft
        // No year_built filter
      };
      
      const response2 = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
        },
        body: JSON.stringify(payload2)
      });
      
      if (response2.ok) {
        const data2 = await response2.json();
        const allTownhomes = data2?.data?.home_search?.results || [];
        
        const additionalComps = [];
        
        allTownhomes.forEach(prop => {
          const sqft = prop.description?.sqft;
          const price = prop.last_sold_price;
          const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
          const address = prop.location?.address?.line || 'Unknown address';
          const lat = prop.location?.address?.coordinate?.lat;
          const lon = prop.location?.address?.coordinate?.lon;
          
          if (lat && lon) {
            const distance = calculateDistance(centerLat, centerLon, lat, lon);
            
            if (distance <= 2.0 && sqft && sqft >= minSqft && sqft <= maxSqft && 
                price && price > 10000 && soldDate && soldDate >= oneYearAgo) {
              
              const pricePerSqft = Math.round(price / sqft);
              
              if (pricePerSqft >= 50 && pricePerSqft <= 300) {
                // Check if this property is already in our validComps
                const exists = validComps.some(comp => comp.address === address);
                if (!exists) {
                  const isRecent6mo = soldDate >= sixMonthsAgo;
                  
                  additionalComps.push({
                    address,
                    sqft,
                    beds: prop.description?.beds,
                    baths: prop.description?.baths,
                    price,
                    soldDate: soldDate.toISOString().split('T')[0],
                    pricePerSqft,
                    yearBuilt: prop.year_built || 'NULL',
                    distance: Math.round(distance * 100) / 100,
                    isRecent6mo
                  });
                }
              }
            }
          }
        });
        
        additionalComps.sort((a, b) => a.distance - b.distance);
        
        console.log(`Additional comps without year built filter: ${additionalComps.length}`);
        
        if (additionalComps.length > 0) {
          console.log(`\n=== ADDITIONAL COMPS (Missing Year Built) ===`);
          
          additionalComps.slice(0, 10).forEach((comp, index) => {
            const recentFlag = comp.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
            console.log(`${index + 1}. ${comp.address}${recentFlag}`);
            console.log(`   Distance: ${comp.distance} miles`);
            console.log(`   ${comp.beds}bed/${comp.baths}bath, ${comp.sqft} sqft, built ${comp.yearBuilt}`);
            console.log(`   Sold: ${comp.soldDate}`);
            console.log(`   Price: $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft)`);
            console.log('');
          });
          
          if (additionalComps.length > 10) {
            console.log(`... and ${additionalComps.length - 10} more additional comps`);
          }
        }
        
        console.log(`\n=== FINAL SUMMARY (2 MILES) ===`);
        console.log(`Comps with complete data (incl. year built): ${validComps.length}`);
        console.log(`Additional comps (missing year built): ${additionalComps.length}`);
        console.log(`Total usable comps: ${validComps.length + additionalComps.length}`);
        console.log(`Research candidates: ${nullDataCandidates.length}`);
        
      }
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getFilteredComps2Miles();
