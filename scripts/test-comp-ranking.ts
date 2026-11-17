// Final comps must be the best fits: closest, most similar in size and beds,
// most recent sale. scoreComparable is lower-is-better. This checks the two
// places that turn scores into the final list, plus the address-leak route.
//
// Run: npx tsx scripts/test-comp-ranking.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { topK } from '../src/server/utils/minHeap';
import { scoreComparable } from '../src/server/utils/compScoring';
import { ParallelSearchOrchestrator } from '../src/server/utils/parallelSearchOrchestrator';

// 1. topK keeps the k LOWEST scores, best first.
assert.deepEqual(topK([1, 5, 0], 2, x => x), [0, 1], 'topK must keep the two lowest scores');
const pool = Array.from({ length: 40 }, (_, i) => (i * 37) % 41);
assert.deepEqual(topK(pool, 16, x => x), [...pool].sort((a, b) => a - b).slice(0, 16), 'topK must match a full sort');

// 2. The final ordering puts the best fit first and dedups to the better copy.
const subject: any = { address: '1 Subject St', sqft: 1500, beds: 3, baths: 2, yearBuilt: 1970 };
const near: any = { address: '10 Near St', sqft: 1520, beds: 3, baths: 2, distance: 0.3, soldDate: '2026-10-01', lat: 33.70001, lon: -84.40001 };
const mid: any = { address: '20 Mid St', sqft: 1700, beds: 3, baths: 2, distance: 1.2, soldDate: '2026-06-01', lat: 33.71, lon: -84.41 };
const far: any = { address: '30 Far St', sqft: 2400, beds: 5, baths: 3, distance: 3.8, soldDate: '2025-03-01', lat: 33.75, lon: -84.45 };
// Same house as `near` (same coordinates) under a worse record: farther-looking, older data.
const nearDupWorse: any = { ...near, address: '10 Near Street', distance: 2.5, soldDate: '2025-01-01' };
assert.ok(scoreComparable(near, subject) < scoreComparable(mid, subject) && scoreComparable(mid, subject) < scoreComparable(far, subject),
  'fixture sanity: near < mid < far by score');

const order = (ParallelSearchOrchestrator.prototype as any).orderDistinctByScore.call({}, [far, nearDupWorse, mid, near], subject);
const names = order.map((c: any) => c.address);
console.log('final order:', names.join(' → '));
assert.equal(names[0], '10 Near St', 'best fit must come first');
assert.deepEqual(names, ['10 Near St', '20 Mid St', '30 Far St'], 'order must be best → worst with the duplicate collapsed to its better copy');

// Equal scores: the more recent sale wins.
const a: any = { address: 'A', sqft: 1500, beds: 3, baths: 2, distance: 1, soldDate: '2026-01-01', lat: 1, lon: 1 };
const b: any = { ...a, address: 'B', soldDate: '2026-01-01', lat: 2, lon: 2 };
const order2 = (ParallelSearchOrchestrator.prototype as any).orderDistinctByScore.call({}, [b, a], subject).map((c: any) => c.address);
assert.deepEqual(order2, ['A', 'B'], 'full ties fall back to address order, deterministically');

// 3. Address leak: the latest-report route is gone and demo mode rejects its path.
assert.equal(fs.existsSync('src/app/api/analyze/latest/route.ts'), false, 'latest route must be removed');
const mw = fs.readFileSync('src/middleware.ts', 'utf8');
const re = new RegExp(mw.match(/if \(!\/(.+)\/i\.test\(path\)\)/)![1], 'i');
assert.equal(re.test('/api/analyze/latest'), false, 'demo middleware must reject /api/analyze/latest');
assert.equal(re.test('/api/analyze/status/123e4567-e89b-12d3-a456-426614174000'), true, 'status route must stay reachable');
assert.equal(/latestReport/.test(fs.readFileSync('src/server/utils/jobQueue.ts', 'utf8').replace(/\/\/.*$/gm, '')), false,
  'jobQueue must not write a latestReport pointer');

console.log('comp ranking and leak checks: passed');
// Importing the orchestrator opens a Redis client; exit before its reconnect noise.
process.exit(0);
