#!/usr/bin/env tsx
/**
 * Unit test for Vertex result cache
 * Tests cache key generation, storage, and retrieval
 */

import { buildCacheKey, getCachedResult, setCachedResult, hashKey } from '../src/server/utils/vertexResultCache';
import { redis } from '../src/server/utils/redisClient';

async function testCacheKeyStability() {
  console.log('🧪 Test 1: Cache Key Stability');
  console.log('================================\n');

  const prompt = 'Find comparable properties near 123 Main St';
  const model = 'gemini-2.5-pro';

  // Generate same key multiple times
  const key1 = buildCacheKey({ prompt, model, grounded: true });
  const key2 = buildCacheKey({ prompt, model, grounded: true });
  const key3 = buildCacheKey({
    prompt,
    model,
    grounded: true,
    temperature: 0,
    seed: 12345,
    maxOutputTokens: 8192
  });

  console.log('Key 1:', key1);
  console.log('Key 2:', key2);
  console.log('Key 3:', key3);
  console.log('');

  if (key1 === key2 && key2 === key3) {
    console.log('✅ Keys are stable (identical)\n');
  } else {
    console.log('❌ Keys are NOT stable\n');
    process.exit(1);
  }
}

async function testCacheDifferentiation() {
  console.log('🧪 Test 2: Cache Key Differentiation');
  console.log('=====================================\n');

  const prompt = 'Find comparable properties';
  const model = 'gemini-2.5-pro';

  const groundedKey = buildCacheKey({ prompt, model, grounded: true });
  const ungroundedKey = buildCacheKey({ prompt, model, grounded: false });
  const jsonKey = buildCacheKey({
    prompt,
    model,
    grounded: false,
    responseMimeType: 'application/json'
  });

  console.log('Grounded key:    ', groundedKey);
  console.log('Ungrounded key:  ', ungroundedKey);
  console.log('JSON mode key:   ', jsonKey);
  console.log('');

  if (groundedKey !== ungroundedKey && ungroundedKey !== jsonKey) {
    console.log('✅ Different configs produce different keys\n');
  } else {
    console.log('❌ Keys are not differentiated\n');
    process.exit(1);
  }
}

async function testCacheStorageAndRetrieval() {
  console.log('🧪 Test 3: Cache Storage & Retrieval');
  console.log('=====================================\n');

  const key = buildCacheKey({
    prompt: 'Test prompt',
    model: 'gemini-2.5-pro',
    grounded: true
  });

  const testData = JSON.stringify({
    result: 'This is a test result',
    timestamp: Date.now(),
    nested: { foo: 'bar', num: 123 }
  });

  console.log('Storing test data...');
  await setCachedResult(key, testData);
  console.log('✅ Data stored\n');

  console.log('Retrieving test data...');
  const retrieved = await getCachedResult(key);
  console.log('✅ Data retrieved\n');

  if (retrieved === testData) {
    console.log('✅ Retrieved data matches stored data\n');
  } else {
    console.log('❌ Data mismatch\n');
    console.log('Expected:', testData);
    console.log('Got:', retrieved);
    process.exit(1);
  }

  // Clean up
  await redis.del(key);
  console.log('🗑️  Test key cleaned up\n');
}

async function testCacheMiss() {
  console.log('🧪 Test 4: Cache Miss Handling');
  console.log('===============================\n');

  const key = 'vertex:result:nonexistent-key-12345';

  console.log('Attempting to retrieve non-existent key...');
  const result = await getCachedResult(key);
  console.log('');

  if (result === null) {
    console.log('✅ Cache miss returns null\n');
  } else {
    console.log('❌ Cache miss did not return null\n');
    console.log('Got:', result);
    process.exit(1);
  }
}

async function testCacheTTL() {
  console.log('🧪 Test 5: Cache TTL');
  console.log('====================\n');

  const key = buildCacheKey({
    prompt: 'TTL test',
    model: 'gemini-2.5-pro',
    grounded: true
  });

  const testData = 'TTL test data';
  const shortTTL = 2; // 2 seconds

  console.log('Storing with 2-second TTL...');
  await setCachedResult(key, testData, shortTTL);
  console.log('✅ Data stored\n');

  console.log('Immediate retrieval...');
  const immediate = await getCachedResult(key);
  if (immediate === testData) {
    console.log('✅ Data available immediately\n');
  } else {
    console.log('❌ Data not available\n');
    process.exit(1);
  }

  console.log('Waiting 3 seconds for expiry...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('Retrieval after expiry...');
  const expired = await getCachedResult(key);
  if (expired === null) {
    console.log('✅ Data expired correctly\n');
  } else {
    console.log('❌ Data did not expire\n');
    console.log('Got:', expired);
    process.exit(1);
  }
}

async function testPromptNormalization() {
  console.log('🧪 Test 6: Prompt Normalization');
  console.log('================================\n');

  const model = 'gemini-2.5-pro';

  // Different whitespace, same semantic content
  const prompt1 = 'Find   comparable   properties';
  const prompt2 = 'Find comparable properties';
  const prompt3 = 'Find\ncomparable\nproperties';

  const key1 = buildCacheKey({ prompt: prompt1, model, grounded: true });
  const key2 = buildCacheKey({ prompt: prompt2, model, grounded: true });
  const key3 = buildCacheKey({ prompt: prompt3, model, grounded: true });

  console.log('Prompt 1 (extra spaces):', JSON.stringify(prompt1));
  console.log('Key 1:', key1);
  console.log('');
  console.log('Prompt 2 (normal):', JSON.stringify(prompt2));
  console.log('Key 2:', key2);
  console.log('');
  console.log('Prompt 3 (newlines):', JSON.stringify(prompt3));
  console.log('Key 3:', key3);
  console.log('');

  if (key1 === key2 && key2 === key3) {
    console.log('✅ Prompts normalized correctly (all keys match)\n');
  } else {
    console.log('❌ Prompts not normalized\n');
    process.exit(1);
  }
}

async function runAllTests() {
  console.log('🚀 Vertex Result Cache Unit Tests');
  console.log('==================================\n');

  try {
    // Check Redis connection
    console.log('📡 Checking Redis connection...');
    await redis.ensureConnected();
    console.log('✅ Redis connected\n');
    console.log('');

    await testCacheKeyStability();
    await testCacheDifferentiation();
    await testCacheStorageAndRetrieval();
    await testCacheMiss();
    await testCacheTTL();
    await testPromptNormalization();

    console.log('═══════════════════════════════════');
    console.log('✅ All tests passed!');
    console.log('═══════════════════════════════════\n');

    await redis.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await redis.disconnect();
    process.exit(1);
  }
}

runAllTests();
