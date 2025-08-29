const apiKey = process.env.RAPIDAPI_KEY;

async function analyzeAustinParkProperty() {
  const address = "2025 Austin Park Cir, Decatur, GA 30032";
  console.log(`Step 1: Getting exact coordinates for ${address}`);
  
  try {
    // Step 1: Get exact coordinates using auto-complete endpoint
    const encodedAddress = encodeURIComponent(address);
    const autoCompleteUrl = `https://realty-in-us.p.rapidapi.com/locations/v2/auto-complete?input=${encodedAddress}&limit=10`;
    
    const coordResponse = await fetch(autoCompleteUrl, {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      }
    });
    
    if (!coordResponse.ok) {
      throw new Error(`Coordinate lookup failed: ${coordResponse.status}`);
    }
    
    const coordData = await coordResponse.json();
    const properties = coordData.autocomplete?.filter(item => item.area_type === 'address') || [];
    
    if (properties.length === 0) {
      console.log("❌ STUCK: No exact address found in auto-complete results");
      console.log("Available results:", coordData.autocomplete?.map(item => `${item.area_type}: ${item.line || item.city}`));
      return;
    }
    
    const selectedProperty = properties[0];
    const centerLon = selectedProperty.centroid.lon;
    const centerLat = selectedProperty.centroid.lat;
    
    console.log(`✅ Found coordinates: ${centerLat}, ${centerLon}`);
    console.log(`Property: ${selectedProperty.line}, ${selectedProperty.city}, ${selectedProperty.state_code}`);
    
    // Step 2: Get subject property details first
    console.log(`\nStep 2: Getting subject property details...`);
    
    const detailsPayload = {
      limit: 1,
      offset: 0,
      coordinates: [[centerLon, centerLat]],
      status: ["for_sale", "sold", "off_market", "pending"]
    };
    
    const detailsResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
      },
      body: JSON.stringify(detailsPayload)
    });
    
    if (!detailsResponse.ok) {
      console.log("❌ STUCK: Subject property details lookup failed");
      return;
    }
    
    const detailsData = await detailsResponse.json();
    const subjectProperties = detailsData?.data?.home_search?.results || [];
    
    if (subjectProperties.length === 0) {
      console.log("❌ STUCK: Subject property not found in property database");
      return;
    }
    
    const subjectProperty = subjectProperties[0];
    const subjectSqft = subjectProperty.description?.sqft;
    const subjectYearBuilt = subjectProperty.year_built;
    const subjectBeds = subjectProperty.description?.beds;
    const subjectBaths = subjectProperty.description?.baths;
    const propertyType = subjectProperty.prop_type?.toLowerCase();
    
    console.log(`Subject Property Details:`);
    console.log(`- Address: ${subjectProperty.location?.address?.line}`);
    console.log(`- Type: ${propertyType || 'Unknown'}`);
    console.log(`- Size: ${subjectSqft || 'Unknown'} sqft`);
    console.log(`- Year Built: ${subjectYearBuilt || 'Unknown'}`);
    console.log(`- Beds/Baths: ${subjectBeds}/${subjectBaths}`);
    
    if (!subjectSqft) {
      console.log("❌ STUCK: Subject property missing square footage - cannot set search parameters");
      return;
    }
    
    // Step 3: Calculate search parameters
    const minSqft = Math.round(subjectSqft * 0.8);
    const maxSqft = Math.round(subjectSqft * 1.2);
    const minYearBuilt = subjectYearBuilt ? subjectYearBuilt - 10 : undefined;
    const maxYearBuilt = subjectYearBuilt ? subjectYearBuilt + 10 : undefined;
    
    console.log(`\nStep 3: Search parameters calculated:`);
    console.log(`- Size range: ${minSqft}-${maxSqft} sqft`);
    console.log(`- Year range: ${minYearBuilt || 'Any'}-${maxYearBuilt || 'Any'}`);
    console.log(`- Property type: ${propertyType}`);
    
    // Step 4: Start radius search at 1 mile
    console.log(`\nStep 4: Starting radius search at 1 mile...`);
    
    const propertyTypeFilter = propertyType === 'townhome' ? ['townhomes'] :
                              propertyType === 'condo' ? ['condos'] :
                              propertyType === 'single_family' ? ['single_family'] :
                              ['townhomes', 'condos', 'single_family']; // Default to all if unknown
    
    let radius = 1;
    const maxRadius = 5;
    let validComps = [];
    let researchCandidates = [];
    
    while (radius <= maxRadius && validComps.length < 5) {
      console.log(`\n--- Searching at ${radius} mile radius ---`);
      
      const radiusInDegrees = radius * 0.0145; // Approximate conversion
      const boundary = [
        [centerLon - radiusInDegrees, centerLat - radiusInDegrees],
        [centerLon + radiusInDegrees, centerLat - radiusInDegrees],
        [centerLon + radiusInDegrees, centerLat + radiusInDegrees],
        [centerLon - radiusInDegrees, centerLat + radiusInDegrees],
        [centerLon - radiusInDegrees, centerLat - radiusInDegrees]
      ];
      
      const searchPayload = {
        limit: 400,
        offset: 0,
        boundary: { coordinates: [boundary] },
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
      
      if (!searchResponse.ok) {
        console.log(`❌ STUCK: Search failed at ${radius} miles: ${searchResponse.status}`);
        return;
      }
      
      const searchData = await searchResponse.json();
      const foundProperties = searchData?.data?.home_search?.results || [];
      
      console.log(`Found ${foundProperties.length} properties at ${radius} miles`);
      
      // Process properties
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      
      foundProperties.forEach(prop => {
        const sqft = prop.description?.sqft;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown';
        
        const hasValidPrice = price && price > 10000;
        const hasRecentSale = soldDate && soldDate >= oneYearAgo;
        
        if (hasValidPrice && hasRecentSale) {
          if (sqft && sqft > 0) {
            const pricePerSqft = Math.round(price / sqft);
            if (pricePerSqft >= 50 && pricePerSqft <= 300) {
              validComps.push({
                address,
                sqft,
                price,
                pricePerSqft,
                soldDate: soldDate.toISOString().split('T')[0],
                beds: prop.description?.beds,
                baths: prop.description?.baths
              });
            }
          } else {
            // Research candidate - has price and date but missing sqft
            researchCandidates.push({
              address,
              price,
              soldDate: soldDate.toISOString().split('T')[0],
              missingData: ['sqft']
            });
          }
        }
      });
      
      console.log(`At ${radius} miles: ${validComps.length} valid comps, ${researchCandidates.length} research candidates`);
      
      if (validComps.length >= 5) {
        console.log(`✅ Sufficient comparables found at ${radius} miles`);
        break;
      }
      
      radius++;
    }
    
    console.log(`\n=== FINAL RESULTS ===`);
    console.log(`Subject: ${address} - ${subjectSqft} sqft`);
    console.log(`Valid comparables found: ${validComps.length}`);
    console.log(`Research candidates: ${researchCandidates.length}`);
    console.log(`Search completed at: ${radius <= maxRadius ? radius : maxRadius} miles`);
    
    if (validComps.length > 0) {
      console.log(`\nValid Comparables:`);
      validComps.slice(0, 10).forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.address} - ${comp.sqft} sqft, $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft) - ${comp.soldDate}`);
      });
      
      // Quick ARV calculation
      const prices = validComps.map(c => c.price).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)];
      const pricesPerSqft = validComps.map(c => c.pricePerSqft).sort((a, b) => a - b);
      const medianPricePerSqft = pricesPerSqft[Math.floor(pricesPerSqft.length / 2)];
      
      const arvByPrice = median;
      const arvByPricePerSqft = Math.round(medianPricePerSqft * subjectSqft);
      const finalARV = Math.round((arvByPrice + arvByPricePerSqft) / 2);
      
      console.log(`\nQuick ARV Calculation:`);
      console.log(`Median price: $${median.toLocaleString()}`);
      console.log(`Median $/sqft: $${medianPricePerSqft} × ${subjectSqft} = $${arvByPricePerSqft.toLocaleString()}`);
      console.log(`Estimated ARV: $${finalARV.toLocaleString()}`);
    }
    
    if (validComps.length < 3) {
      console.log(`\n❌ STUCK: Insufficient comparables found (${validComps.length} < 3 minimum)`);
      console.log(`Next step would be: Research ${researchCandidates.length} properties with missing data`);
    }
    
  } catch (error) {
    console.log(`❌ STUCK: ${error.message}`);
  }
}

analyzeAustinParkProperty();
