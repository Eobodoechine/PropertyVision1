const apiKey = process.env.RAPIDAPI_KEY;

async function checkValidComps() {
  try {
    // Get coordinates for 2025 Austin Park Circle
    const encodedAddress = encodeURIComponent("2025 Austin Park Cir, Decatur, GA 30032");
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
    
    // Subject property: 1252 sqft
    const subjectSqft = 1252;
    const minSqft = Math.round(subjectSqft * 0.8);  // 1002
    const maxSqft = Math.round(subjectSqft * 1.2);  // 1502
    
    console.log(`Subject: ${subjectSqft} sqft`);
    console.log(`Valid range: ${minSqft}-${maxSqft} sqft`);
    
    // Search 1 mile radius
    const radiusInDegrees = 1 * 0.0145;
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
      type: ["townhomes", "condos", "single_family"],
      sqft_min: minSqft,
      sqft_max: maxSqft
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
    
    console.log(`\nRaw API results: ${foundProperties.length} properties`);
    
    // Apply strict validation for true comparables
    const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
    let validComps = [];
    let filteredOut = {
      noSqft: 0,
      noPrice: 0,
      noDate: 0,
      oldSale: 0,
      lowPrice: 0,
      outlierPricePerSqft: 0,
      wrongSize: 0
    };
    
    foundProperties.forEach(prop => {
      const sqft = prop.description?.sqft;
      const price = prop.last_sold_price;
      const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
      const address = prop.location?.address?.line || 'Unknown';
      
      // Check each filter
      if (!sqft || sqft <= 0) {
        filteredOut.noSqft++;
        return;
      }
      
      if (!price || price <= 0) {
        filteredOut.noPrice++;
        return;
      }
      
      if (!soldDate) {
        filteredOut.noDate++;
        return;
      }
      
      if (soldDate < oneYearAgo) {
        filteredOut.oldSale++;
        return;
      }
      
      if (price < 10000) {
        filteredOut.lowPrice++;
        return;
      }
      
      // Strict size check (should already be filtered by API but double-check)
      if (sqft < minSqft || sqft > maxSqft) {
        filteredOut.wrongSize++;
        return;
      }
      
      const pricePerSqft = Math.round(price / sqft);
      
      // Remove outlier price per sqft (likely data errors)
      if (pricePerSqft < 50 || pricePerSqft > 300) {
        filteredOut.outlierPricePerSqft++;
        return;
      }
      
      // Valid comparable
      validComps.push({
        address,
        sqft,
        price,
        pricePerSqft,
        soldDate: soldDate.toISOString().split('T')[0],
        beds: prop.description?.beds,
        baths: prop.description?.baths
      });
    });
    
    console.log(`\nFiltering Results:`);
    console.log(`- No square footage: ${filteredOut.noSqft}`);
    console.log(`- No price: ${filteredOut.noPrice}`);
    console.log(`- No sale date: ${filteredOut.noDate}`);
    console.log(`- Sale older than 1 year: ${filteredOut.oldSale}`);
    console.log(`- Price under $10,000: ${filteredOut.lowPrice}`);
    console.log(`- Wrong size (outside ${minSqft}-${maxSqft}): ${filteredOut.wrongSize}`);
    console.log(`- Price/sqft outlier (<$50 or >$300): ${filteredOut.outlierPricePerSqft}`);
    
    console.log(`\n*** TRUE VALID COMPARABLES: ${validComps.length} ***`);
    
    if (validComps.length > 0) {
      console.log(`\nValid Comparables (showing first 15):`);
      validComps.slice(0, 15).forEach((comp, index) => {
        console.log(`${index + 1}. ${comp.address} - ${comp.sqft} sqft, $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft) - ${comp.soldDate}`);
      });
      
      // Price range analysis
      const prices = validComps.map(c => c.price);
      const pricesPerSqft = validComps.map(c => c.pricePerSqft);
      
      prices.sort((a, b) => a - b);
      pricesPerSqft.sort((a, b) => a - b);
      
      console.log(`\nPrice Range: $${prices[0].toLocaleString()} - $${prices[prices.length-1].toLocaleString()}`);
      console.log(`Price/Sqft Range: $${pricesPerSqft[0]} - $${pricesPerSqft[pricesPerSqft.length-1]}`);
      
      const medianPrice = prices[Math.floor(prices.length / 2)];
      const medianPricePerSqft = pricesPerSqft[Math.floor(pricesPerSqft.length / 2)];
      
      console.log(`\nMedian price: $${medianPrice.toLocaleString()}`);
      console.log(`Median $/sqft: $${medianPricePerSqft}`);
      console.log(`ARV estimate: $${Math.round(medianPricePerSqft * subjectSqft).toLocaleString()}`);
    }
    
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

checkValidComps();
