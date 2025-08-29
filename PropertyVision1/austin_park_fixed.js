const apiKey = process.env.RAPIDAPI_KEY;

async function analyzeAustinParkPropertyFixed() {
  const address = "2025 Austin Park Cir, Decatur, GA 30032";
  console.log(`Step 1: Getting exact coordinates for ${address}`);
  
  try {
    // Step 1: Get exact coordinates (already working)
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
    const properties = coordData.autocomplete?.filter(item => item.area_type === 'address') || [];
    const selectedProperty = properties[0];
    const centerLon = selectedProperty.centroid.lon;
    const centerLat = selectedProperty.centroid.lat;
    
    console.log(`✅ Found coordinates: ${centerLat}, ${centerLon}`);
    
    // Step 2: FIXED - Remove restrictive filters to find the property
    console.log(`\nStep 2: Getting subject property details (with broader search)...`);
    
    const detailsPayload = {
      limit: 50,  // Increased limit
      offset: 0,
      coordinates: [[centerLon, centerLat]]
      // REMOVED status filter to find any property at this location
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
    
    const detailsData = await detailsResponse.json();
    const allProperties = detailsData?.data?.home_search?.results || [];
    
    console.log(`Found ${allProperties.length} properties at these coordinates`);
    
    if (allProperties.length === 0) {
      console.log("❌ STUCK: No properties found at exact coordinates - trying small radius search");
      
      // Fallback: Small radius search
      const smallRadius = 0.002; // Very small radius
      const boundary = [
        [centerLon - smallRadius, centerLat - smallRadius],
        [centerLon + smallRadius, centerLat - smallRadius],
        [centerLon + smallRadius, centerLat + smallRadius],
        [centerLon - smallRadius, centerLat + smallRadius],
        [centerLon - smallRadius, centerLat - smallRadius]
      ];
      
      const radiusPayload = {
        limit: 50,
        offset: 0,
        boundary: { coordinates: [boundary] }
      };
      
      const radiusResponse = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
        },
        body: JSON.stringify(radiusPayload)
      });
      
      const radiusData = await radiusResponse.json();
      const nearbyProperties = radiusData?.data?.home_search?.results || [];
      
      console.log(`Found ${nearbyProperties.length} properties in small radius`);
      
      if (nearbyProperties.length > 0) {
        console.log("Nearby properties:");
        nearbyProperties.slice(0, 5).forEach(prop => {
          console.log(`- ${prop.location?.address?.line || 'Unknown'}`);
        });
      }
      
      return;
    }
    
    // Show all properties found to identify the subject
    console.log("Properties found at coordinates:");
    allProperties.forEach((prop, index) => {
      console.log(`${index + 1}. ${prop.location?.address?.line || 'Unknown'} - ${prop.prop_type} - ${prop.description?.sqft || 'N/A'} sqft`);
    });
    
    // Find best match for our subject address
    const subjectProperty = allProperties.find(prop => {
      const propAddress = prop.location?.address?.line || '';
      return propAddress.toLowerCase().includes('2025') && propAddress.toLowerCase().includes('austin park');
    }) || allProperties[0]; // Fallback to first property
    
    const subjectSqft = subjectProperty.description?.sqft;
    const subjectYearBuilt = subjectProperty.year_built;
    const propertyType = subjectProperty.prop_type?.toLowerCase();
    
    console.log(`\nSubject Property Details:`);
    console.log(`- Address: ${subjectProperty.location?.address?.line}`);
    console.log(`- Type: ${propertyType || 'Unknown'}`);
    console.log(`- Size: ${subjectSqft || 'Unknown'} sqft`);
    console.log(`- Year Built: ${subjectYearBuilt || 'Unknown'}`);
    console.log(`- Beds/Baths: ${subjectProperty.description?.beds}/${subjectProperty.description?.baths}`);
    
    if (!subjectSqft) {
      console.log("❌ STUCK: Subject property missing square footage");
      return;
    }
    
    console.log(`\n✅ Ready to proceed with comparable search for ${subjectSqft} sqft ${propertyType}`);
    
  } catch (error) {
    console.log(`❌ STUCK: ${error.message}`);
  }
}

analyzeAustinParkPropertyFixed();
