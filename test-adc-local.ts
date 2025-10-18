#!/usr/bin/env tsx
// Local ADC Test - Verifies that ADC authentication works with vertex-freeform.js

import { resolveProjectId, resolveLocation, getAccessTokenViaAuth, vertexGenerate } from './src/server/vertex-freeform.js';

async function testADC() {
  console.log('🧪 Testing ADC Authentication Locally...\n');

  try {
    // Test 1: Resolve Project ID
    console.log('[1/4] Resolving Project ID...');
    const projectId = await resolveProjectId();
    console.log(`✅ Project ID: ${projectId}\n`);

    // Test 2: Resolve Location
    console.log('[2/4] Resolving Location...');
    const location = resolveLocation();
    console.log(`✅ Location: ${location}\n`);

    // Test 3: Get Access Token via ADC
    console.log('[3/4] Getting Access Token via ADC...');
    const token = await getAccessTokenViaAuth();
    console.log(`✅ Token obtained: ${token.substring(0, 20)}...${token.substring(token.length - 10)}`);
    console.log(`   Token length: ${token.length} characters\n`);

    // Test 4: Call Vertex AI with ADC
    console.log('[4/4] Testing Vertex AI call with ADC...');
    const model = 'gemini-2.0-flash-001';
    const prompt = 'Return only the number 42 as your response, nothing else.';

    console.log(`   Model: ${model}`);
    console.log(`   Prompt: "${prompt}"`);
    console.log('   Calling vertexGenerate...');

    const response = await vertexGenerate({
      token,
      projectId,
      location,
      model,
      prompt,
      grounded: false,
      json: false,
      timeoutMs: 10000
    });

    console.log(`✅ Vertex AI response: "${response}"\n`);

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ADC LOCAL TEST PASSED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nKey Results:');
    console.log(`  • Project ID:  ${projectId}`);
    console.log(`  • Location:    ${location}`);
    console.log(`  • Model:       ${model}`);
    console.log(`  • ADC Auth:    ✅ Working`);
    console.log(`  • Vertex AI:   ✅ Working`);
    console.log('\nThe ADC migration is working correctly locally!');
    console.log('Next step: Deploy to staging and test in Cloud Run.');

  } catch (error: any) {
    console.error('\n❌ ADC TEST FAILED!');
    console.error('\nError:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    console.error('\nTroubleshooting:');
    console.error('  1. Ensure ADC is set up: gcloud auth application-default login');
    console.error('  2. Check project is set: gcloud config get-value project');
    console.error('  3. Verify Vertex AI API is enabled');
    console.error('  4. Check you have permissions to call Vertex AI');
    process.exit(1);
  }
}

// Run the test
testADC();
