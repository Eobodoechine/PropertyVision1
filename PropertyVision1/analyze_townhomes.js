const apiKey = process.env.RAPIDAPI_KEY;

async function analyzeTownhomes() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Analyzing townhomes within 5-mile radius...`);
  
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
      
      // Filter for townhomes only
      const townhomes = properties.filter(prop => prop.description?.type === 'townhomes');
      
      console.log(`Total townhomes found: ${townhomes.length}`);
      
      // Analyze square footage data
      let withSqft = 0;
      let withoutSqft = 0;
      let smallerThan1150 = 0;
      let sqftValues = [];
      
      console.log('\n--- TOWNHOME ANALYSIS ---');
      townhomes.forEach((prop, index) => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds || 'Unknown';
        const baths = prop.description?.baths || 'Unknown';
        const price = prop.last_sold_price || 'Unknown';
        const address = prop.location?.address?.line || 'Unknown address';
        
        if (sqft && sqft > 0) {
          withSqft++;
          sqftValues.push(sqft);
          if (sqft < 1150) {
            smallerThan1150++;
          }
        } else {
          withoutSqft++;
        }
        
        // Show first 15 townhomes for detailed analysis
        if (index < 15) {
          console.log(`${index+1}. ${address}`);
          console.log(`   ${beds}bed/${baths}bath, ${sqft || 'NO SQFT DATA'}sqft, $${price}`);
          if (sqft && sqft < 1150) {
            console.log(`   ✓ SMALLER than 1150 sqft`);
          }
          console.log('');
        }
      });
      
      // Calculate statistics
      console.log(`\n--- SQUARE FOOTAGE STATISTICS ---`);
      console.log(`Townhomes with sqft data: ${withSqft} out of ${townhomes.length} (${((withSqft/townhomes.length)*100).toFixed(1)}%)`);
      console.log(`Townhomes without sqft data: ${withoutSqft} out of ${townhomes.length} (${((withoutSqft/townhomes.length)*100).toFixed(1)}%)`);
      
      if (sqftValues.length > 0) {
        const minSqft = Math.min(...sqftValues);
        const maxSqft = Math.max(...sqftValues);
        const avgSqft = Math.round(sqftValues.reduce((a, b) => a + b, 0) / sqftValues.length);
        
        console.log(`\nSquare footage range: ${minSqft} - ${maxSqft} sqft`);
        console.log(`Average square footage: ${avgSqft} sqft`);
        console.log(`\nTownhomes smaller than 1150 sqft: ${smallerThan1150} out of ${withSqft} with data (${((smallerThan1150/withSqft)*100).toFixed(1)}%)`);
        
        // Show size distribution
        const under1000 = sqftValues.filter(s => s < 1000).length;
        const between1000_1150 = sqftValues.filter(s => s >= 1000 && s < 1150).length;
        const between1150_1300 = sqftValues.filter(s => s >= 1150 && s < 1300).length;
        const over1300 = sqftValues.filter(s => s >= 1300).length;
        
        console.log(`\n--- SIZE DISTRIBUTION ---`);
        console.log(`Under 1,000 sqft: ${under1000} townhomes`);
        console.log(`1,000-1,149 sqft: ${between1000_1150} townhomes`);
        console.log(`1,150-1,299 sqft: ${between1150_1300} townhomes`);
        console.log(`1,300+ sqft: ${over1300} townhomes`);
      }
      
      console.log(`\nANSWER: ${withSqft} out of ${townhomes.length} townhomes have sqft data`);
      console.log(`ANSWER: ${smallerThan1150} townhomes are smaller than 1150 sqft`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

analyzeTownhomes();
