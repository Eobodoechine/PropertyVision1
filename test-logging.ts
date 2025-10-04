import 'dotenv/config';
import logger, { logSearchRequest, logSearchResult, logSearchError } from './server/utils/logger.js';

console.log('Testing Google Cloud Logging integration...\n');

// Test 1: Basic logger
logger.info('Test log entry', {
  eventType: 'TEST',
  message: 'This is a test log from PropertyVision',
});

// Test 2: Search request
logSearchRequest({
  address: '185 Jordan Pl, Fayetteville, GA 30215',
  userId: 'test-user-123',
  sessionId: 'test-session-456',
  ip: '192.168.1.1',
});

// Test 3: Successful search result
logSearchResult({
  address: '185 Jordan Pl, Fayetteville, GA 30215',
  userId: 'test-user-123',
  sessionId: 'test-session-456',
  arv: 250000,
  twoBathArv: 275000,
  compsCount: 15,
  qualifiedCompsCount: 8,
  executionTimeMs: 5432,
  success: true,
});

// Test 4: Error logging
logSearchError({
  address: '185 Jordan Pl, Fayetteville, GA 30215',
  userId: 'test-user-789',
  sessionId: 'test-session-012',
  error: new Error('Test error for debugging'),
  stage: 'test',
});

console.log('\n✅ Test logs sent!');
console.log('\nTo view logs:');
console.log('1. Console (local): Check output above');
console.log('2. Google Cloud Console: https://console.cloud.google.com/logs/query');
console.log('3. gcloud CLI: gcloud logging read "resource.type=global" --limit 10');
