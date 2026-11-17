// Drives the real JobQueue.processJob with a job that outlives its lock TTL and
// checks the heartbeat keeps the job lock alive. Removing the renewLock call from
// the heartbeat in jobQueue.ts makes this test fail.
//
// Run (needs a Redis it may write to):
//   REDIS_URL=redis://127.0.0.1:6392 npx tsx scripts/test-job-lock-renewal.ts
import assert from 'node:assert/strict';

// Short lock and heartbeat so the test runs in seconds. Must be set before import.
process.env.PV_JOB_LOCK_TTL_SECONDS = '2';
process.env.PV_JOB_HEARTBEAT_MS = '500';
process.env.GEOCODER = 'census';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { JobQueue } = await import('../src/server/utils/jobQueue');
  const { getRedisCache } = await import('../src/server/utils/redisCache');
  const { geocodeCache } = await import('../src/server/utils/geocodeCache');

  const redis: any = getRedisCache();
  await redis.ensureConnected();
  const jq: any = new JobQueue();

  const address = '100 Lock Test Way, Atlanta, GA 30303';
  await geocodeCache.set(address, 33.75, -84.39, 'ROOFTOP'); // no network geocode
  const jobId = `00000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;
  await redis.setJob(jobId, { jobId, address, status: 'queued', progress: 0, createdAt: Date.now() }, 600);

  let lockHeldPastTtl: boolean | null = null;
  // Stand-in for the comp search: runs 4.5s, more than twice the 2s lock TTL.
  jq.analysisService = {
    findComparables: async () => {
      await sleep(4500);
      lockHeldPastTtl = (await redis.client.get(`lock:job:${jobId}`)) !== null;
      return {
        subject: { address, sqft: 1500 },
        arv: { estimate: 300000, method: 'test', confidence: 'low' },
        twoBathARV: null,
        bathroomAnalysis: null,
        renovation_analysis: null,
        qualified_comps: [],
        all_comps: [],
        consistency_scores: new Map(),
        searchMetadata: {},
      };
    },
  };

  await jq.processJob(jobId, address, '0-1');
  await redis.deleteJob(jobId);
  console.log(`lock still held 4.5s into a job with a 2s lock TTL: ${lockHeldPastTtl}`);
  assert.equal(lockHeldPastTtl, true, 'the heartbeat must renew the job lock while the job runs');
  console.log('job lock renewal check: passed');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
