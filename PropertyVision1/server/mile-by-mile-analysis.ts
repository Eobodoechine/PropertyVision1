// Mile-by-mile analysis tool for detailed property search debugging
import { loggedFetch } from './infra/rapid';
export class MileByMileAnalyzer {
  
  async analyzeByRadius(centerLat: number, centerLon: number, maxRadius: number = 5) {
    const results = [];
    
    for (let radius = 1; radius <= maxRadius; radius++) {
      console.log(`\n🎯 === ANALYZING ${radius} MILE RADIUS ===`);
      
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
      
      const searchResponse = await loggedFetch('https://realty-in-us.p.rapidapi.com/properties/v3/list', {
        method: 'POST',
        body: JSON.stringify(searchPayload)
      });
      
      if (!searchResponse.ok) {
        console.log(`❌ ${radius} MILE SEARCH FAILED: ${searchResponse.status}`);
        continue;
      }
      
      const searchData = await searchResponse.json();
      const foundProperties = searchData?.data?.home_search?.results || [];
      
      console.log(`📊 ${radius} MILE RADIUS RESULTS:`);
      console.log(`   • Total properties found: ${foundProperties.length}`);
      
      // Analyze properties by criteria
      const oneYearAgo = new Date(Date.now() - (12 * 30 * 24 * 60 * 60 * 1000));
      const twoYearsAgo = new Date(Date.now() - (24 * 30 * 24 * 60 * 60 * 1000));
      
      const validWith1Year = [];
      const validWith2Years = [];
      const sizeMismatches = [];
      const dateTooOld = [];
      const missingData = [];
      
      foundProperties.forEach((prop: any, index: number) => {
        const sqft = prop.description?.sqft;
        const price = prop.last_sold_price;
        const soldDate = prop.last_sold_date ? new Date(prop.last_sold_date) : null;
        const address = prop.location?.address?.line || 'Unknown';
        const beds = prop.description?.beds;
        const baths = prop.description?.baths;
        
        const propData = {
          address,
          price,
          sqft,
          beds,
          baths,
          soldDate: soldDate ? soldDate.toISOString().split('T')[0] : null,
          pricePerSqft: sqft && price ? Math.round(price / sqft) : null
        };
        
        if (!price || price <= 10000) {
          missingData.push({...propData, reason: 'No price'});
        } else if (!sqft || sqft <= 0) {
          missingData.push({...propData, reason: 'No sqft'});
        } else if (!soldDate) {
          missingData.push({...propData, reason: 'No sold date'});
        } else if (sqft < 864 || sqft > 1296) { // ±20% of 1080 sqft
          sizeMismatches.push({...propData, reason: `Size ${sqft} outside 864-1296 range`});
        } else if (soldDate < twoYearsAgo) {
          dateTooOld.push({...propData, reason: 'Older than 2 years'});
        } else if (soldDate < oneYearAgo) {
          validWith2Years.push(propData);
        } else {
          validWith1Year.push(propData);
        }
      });
      
      console.log(`\n📈 ${radius} MILE FILTERING BREAKDOWN:`);
      console.log(`   • Valid with 1-year filter: ${validWith1Year.length}`);
      console.log(`   • Valid with 2-year filter: ${validWith2Years.length}`);
      console.log(`   • Size mismatches: ${sizeMismatches.length}`);
      console.log(`   • Too old (>2 years): ${dateTooOld.length}`);
      console.log(`   • Missing data: ${missingData.length}`);
      
      // Show valid comparables
      if (validWith1Year.length > 0) {
        console.log(`\n✅ VALID 1-YEAR COMPARABLES (${radius} MILE):`);
        validWith1Year.forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address}`);
          console.log(`      $${comp.price?.toLocaleString()} | ${comp.sqft}sqft | $${comp.pricePerSqft}/sqft | ${comp.soldDate}`);
        });
      }
      
      if (validWith2Years.length > 0) {
        console.log(`\n⚠️ ADDITIONAL 2-YEAR COMPARABLES (${radius} MILE):`);
        validWith2Years.forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address}`);
          console.log(`      $${comp.price?.toLocaleString()} | ${comp.sqft}sqft | $${comp.pricePerSqft}/sqft | ${comp.soldDate}`);
        });
      }
      
      // Show some excluded properties for context
      if (sizeMismatches.length > 0) {
        console.log(`\n❌ SIZE MISMATCHES (showing first 5):`);
        sizeMismatches.slice(0, 5).forEach((comp, i) => {
          console.log(`   ${i+1}. ${comp.address} - ${comp.sqft}sqft (${comp.reason})`);
        });
      }
      
      results.push({
        radius,
        totalFound: foundProperties.length,
        validWith1Year: validWith1Year.length,
        validWith2Years: validWith2Years.length,
        validComparables1Year: validWith1Year,
        validComparables2Years: validWith2Years,
        sizeMismatches: sizeMismatches.length,
        dateTooOld: dateTooOld.length,
        missingData: missingData.length
      });
      
      console.log(`\n🚦 ${radius} MILE DECISION: ${validWith1Year.length} valid comparables found`);
      
      // Stop if we have enough comparables with 1-year filter
      if (validWith1Year.length >= 5) {
        console.log(`✅ SUFFICIENT COMPARABLES FOUND AT ${radius} MILES - Analysis complete`);
        break;
      }
    }
    
    return results;
  }
}
