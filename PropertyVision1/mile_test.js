// Mile-by-mile analysis for 3623 Stanford Cir, Decatur, GA 30034
const apiKey = process.env.RAPIDAPI_KEY;

async function analyzeByMiles() {
  console.log('🎯 MILE-BY-MILE ANALYSIS: 3623 Stanford Cir, Decatur, GA 30034');
  console.log('Subject Property: 1080 sqft, 3 bed/1 bath, built 2000');
  console.log('Size range filter: 864-1296 sqft (±20%)');
  console.log('Date filters: 1-year vs 2-year comparison\n');
  
  // Coordinates for 3623 Stanford Cir
  const centerLat = 33.7001;
  const centerLon = -84.2908;
  
  const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
  const twoYearsAgo = new Date(Date.now() - (24 * 30 * 24 * 60 * 60 * 1000));
  
  for (let radius = 1; radius <= 5; radius++) {
    console.log(`\n🎯 === ${radius} MILE RADIUS ANALYSIS ===`);
    
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
      type: ["single_family"]
    };
    
    try {
      const response = await fetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'realty-in-us.p.rapidapi.com'
        },
        body: JSON.stringify(searchPayload)
      });
      
      if (!response.ok) {
        console.log(`❌ ${radius} MILE SEARCH FAILED: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const properties = data?.data?.home_search?.results || [];
      
      console.log(`📊 TOTAL PROPERTIES FOUND: ${properties.length}`);
      
      // Filter and categorize properties
      const validWith1Year = [];
      const validWith2Years = [];
      const sizeMismatches = [];
      const dateTooOld = [];
      const missingData = [];
      
      properties.forEach(prop => {
        const sqft = prop.description?.sqft;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown';
        
        const propData = {
          address,
          price,
          sqft,
          soldDate: soldDate ? soldDate.toISOString().split('T')[0] : null,
          pricePerSqft: sqft && price ? Math.round(price / sqft) : null
        };
        
        if (!price || price <= 10000) {
          missingData.push({...propData, reason: 'No price'});
        } else if (!sqft || sqft <= 0) {
          missingData.push({...propData, reason: 'No sqft'});
        } else if (!soldDate) {
          missingData.push({...propData, reason: 'No sold date'});
        } else if (sqft < 864 || sqft > 1296) {
          sizeMismatches.push({...propData, reason: `Size ${sqft} outside range`});
        } else if (soldDate < twoYearsAgo) {
          dateTooOld.push({...propData, reason: 'Older than 2 years'});
        } else if (soldDate < oneYearAgo) {
          validWith2Years.push(propData);
        } else {
          validWith1Year.push(propData);
        }
      });
      
      console.log(`\n📈 FILTERING BREAKDOWN:`);
      console.log(`   • Valid with 1-year filter: ${validWith1Year.length}`);
      console.log(`   • Additional with 2-year filter: ${validWith2Years.length}`);
      console.log(`   • Size mismatches (outside 864-1296): ${sizeMismatches.length}`);
      console.log(`   • Too old (>2 years): ${dateTooOld.length}`);
      console.log(`   • Missing critical data: ${missingData.length}`);
      
      // Show valid 1-year comparables
      if (validWith1Year.length > 0) {
        console.log(`\n✅ VALID 1-YEAR COMPARABLES:`);
        validWith1Year.forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address}`);
          console.log(`      $${comp.price?.toLocaleString()} | ${comp.sqft}sqft | $${comp.pricePerSqft}/sqft | ${comp.soldDate}`);
        });
      }
      
      // Show additional 2-year comparables
      if (validWith2Years.length > 0) {
        console.log(`\n⚠️ ADDITIONAL 2-YEAR COMPARABLES (excluded by current 1-year filter):`);
        validWith2Years.slice(0, 5).forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address}`);
          console.log(`      $${comp.price?.toLocaleString()} | ${comp.sqft}sqft | $${comp.pricePerSqft}/sqft | ${comp.soldDate}`);
        });
        if (validWith2Years.length > 5) {
          console.log(`   ... and ${validWith2Years.length - 5} more`);
        }
      }
      
      // Show some size mismatches for context
      if (sizeMismatches.length > 0 && radius === 1) {
        console.log(`\n❌ SAMPLE SIZE MISMATCHES (showing first 3):`);
        sizeMismatches.slice(0, 3).forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address} - ${comp.sqft}sqft (${comp.reason})`);
        });
      }
      
      console.log(`\n🚦 ${radius} MILE SUMMARY: ${validWith1Year.length} valid comparables found`);
      console.log(`   With 2-year filter would have: ${validWith1Year.length + validWith2Years.length} total`);
      
      // Stop if sufficient comparables found
      if (validWith1Year.length >= 5) {
        console.log(`✅ SUFFICIENT COMPARABLES FOUND - Stopping at ${radius} miles`);
        break;
      } else if (validWith1Year.length + validWith2Years.length >= 5) {
        console.log(`💡 SUGGESTION: 2-year filter would provide sufficient comparables`);
      }
      
    } catch (error) {
      console.log(`❌ Error at ${radius} miles:`, error.message);
    }
  }
}

analyzeByMiles().catch(console.error);
