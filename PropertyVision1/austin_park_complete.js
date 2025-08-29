const apiKey = process.env.RAPIDAPI_KEY;

async function completeAustinParkAnalysis() {
  const address = "2025 Austin Park Cir, Decatur, GA 30032";
  
  try {
    // Get coordinates
    const encodedAddress = encodeURIComponent(address);
    const autoCompleteUrl = `https://realty-in-us.p.rapidapi.com/locations/v2/auto-complete?input=${encodedAddress}&limit=10`;
    
    const coordResponse = await fetch(autoCompleteUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      }
    });
    
    const coordData = await coordResponse.json();
    const selectedProperty = coordData.autocomplete.filter(item => item.area_type === 'address')[0];
    const centerLon = selectedProperty.centroid.lon;
    const centerLat = selectedProperty.centroid.lat;
    
    console.log(`Coordinates: ${centerLat}, ${centerLon}`);
    
    // Get subject property details using small boundary
    const smallRadius = 0.002;
    const boundary = [
      [centerLon - smallRadius, centerLat - smallRadius],
      [centerLon + smallRadius, centerLat - smallRadius],
      [centerLon + smallRadius, centerLat + smallRadius],
      [centerLon - smallRadius, centerLat + smallRadius],
      [centerLon - smallRadius, centerLat - smallRadius]
    ];
    
    const subjectPayload = {
      limit: 10,
      offset: 0,
      boundary: { coordinates: [boundary] }
    };
    
    const subjectResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      },
      body: JSON.stringify(subjectPayload)
    });
    
    const subjectData = await subjectResponse.json();
    const nearbyProperties = subjectData?.data?.home_search?.results || [];
    
    // Find the exact subject property
    const subjectProperty = nearbyProperties.find(prop => {
      const propAddress = prop.location?.address?.line || '';
      return propAddress.toLowerCase().includes('2025') && propAddress.toLowerCase().includes('austin park');
    });
    
    if (!subjectProperty) {
      console.log("❌ STUCK: Could not identify 2025 Austin Park Circle in nearby properties");
      return;
    }
    
    const subjectSqft = subjectProperty.description?.sqft;
    const subjectYearBuilt = subjectProperty.year_built;
    const propertyType = subjectProperty.prop_type?.toLowerCase();
    
    console.log(`\nSubject Property: ${subjectProperty.location?.address?.line}`);
    console.log(`Type: ${propertyType}, ${subjectSqft} sqft, built ${subjectYearBuilt || 'Unknown'}`);
    console.log(`${subjectProperty.description?.beds}bed/${subjectProperty.description?.baths}bath`);
    
    if (!subjectSqft) {
      console.log("❌ STUCK: Subject property missing square footage");
      return;
    }
    
    // Calculate search parameters
    const minSqft = Math.round(subjectSqft * 0.8);
    const maxSqft = Math.round(subjectSqft * 1.2);
    const minYearBuilt = subjectYearBuilt ? subjectYearBuilt - 10 : undefined;
    const maxYearBuilt = subjectYearBuilt ? subjectYearBuilt + 10 : undefined;
    
    const propertyTypeFilter = propertyType === 'townhome' ? ['townhomes'] :
                              propertyType === 'condo' ? ['condos'] :
                              propertyType === 'single_family' ? ['single_family'] :
                              ['townhomes', 'condos', 'single_family'];
    
    console.log(`Search params: ${minSqft}-${maxSqft} sqft, ${propertyTypeFilter.join('/')}`);
    
    // Start radius search at 1 mile
    let radius = 1;
    let validComps = [];
    
    while (radius <= 5 && validComps.length < 5) {
      console.log(`\nSearching at ${radius} mile radius...`);
      
      const radiusInDegrees = radius * 0.0145;
      const searchBoundary = [
        [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
        [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
        [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
        [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
        [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
      ];
      
      const searchPayload = {
        limit: 400,
        offset: 0,
        boundary: { coordinates: [searchBoundary] },
        status: ["sold"],
        type: propertyTypeFilter,
        sqft_min: minSqft,
        sqft_max: maxSqft,
        ...(minYearBuilt && maxYearBuilt && {
          year_built_min: minYearBuilt,
          year_built_max: maxYearBuilt
        })
      };
      
      const searchResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
        },
        body: JSON.stringify(searchPayload)
      });
      
      const searchData = await searchResponse.json();
      const foundProperties = searchData?.data?.home_search?.results || [];
      
      // Process properties for valid comps
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const radiusValidComps = [];
      
      foundProperties.forEach(prop => {
        const sqft = prop.description?.sqft;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        
        if (sqft && price && price > 10000 && soldDate && soldDate >= oneYearAgo) {
          const pricePerSqft = Math.round(price / sqft);
          if (pricePerSqft >= 50 && pricePerSqft <= 300) {
            radiusValidComps.push({
              address: prop.location?.address?.line || 'Unknown',
              sqft,
              price,
              pricePerSqft,
              soldDate: soldDate.toISOString().split('T')[0],
              beds: prop.description?.beds,
              baths: prop.description?.baths
            });
          }
        }
      });
      
      validComps.push(...radiusValidComps);
      console.log(`Found ${radiusValidComps.length} valid comps (total: ${validComps.length})`);
      
      if (validComps.length >= 5) break;
      radius++;
    }
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Subject: 2025 Austin Park Circle - ${subjectSqft} sqft ${propertyType}`);
    console.log(`Valid comparables: ${validComps.length}`);
    console.log(`Search radius: ${radius} miles`);
    
    if (validComps.length >= 3) {
      console.log(`\nComparables found:`);
      validComps.slice(0, 10).forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.address} - ${comp.sqft} sqft, $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft) - ${comp.soldDate}`);
      });
      
      // Calculate ARV
      const prices = validComps.map(c => c.price).sort((a, b) => a - b);
      const pricesPerSqft = validComps.map(c => c.pricePerSqft).sort((a, b) => a - b);
      
      const median = (arr) => arr[Math.floor(arr.length / 2)];
      const medianPrice = median(prices);
      const medianPricePerSqft = median(pricesPerSqft);
      
      const arvByPrice = medianPrice;
      const arvByPricePerSqft = Math.round(medianPricePerSqft * subjectSqft);
      const finalARV = Math.round((arvByPrice + arvByPricePerSqft) / 2);
      
      console.log(`\nARV Calculation:`);
      console.log(`Median price: $${medianPrice.toLocaleString()}`);
      console.log(`Median $/sqft: $${medianPricePerSqft} × ${subjectSqft} = $${arvByPricePerSqft.toLocaleString()}`);
      console.log(`Final ARV: $${finalARV.toLocaleString()}`);
      
      const confidence = validComps.length >= 5 ? 'High' : 'Medium';
      console.log(`Confidence: ${confidence} (${validComps.length} comps)`);
      
    } else {
      console.log(`❌ STUCK: Insufficient comparables (${validComps.length} < 3 minimum)`);
    }
    
  } catch (error) {
    console.log(`❌ STUCK: ${error.message}`);
  }
}

completeAustinParkAnalysis();
