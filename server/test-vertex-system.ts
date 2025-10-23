import 'dotenv/config';
import { VertexComparableSearchService } from './step3-find-comparables';
import { VertexPropertyResearchService } from './step2-property-research';

async function testVertexSystem() {
  const address = process.env.ADDRESS;
  if (!address) {
    console.error('❌ ADDRESS environment variable is required');
    process.exit(1);
  }

  console.log('🎯 TESTING VERTEX-ONLY SYSTEM');
  console.log('============================================================');
  console.log(`📍 Subject Property: ${address}`);
  console.log(`🏘️  Subdivision Filter: ${process.env.SUBDIVISION || 'None'}`);
  console.log('');

  try {
    // Step 1: Property Research
    console.log('🔍 STEP 1: PROPERTY RESEARCH');
    console.log('------------------------------------------------------------');
    const researchService = new VertexPropertyResearchService();
    const propertyDetails = await researchService.researchProperty(address);

    if (propertyDetails.success) {
      console.log('✅ Property details found:');
      console.log(`   📐 Square Feet: ${propertyDetails.sqft || 'Unknown'}`);
      console.log(`   🛏️  Bedrooms: ${propertyDetails.beds || 'Unknown'}`);
      console.log(`   🚿 Bathrooms: ${propertyDetails.baths || 'Unknown'}`);
      console.log(`   📅 Year Built: ${propertyDetails.yearBuilt || 'Unknown'}`);
      console.log(`   🏞️  Lot Size: ${propertyDetails.lotSize || 'Unknown'}`);
    } else {
      console.log('❌ Property research failed');
      return;
    }

    console.log('');

    // Step 2: Comparable Search
    console.log('🔍 STEP 2: COMPARABLE SEARCH');
    console.log('------------------------------------------------------------');
    const compService = new VertexComparableSearchService();

    // Pass subject details for enhanced filtering
    const subjectDetails = {
      sqft: propertyDetails.sqft!,
      beds: propertyDetails.beds!,
      baths: propertyDetails.baths!,
      yearBuilt: propertyDetails.yearBuilt!
    };

    console.log(`   🎯 Subject filters: ${subjectDetails.beds}BR/${subjectDetails.baths}BA, ${subjectDetails.sqft}sqft, built ${subjectDetails.yearBuilt}`);

    const compResult = await compService.findComparables(
      address,
      propertyDetails.propertyType || undefined,
      15,  // max results - increased for nationwide flexibility
      5,   // search radius - increased for rural/suburban areas
      18   // time window months
    );

    if (compResult.success && compResult.comparables.length > 0) {
      console.log(`✅ Found ${compResult.comparables.length} comparables:`);

      let totalPpsf = 0;
      compResult.comparables.forEach((comp, i) => {
        const ppsf = comp.price / comp.sqft;
        totalPpsf += ppsf;

        console.log(`   ${i + 1}. ${comp.address}`);
        console.log(`      💰 Price: $${comp.price.toLocaleString()}`);
        console.log(`      📐 Size: ${comp.sqft} sqft (${comp.beds}bd/${comp.baths}ba)`);
        console.log(`      📅 Built: ${comp.yearBuilt} | Sold: ${comp.soldDate}`);
        console.log(`      📍 Distance: ${comp.distance.toFixed(2)} miles`);
        console.log(`      💲 PPSF: $${ppsf.toFixed(2)}`);
        console.log('');
      });

      // Step 3: ARV Calculation
      console.log('💰 STEP 3: ARV CALCULATION');
      console.log('------------------------------------------------------------');

      const avgPpsf = totalPpsf / compResult.comparables.length;
      const subjectSqft = propertyDetails.sqft || 2331; // fallback to known value
      const estimatedArv = avgPpsf * subjectSqft;

      console.log(`📊 Analysis Summary:`);
      console.log(`   🏠 Subject Property: ${subjectSqft} sq ft`);
      console.log(`   🔢 Number of Comps: ${compResult.comparables.length}`);
      console.log(`   💲 Average PPSF: $${avgPpsf.toFixed(2)}`);
      console.log(`   💰 Estimated ARV: $${estimatedArv.toLocaleString()}`);

      // Show comp range
      const ppsfValues = compResult.comparables.map(c => c.price / c.sqft);
      const minPpsf = Math.min(...ppsfValues);
      const maxPpsf = Math.max(...ppsfValues);
      const conservativeArv = minPpsf * subjectSqft;
      const aggressiveArv = maxPpsf * subjectSqft;

      console.log('');
      console.log(`📈 ARV Range:`);
      console.log(`   🔻 Conservative: $${conservativeArv.toLocaleString()} (${minPpsf.toFixed(2)} PPSF)`);
      console.log(`   🎯 Moderate: $${estimatedArv.toLocaleString()} (${avgPpsf.toFixed(2)} PPSF)`);
      console.log(`   🔺 Aggressive: $${aggressiveArv.toLocaleString()} (${maxPpsf.toFixed(2)} PPSF)`);

    } else {
      console.log('❌ No comparables found');
      if (compResult.error) {
        console.log(`   Error: ${compResult.error}`);
      }
    }

    console.log('');
    console.log('✅ VERTEX-ONLY SYSTEM TEST COMPLETED');

  } catch (error: any) {
    console.error('❌ System test failed:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testVertexSystem().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  });
}