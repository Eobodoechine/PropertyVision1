const apiKey = process.env.RAPIDAPI_KEY;

async function getDetailedCompsAndARV() {
  const centerLon = -84.1389;
  const centerLat = 33.6896;
  const radius = 0.070; // 5 miles
  
  console.log(`Getting detailed comp list and calculating ARV...`);
  
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
    status: ["sold"],
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
      const soldTownhomes = data?.data?.home_search?.results || [];
      
      // Subject property
      const subjectSqft = 1150;
      const subjectBeds = 3;
      const subjectBaths = 2;
      const subjectYearBuilt = 1985;
      
      // Filtering criteria
      const minSqft = subjectSqft * 0.8; // 920
      const maxSqft = subjectSqft * 1.2; // 1380
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const sixMonthsAgo = new Date(Date.now() - (6 * 30 * 24 * 60 * 60 * 1000));
      
      // Find valid comps
      const validComps = [];
      
      soldTownhomes.forEach(prop => {
        const sqft = prop.description?.sqft;
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown address';
        const yearBuilt = prop.year_built;
        
        // Check if valid comp
        if (sqft && sqft >= minSqft && sqft <= maxSqft && 
            price && price > 0 && 
            soldDate && soldDate >= oneYearAgo) {
          
          const pricePerSqft = Math.round(price / sqft);
          const isRecent6mo = soldDate >= sixMonthsAgo;
          
          validComps.push({
            address,
            sqft,
            beds,
            baths,
            price,
            soldDate: soldDate.toISOString().split('T')[0],
            pricePerSqft,
            yearBuilt,
            isRecent6mo,
            daysAgo: Math.round((Date.now() - soldDate.getTime()) / (1000 * 60 * 60 * 24))
          });
        }
      });
      
      // Sort by sale date (most recent first)
      validComps.sort((a, b) => new Date(b.soldDate) - new Date(a.soldDate));
      
      console.log(`\n=== VALID COMPARABLE SALES ===`);
      console.log(`Subject: 2173 Wellington Circle - 3bed/2bath, 1150 sqft, built 1985`);
      console.log(`Filter criteria: 920-1380 sqft, sold within 12 months\n`);
      
      validComps.forEach((comp, index) => {
        const recentFlag = comp.isRecent6mo ? ' (6-MO)' : ' (12-MO)';
        console.log(`${index + 1}. ${comp.address}${recentFlag}`);
        console.log(`   ${comp.beds}bed/${comp.baths}bath, ${comp.sqft} sqft, built ${comp.yearBuilt || 'Unknown'}`);
        console.log(`   Sold: ${comp.soldDate} (${comp.daysAgo} days ago)`);
        console.log(`   Price: $${comp.price.toLocaleString()} ($${comp.pricePerSqft}/sqft)`);
        console.log('');
      });
      
      if (validComps.length === 0) {
        console.log('No valid comparables found');
        return;
      }
      
      // ARV Calculation using IQR method
      const prices = validComps.map(comp => comp.price).sort((a, b) => a - b);
      const pricesPerSqft = validComps.map(comp => comp.pricePerSqft).sort((a, b) => a - b);
      
      console.log(`=== ARV CALCULATION ===`);
      console.log(`Total valid comps: ${validComps.length}`);
      console.log(`Price range: $${prices[0].toLocaleString()} - $${prices[prices.length-1].toLocaleString()}`);
      console.log(`Price/sqft range: $${pricesPerSqft[0]} - $${pricesPerSqft[pricesPerSqft.length-1]}`);
      
      // IQR outlier removal
      function removeOutliers(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const q1Index = Math.floor(sorted.length * 0.25);
        const q3Index = Math.floor(sorted.length * 0.75);
        const q1 = sorted[q1Index];
        const q3 = sorted[q3Index];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;
        
        return arr.filter(val => val >= lowerBound && val <= upperBound);
      }
      
      const filteredPrices = removeOutliers(prices);
      const filteredPricesPerSqft = removeOutliers(pricesPerSqft);
      
      console.log(`After IQR outlier removal: ${filteredPrices.length} comps remaining`);
      
      // Upper cluster analysis (≥65th percentile)
      const p65Index = Math.floor(filteredPrices.length * 0.65);
      const upperClusterPrices = filteredPrices.slice(p65Index);
      const upperClusterPricesPerSqft = filteredPricesPerSqft.slice(Math.floor(filteredPricesPerSqft.length * 0.65));
      
      console.log(`Upper cluster (≥65th percentile): ${upperClusterPrices.length} comps`);
      
      // Calculate ARV using upper cluster median
      function median(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
          ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
          : sorted[mid];
      }
      
      const medianPrice = median(filteredPrices);
      const medianPricePerSqft = median(filteredPricesPerSqft);
      const upperClusterMedianPrice = median(upperClusterPrices);
      const upperClusterMedianPricePerSqft = median(upperClusterPricesPerSqft);
      
      // ARV calculation methods
      const arvByMedianPrice = Math.round(medianPrice);
      const arvByMedianPricePerSqft = Math.round(medianPricePerSqft * subjectSqft);
      const arvByUpperClusterPrice = Math.round(upperClusterMedianPrice);
      const arvByUpperClusterPricePerSqft = Math.round(upperClusterMedianPricePerSqft * subjectSqft);
      
      // Final ARV (average of upper cluster methods)
      const finalARV = Math.round((arvByUpperClusterPrice + arvByUpperClusterPricePerSqft) / 2);
      
      console.log(`\n--- ARV METHODS ---`);
      console.log(`All comps median price: $${medianPrice.toLocaleString()}`);
      console.log(`All comps median $/sqft: $${medianPricePerSqft} × 1150 = $${arvByMedianPricePerSqft.toLocaleString()}`);
      console.log(`Upper cluster median price: $${upperClusterMedianPrice.toLocaleString()}`);
      console.log(`Upper cluster median $/sqft: $${upperClusterMedianPricePerSqft} × 1150 = $${arvByUpperClusterPricePerSqft.toLocaleString()}`);
      
      console.log(`\n--- FINAL ARV ---`);
      console.log(`ARV (Upper Cluster Average): $${finalARV.toLocaleString()}`);
      
      // Confidence assessment
      const recentComps = validComps.filter(comp => comp.isRecent6mo).length;
      let confidence = 'High';
      if (upperClusterPrices.length < 5) confidence = 'Medium';
      if (upperClusterPrices.length < 3) confidence = 'Low';
      
      console.log(`Confidence Level: ${confidence}`);
      console.log(`- Total comps: ${validComps.length}`);
      console.log(`- Upper cluster comps: ${upperClusterPrices.length}`);
      console.log(`- Recent (6-month) comps: ${recentComps}`);
      
    } else {
      console.log(`API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

getDetailedCompsAndARV();
