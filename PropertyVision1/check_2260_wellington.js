const apiKey = process.env.RAPIDAPI_KEY;

async function check2260Wellington() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Checking for 2260 Wellington Circle in townhome data...`);
  
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
      const townhomes = data?.data?.home_search?.results || [];
      
      // Search for 2260 Wellington Circle
      const wellingtonProperties = townhomes.filter(prop => {
        const address = (prop.location?.address?.line || '').toLowerCase();
        return address.includes('2260') && address.includes('wellington');
      });
      
      console.log(`Found ${wellingtonProperties.length} properties matching "2260 Wellington":`);
      
      if (wellingtonProperties.length > 0) {
        wellingtonProperties.forEach((prop, index) => {
          const sqft = prop.description?.sqft;
          const beds = prop.description?.beds;
          const baths = prop.description?.baths;
          const yearBuilt = prop.year_built;
          const price = prop.last_sold_price;
          const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
          const address = prop.location?.address?.line || 'Unknown address';
          
          console.log(`\n${index+1}. ${address}`);
          console.log(`   ${beds}bed/${baths}bath, ${sqft}sqft, built ${yearBuilt || 'Unknown'}`);
          console.log(`   Price: $${price || 'Unknown'}, Sold: ${soldDate ? soldDate.toISOString().split('T')[0] : 'Unknown'}`);
          
          // Check if it would qualify as a comp for 2173 Wellington Circle
          const subjectBeds = 3;
          const subjectBaths = 2;
          const subjectSqft = 1150;
          const subjectYearBuilt = 1985;
          
          const minSqft = subjectSqft * 0.8; // 920
          const maxSqft = subjectSqft * 1.2; // 1380
          const minYearBuilt = subjectYearBuilt - 10; // 1975
          const maxYearBuilt = subjectYearBuilt + 10; // 1995
          const minBaths = 2;
          const maxBaths = 3;
          const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
          
          let isValidComp = true;
          let issues = [];
          
          if (!price || price <= 0) {
            isValidComp = false;
            issues.push('No price data');
          }
          
          if (!sqft || sqft < minSqft || sqft > maxSqft) {
            isValidComp = false;
            issues.push(`Size ${sqft || 'unknown'} not in range ${minSqft}-${maxSqft}`);
          }
          
          if (beds && Math.abs(beds - subjectBeds) > 1) {
            isValidComp = false;
            issues.push(`Bedroom variance too high (${beds} vs ${subjectBeds})`);
          }
          
          if (baths && (baths < minBaths || baths > maxBaths)) {
            isValidComp = false;
            issues.push(`Bathroom out of range (${baths} not in ${minBaths}-${maxBaths})`);
          }
          
          if (yearBuilt && (yearBuilt < minYearBuilt || yearBuilt > maxYearBuilt)) {
            isValidComp = false;
            issues.push(`Age out of range (${yearBuilt} not in ${minYearBuilt}-${maxYearBuilt})`);
          }
          
          if (!soldDate || soldDate < oneYearAgo) {
            isValidComp = false;
            issues.push(`Sale too old (${soldDate ? soldDate.toISOString().split('T')[0] : 'null'} before ${oneYearAgo.toISOString().split('T')[0]})`);
          }
          
          if (isValidComp) {
            console.log(`   ✅ WOULD BE A VALID COMP for 2173 Wellington Circle`);
          } else {
            console.log(`   ❌ NOT A VALID COMP: ${issues.join(', ')}`);
          }
        });
      } else {
        console.log(`\nNo exact match for "2260 Wellington Circle" found.`);
        
        // Search for all Wellington Circle properties
        const allWellington = townhomes.filter(prop => {
          const address = (prop.location?.address?.line || '').toLowerCase();
          return address.includes('wellington cir');
        });
        
        console.log(`\nFound ${allWellington.length} Wellington Circle properties total:`);
        allWellington.forEach((prop, index) => {
          const address = prop.location?.address?.line || 'Unknown address';
          const sqft = prop.description?.sqft;
          const beds = prop.description?.beds;
          const baths = prop.description?.baths;
          const price = prop.last_sold_price;
          const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
          
          console.log(`${index+1}. ${address} - ${beds}bed/${baths}bath, ${sqft}sqft, $${price || 'Unknown'}, sold ${soldDate ? soldDate.toISOString().split('T')[0] : 'Unknown'}`);
        });
      }
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

check2260Wellington();
