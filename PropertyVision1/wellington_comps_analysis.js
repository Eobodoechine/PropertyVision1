const apiKey = process.env.RAPIDAPI_KEY;

async function analyzeWellingtonComps() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Analyzing potential comps for 2173 Wellington Circle...`);
  console.log(`Subject: 3bed/2bath, 1150sqft, built 1985 (townhome)`);
  
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
      
      // Filter for townhomes smaller than 1150 sqft
      const smallerTownhomes = townhomes.filter(prop => {
        const sqft = prop.description?.sqft;
        return sqft && sqft > 0 && sqft < 1150;
      });
      
      console.log(`Found ${smallerTownhomes.length} townhomes smaller than 1150 sqft:`);
      
      // Apply ARV filtering criteria
      const subjectBeds = 3;
      const subjectBaths = 2;
      const subjectSqft = 1150;
      const subjectYearBuilt = 1985;
      
      // ARV filtering criteria (matching system logic)
      const minSqft = subjectSqft * 0.8; // 920
      const maxSqft = subjectSqft * 1.2; // 1380
      const minYearBuilt = subjectYearBuilt - 10; // 1975
      const maxYearBuilt = subjectYearBuilt + 10; // 1995
      const minBaths = Math.max(Math.floor(subjectBaths), Math.floor(subjectBaths - 1)); // 1
      const maxBaths = Math.ceil(subjectBaths + 1); // 3
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      
      console.log(`\nARV filtering criteria:`);
      console.log(`- Size: ${minSqft}-${maxSqft} sqft`);
      console.log(`- Age: ${minYearBuilt}-${maxYearBuilt} (built)`);
      console.log(`- Bathrooms: ${minBaths}-${maxBaths}`);
      console.log(`- Bedrooms: ${subjectBeds-1}-${subjectBeds+1} (2-4 beds)`);
      console.log(`- Sale date: After ${sixMonthsAgo.toISOString().split('T')[0]} (6mo) or ${oneYearAgo.toISOString().split('T')[0]} (12mo)`);
      
      let validComps6mo = 0;
      let validComps12mo = 0;
      
      smallerTownhomes.forEach((prop, index) => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const yearBuilt = prop.year_built;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        
        console.log(`\n${index+1}. ${address}`);
        console.log(`   ${beds}bed/${baths}bath, ${sqft}sqft, built ${yearBuilt || 'Unknown'}, $${price || 'Unknown'}`);
        console.log(`   Sold: ${soldDate ? soldDate.toISOString().split('T')[0] : 'Unknown'}`);
        
        // Check ARV criteria
        let passes = true;
        let reasons = [];
        
        if (!price || price <= 0) {
          passes = false;
          reasons.push('No price data');
        }
        
        if (sqft < minSqft || sqft > maxSqft) {
          passes = false;
          reasons.push(`Size out of range (${sqft} not in ${minSqft}-${maxSqft})`);
        }
        
        if (beds && Math.abs(beds - subjectBeds) > 1) {
          passes = false;
          reasons.push(`Bedroom variance too high (${beds} vs ${subjectBeds})`);
        }
        
        if (baths && (baths < minBaths || baths > maxBaths)) {
          passes = false;
          reasons.push(`Bathroom out of range (${baths} not in ${minBaths}-${maxBaths})`);
        }
        
        if (yearBuilt && (yearBuilt < minYearBuilt || yearBuilt > maxYearBuilt)) {
          passes = false;
          reasons.push(`Age out of range (${yearBuilt} not in ${minYearBuilt}-${maxYearBuilt})`);
        }
        
        const passes6mo = passes && soldDate && soldDate >= sixMonthsAgo;
        const passes12mo = passes && soldDate && soldDate >= oneYearAgo;
        
        if (!soldDate || soldDate < oneYearAgo) {
          reasons.push(`Sale too old (${soldDate ? soldDate.toISOString().split('T')[0] : 'null'} before ${oneYearAgo.toISOString().split('T')[0]})`);
        }
        
        if (passes6mo) {
          validComps6mo++;
          console.log(`   ✅ VALID 6-MONTH COMP`);
        } else if (passes12mo) {
          validComps12mo++;
          console.log(`   ✅ VALID 12-MONTH COMP`);
        } else {
          console.log(`   ❌ NOT VALID: ${reasons.join(', ')}`);
        }
      });
      
      console.log(`\n--- SUMMARY ---`);
      console.log(`Total townhomes under 1150 sqft: ${smallerTownhomes.length}`);
      console.log(`Valid 6-month comps: ${validComps6mo}`);
      console.log(`Valid 12-month comps: ${validComps12mo}`);
      console.log(`\nANSWER: Out of 8 smaller townhomes, ${validComps6mo} qualify as 6-month comps and ${validComps12mo} as 12-month comps for Wellington Circle`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

analyzeWellingtonComps();
