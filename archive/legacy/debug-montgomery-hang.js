// Debug Montgomery hanging issue - test each component separately
import { fetchPropertyDetailsViaVertex } from './server/vertex-details.js';
import { VertexComparableSearchService } from './server/step3-find-comparables.js';

const TEST_ADDRESS = '6901 Eastern Shore Rd, Montgomery, AL 36117';

console.log('🔍 DEBUG: MONTGOMERY HANGING ISSUE');
console.log('=================================');
console.log(`📍 Address: ${TEST_ADDRESS}`);
console.log('');

async function debugHangingIssue() {
  try {
    // TEST 1: Basic property details fetch
    console.log('TEST 1: PROPERTY DETAILS FETCH');
    console.log('==============================');
    console.log('🔍 Testing fetchPropertyDetailsViaVertex...');

    const detailsStartTime = Date.now();
    let details = null;
    let detailsError = null;

    try {
      // Add timeout to prevent hanging
      const detailsPromise = fetchPropertyDetailsViaVertex(TEST_ADDRESS);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Details fetch timeout after 30 seconds')), 30000);
      });

      details = await Promise.race([detailsPromise, timeoutPromise]);

      const detailsDuration = Date.now() - detailsStartTime;
      console.log(`✅ Property details fetched in ${detailsDuration}ms`);
      console.log('📊 Details:', details ? JSON.stringify(details, null, 2) : 'null');

    } catch (error) {
      detailsError = error;
      console.log(`❌ Property details failed: ${error.message}`);
    }
    console.log('');

    // TEST 2: Basic comparable search service
    console.log('TEST 2: COMPARABLE SEARCH SERVICE INIT');
    console.log('====================================');
    console.log('🔍 Testing VertexComparableSearchService initialization...');

    let searchService = null;
    let searchServiceError = null;

    try {
      const initStartTime = Date.now();
      searchService = new VertexComparableSearchService();
      const initDuration = Date.now() - initStartTime;
      console.log(`✅ Search service initialized in ${initDuration}ms`);
    } catch (error) {
      searchServiceError = error;
      console.log(`❌ Search service init failed: ${error.message}`);
    }
    console.log('');

    // TEST 3: Simple findComparables call (if service initialized)
    if (searchService && !searchServiceError) {
      console.log('TEST 3: SIMPLE COMPARABLE SEARCH');
      console.log('===============================');
      console.log('🔍 Testing simple findComparables call...');

      try {
        const searchStartTime = Date.now();

        // Add timeout to prevent hanging
        const searchPromise = searchService.findComparables(
          TEST_ADDRESS,
          undefined, // propertyType
          10, // maxResults - small number
          1.0, // radius - small radius
          12, // timeWindow - short time
          details // subjectDetails from test 1
        );

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Search timeout after 60 seconds')), 60000);
        });

        const searchResult = await Promise.race([searchPromise, timeoutPromise]);

        const searchDuration = Date.now() - searchStartTime;
        console.log(`✅ Simple search completed in ${searchDuration}ms`);
        console.log(`📊 Found ${searchResult.comparables?.length || 0} comparables`);

        if (searchResult.comparables?.length > 0) {
          console.log('🏠 Sample comparable:');
          console.log(`   ${searchResult.comparables[0].address}`);
          console.log(`   $${searchResult.comparables[0].price?.toLocaleString()} | ${searchResult.comparables[0].sqft}sqft`);
        }

      } catch (error) {
        console.log(`❌ Simple search failed: ${error.message}`);
      }
    } else {
      console.log('⚠️  Skipping search test - service init failed');
    }
    console.log('');

    // TEST 4: Environment variables check
    console.log('TEST 4: ENVIRONMENT VARIABLES');
    console.log('============================');
    console.log('🔍 Checking critical environment variables...');

    const criticalEnvVars = [
      'GCP_SA_JSON',
      'SERVICE_ACCOUNT_JSON',
      'GOOGLE_MAPS_API_KEY',
      'SUBDIVISION'
    ];

    criticalEnvVars.forEach(envVar => {
      const value = process.env[envVar];
      console.log(`   ${envVar}: ${value ? '✅ Set' : '❌ Not set'}`);
    });
    console.log('');

    // TEST 5: File system access
    console.log('TEST 5: FILE SYSTEM ACCESS');
    console.log('=========================');
    console.log('🔍 Testing service account file access...');

    try {
      const fs = await import('fs');
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;

      if (saPath) {
        const saExists = fs.existsSync(saPath);
        console.log(`   Service account file exists: ${saExists ? '✅' : '❌'}`);

        if (saExists) {
          const saContent = fs.readFileSync(saPath, 'utf-8');
          const saJson = JSON.parse(saContent);
          console.log(`   Project ID: ${saJson.project_id || 'Missing'}`);
          console.log(`   Client email: ${saJson.client_email || 'Missing'}`);
        }
      } else {
        console.log('   ❌ No service account path specified');
      }
    } catch (error) {
      console.log(`   ❌ File system test failed: ${error.message}`);
    }
    console.log('');

    console.log('🎯 DEBUG SUMMARY');
    console.log('===============');
    console.log(`Property details: ${details ? '✅ Success' : '❌ Failed'}`);
    console.log(`Search service: ${searchService ? '✅ Success' : '❌ Failed'}`);
    console.log('');

    if (detailsError) {
      console.log('🚨 DETAILS ERROR:', detailsError.message);
    }
    if (searchServiceError) {
      console.log('🚨 SEARCH SERVICE ERROR:', searchServiceError.message);
    }

    return { details, searchService, detailsError, searchServiceError };

  } catch (error) {
    console.error('❌ DEBUG FAILED:', error.message);
    console.error('Stack:', error.stack);
    return null;
  }
}

// Execute debug
debugHangingIssue()
  .then((result) => {
    console.log('');
    console.log('🔧 DEBUG COMPLETE');
    console.log('================');
    if (result) {
      console.log('✅ Debug analysis completed');
    } else {
      console.log('❌ Debug analysis failed');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ DEBUG EXECUTION FAILED:', error);
    process.exit(1);
  });