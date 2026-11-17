// A finished job must keep its final status even when a late write arrives from a
// heartbeat or a duplicate run of the same job.
//
// redisCache.setJob has its own check, but its read and write are not atomic, so
// two writers racing past it is what reset a finished run to "processing 75%" on
// 2026-11-16. This test swaps setJob for a plain write to model that race, so only
// the guard in JobQueue.updateJob stands between the late write and the result.
// Removing that guard makes this test fail.
//
// Run: REDIS_URL=redis://127.0.0.1:6392 npx tsx scripts/test-job-final-status.ts
import assert from 'node:assert/strict';
import { JobQueue } from '../src/server/utils/jobQueue';
import { getRedisCache } from '../src/server/utils/redisCache';

async function main() {
  const redis: any = getRedisCache();
  await redis.ensureConnected();
  const jq: any = new JobQueue();

  // Model the race: writes land without setJob's own (non-atomic) status check.
  redis.setJob = async (id: string, data: any, ttl = 600) => {
    await redis.client.set(`job:${id}`, JSON.stringify(data), 'EX', ttl);
  };

  const jobId = `00000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;
  await redis.setJob(jobId, { jobId, status: 'processing', progress: 75, createdAt: Date.now() });

  // Case 1: a heartbeat read the job before completion and writes after it.
  const realGet = jq.getJobStatus.bind(jq);
  let heartbeatReadDone!: () => void;
  const heartbeatRead = new Promise<void>(r => { heartbeatReadDone = r; });
  let completionDone!: () => void;
  const completionWritten = new Promise<void>(r => { completionDone = r; });
  let first = true;
  jq.getJobStatus = async (id: string) => {
    const snapshot = await realGet(id);
    if (first) {
      first = false;
      heartbeatReadDone();
      await completionWritten;
    }
    return snapshot;
  };
  const heartbeat = jq.updateJob(jobId, { lastHeartbeat: Date.now() });
  await heartbeatRead;
  await jq.updateJob(jobId, { status: 'completed', progress: 100, phase: 'Complete', result: { ok: true } });
  completionDone();
  await heartbeat;
  const afterHeartbeat = await redis.getJob(jobId);
  console.log(`after late heartbeat: status=${afterHeartbeat?.status}, progress=${afterHeartbeat?.progress}`);

  // Case 2: a duplicate run of the same job reports progress after completion.
  await jq.updateJob(jobId, { status: 'processing', progress: 75, phase: 'ARV Calculation' });
  const afterDuplicate = await redis.getJob(jobId);
  console.log(`after duplicate-run progress write: status=${afterDuplicate?.status}, progress=${afterDuplicate?.progress}`);

  await redis.deleteJob(jobId);
  assert.equal(afterHeartbeat?.status, 'completed', 'late heartbeat must not reset a finished job');
  assert.equal(afterDuplicate?.status, 'completed', 'a duplicate run must not reset a finished job');
  assert.equal(afterDuplicate?.progress, 100);
  console.log('job final-status check: passed');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
