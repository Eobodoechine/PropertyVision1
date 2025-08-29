const apiKey = process.env.RAPIDAPI_KEY;

async function analyzePropertyTypes() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Analyzing property types within 5-mile radius...`);
  
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
    status: ["sold", "for_sale", "off_market", "pending", "new", "price_reduced"]
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
      const properties = data?.data?.home_search?.results || [];
      
      console.log(`Total properties found: ${properties.length}`);
      
      // Analyze property types
      const typeCount = {};
      const subTypeCount = {};
      let sampleProperties = [];
      
      properties.forEach((prop, index) => {
        const type = prop.description?.type || 'Unknown';
        const subType = prop.description?.sub_type || 'Unknown';
        const beds = prop.description?.beds || 'Unknown';
        const baths = prop.description?.baths || 'Unknown';
        const sqft = prop.description?.sqft || 'Unknown';
        const price = prop.last_sold_price || 'Unknown';
        
        typeCount[type] = (typeCount[type] || 0) + 1;
        subTypeCount[subType] = (subTypeCount[subType] || 0) + 1;
        
        // Collect sample properties
        if (index < 10) {
          sampleProperties.push({
            type,
            subType,
            beds,
            baths,
            sqft,
            price,
            address: prop.location?.address?.line || 'Unknown address'
          });
        }
      });
      
      console.log('\n--- PROPERTY TYPE BREAKDOWN ---');
      Object.entries(typeCount).forEach(([type, count]) => {
        console.log(`${type}: ${count} properties (${((count/properties.length)*100).toFixed(1)}%)`);
      });
      
      console.log('\n--- PROPERTY SUB-TYPE BREAKDOWN ---');
      Object.entries(subTypeCount).forEach(([subType, count]) => {
        console.log(`${subType}: ${count} properties (${((count/properties.length)*100).toFixed(1)}%)`);
      });
      
      console.log('\n--- SAMPLE PROPERTIES ---');
      sampleProperties.forEach((prop, i) => {
        console.log(`${i+1}. ${prop.address}`);
        console.log(`   Type: ${prop.type} | Sub-type: ${prop.subType}`);
        console.log(`   ${prop.beds}bed/${prop.baths}bath, ${prop.sqft}sqft, $${prop.price}`);
        console.log('');
      });
      
      // Check specifically for townhomes
      const townhomes = typeCount['townhomes'] || 0;
      const totalProps = properties.length;
      console.log(`\nANSWER: ${townhomes} out of ${totalProps} properties are townhomes (${((townhomes/totalProps)*100).toFixed(1)}%)`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

analyzePropertyTypes();
