// Test Section 3 Breakdown - Comprehensive Search in Discrete Steps
import { ComprehensiveCompSearchV2 } from './server/comprehensive-comp-search-v2.js';
import { fetchPropertyDetailsViaVertex } from './server/vertex-details.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🏠 MONTGOMERY ANALYSIS - SECTION 3 BREAKDOWN');
console.log('===========================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function testSection3Breakdown() {
  try {
    // Initialize service (Sections 1 & 2)
    const searchService = new ComprehensiveCompSearchV2();
    searchService.clearAllCaches();
    console.log('✅ Service initialized and caches cleared');
    console.log('');

    // STEP 3A: Fetch Subject Details
    console.log('🔥 STEP 3A: FETCHING SUBJECT DETAILS');
    console.log('===================================');

    let subjectDetails = null;
    const detailsStartTime = Date.now();

    try {
      console.log('🔍 Calling fetchPropertyDetailsViaVertex...');
      const details = await fetchPropertyDetailsViaVertex(TEST_ADDRESS);
      const detailsDuration = Date.now() - detailsStartTime;

      console.log(`⏱️  Details fetch time: ${detailsDuration}ms`);
      console.log('📄 Raw details response:', details ? 'Success' : 'Failed');

      if (details && details.sqft && details.beds && details.baths && details.yearBuilt) {
        subjectDetails = {
          sqft: details.sqft,
          beds: details.beds,
          baths: details.baths,
          yearBuilt: details.yearBuilt,
          subdivision: details.subdivision || undefined,
        };

        console.log('✅ Subject details extracted:');
        console.log(`   📐 Size: ${subjectDetails.sqft} sqft`);
        console.log(`   🏠 Layout: ${subjectDetails.beds}BR/${subjectDetails.baths}BA`);
        console.log(`   📅 Built: ${subjectDetails.yearBuilt}`);
        console.log(`   🏘️  Subdivision: ${subjectDetails.subdivision || 'None'}`);
      } else {
        console.log('⚠️  Subject details incomplete - will proceed without filters');
        console.log('   Available data:', JSON.stringify(details, null, 2));
      }
    } catch (e) {
      console.log('❌ Subject details fetch failed:', e.message);
    }
    console.log('');

    console.log('🔥 STEP 3B: READY FOR PROGRESSIVE SEARCH');
    console.log('========================================');
    console.log('✅ Subject details phase completed');
    console.log(`📊 Subject data available: ${subjectDetails ? 'Yes' : 'No'}`);

    if (subjectDetails) {
      console.log('🎯 Ready to proceed with progressive expansion search');
      console.log(`   Will search for properties similar to: ${subjectDetails.sqft}sqft, ${subjectDetails.beds}BR/${subjectDetails.baths}BA`);
      if (subjectDetails.subdivision) {
        console.log(`   Will prioritize subdivision: ${subjectDetails.subdivision}`);
      }
    } else {
      console.log('⚠️  Will proceed with generic search (no subject filters)');
    }

    console.log('');
    console.log('🛑 STOPPING HERE - Next would be progressive search (Step 3C)');
    console.log('   This is where the verbose Vertex AI searches would happen');

    return { subjectDetails, searchService };

  } catch (error) {
    console.error('❌ STEP 3 BREAKDOWN FAILED:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

// Execute breakdown
testSection3Breakdown()
  .then((result) => {
    console.log('');
    console.log('🎯 STEP 3A-3B RESULT');
    console.log('==================');
    if (result) {
      console.log('✅ Subject details phase completed successfully');
      console.log('🚨 Next step would trigger verbose Vertex AI searches');
    } else {
      console.log('❌ Subject details phase failed');
    }
    process.exit(result ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ EXECUTION FAILED:', error);
    process.exit(1);
  });