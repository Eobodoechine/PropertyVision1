// A run must finish in under 5 minutes, so a stalled model call must not hang
// the job. This drives the real claudeApiGenerate against a fake client whose
// stream never ends, and the real orchestrator against a spent job budget.
//
// Run: npx tsx scripts/test-claude-api-deadline.ts
import assert from 'node:assert/strict';

// A call that never settles leaves nothing in the event loop, and Node would
// then exit 0 as if the test passed. Treat that as the hang it is.
process.on('beforeExit', () => {
  console.error('FAILED: a model call never settled (hang)');
  process.exit(1);
});

// Short deadlines so the test runs in about a second. Read at call time,
// except concurrency, which is read at import.
process.env.CLAUDE_API_TIMEOUT_MAX_MS = '400';
process.env.CLAUDE_API_SEARCH_MIN_MS = '150';
process.env.CLAUDE_API_PARSE_MIN_MS = '150';
process.env.CLAUDE_API_TIMEOUT_RETRIES = '1';
process.env.PV_SEARCH_RESERVE_MS = '100';
process.env.CLAUDE_API_FALLBACKS = 'off';
process.env.CLAUDE_API_MIN_CALL_MS = '50';

async function main() {
const api: any = await import('../src/server/claude-api.js');
const { runInJobContext } = await import('../src/server/utils/jobLogger');
const { startJobBudget, endJobBudget } = await import('../src/server/utils/jobBudget');

// Fake client. Each stream() call takes the next behaviour from `plan`:
// 'hang' never resolves until the caller's abort signal fires; 'ok' answers.
let plan: string[] = [];
let calls = 0;
const okMessage = { content: [{ type: 'text', text: 'ANSWER' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
const fakeStream = (_params: any, opts: any) => {
  calls++;
  const mode = plan.shift() ?? 'ok';
  return {
    finalMessage: () => new Promise((resolve, reject) => {
      if (mode === 'ok') return resolve(okMessage);
      const signal: AbortSignal | undefined = opts?.signal;
      if (!signal) return; // no signal: hangs forever, which is the bug
      signal.addEventListener('abort', () => reject(new Error('Request was aborted.')), { once: true });
    }),
  };
};
api.setClaudeApiClientForTest({ messages: { stream: fakeStream }, beta: { messages: { stream: fakeStream } } });

async function timed(fn: () => Promise<string>) {
  const t0 = Date.now();
  const out = await fn();
  return { out, ms: Date.now() - t0 };
}

// 1. A stream that stalls forever is cut at the deadline, retried once, then ''.
plan = ['hang', 'hang']; calls = 0;
let r = await timed(() => api.claudeApiGenerate({ prompt: 'x', grounded: false, timeoutMs: 200 }));
console.log(`stalled twice: returned ${JSON.stringify(r.out)} in ${r.ms}ms after ${calls} attempts`);
assert.equal(r.out, '', 'a call that never answers must give up and return ""');
assert.equal(calls, 2, 'one retry after the first deadline');
assert.ok(r.ms < 1500, `must give up near 2 x 200ms, took ${r.ms}ms`);

// 2. First attempt stalls, the retry answers: the answer comes back.
plan = ['hang', 'ok']; calls = 0;
r = await timed(() => api.claudeApiGenerate({ prompt: 'x', grounded: false, timeoutMs: 200 }));
console.log(`stalled then answered: ${JSON.stringify(r.out)} in ${r.ms}ms`);
assert.equal(r.out, 'ANSWER');
assert.equal(calls, 2);

// 3. The caller's timeout is clamped: 10 s (a Gemini-era value) is raised to the
//    floor, 600 s is cut to the cap.
assert.equal(api.attemptDeadlineMs({ grounded: true, timeoutMs: 10 }), 150);
assert.equal(api.attemptDeadlineMs({ grounded: true, timeoutMs: 600000 }), 400);
assert.equal(api.attemptDeadlineMs({ grounded: false, timeoutMs: 300 }), 300);

// 4. Inside a job, no call may run past the job budget. With 300 ms of budget
//    and a 100 ms reserve, a search may run 200 ms even though the cap is 400.
const jobId = 'deadline-test-job';
await runInJobContext(jobId, async () => {
  startJobBudget(jobId, 300);
  const d = api.attemptDeadlineMs({ grounded: true, timeoutMs: 120000 });
  assert.ok(d <= 200 && d > 150, `search deadline must be cut to the budget, got ${d}`);
  plan = ['hang', 'hang']; calls = 0;
  const t = await timed(() => api.claudeApiGenerate({ prompt: 'x', grounded: true, timeoutMs: 120000 }));
  console.log(`inside a 300ms budget: returned ${JSON.stringify(t.out)} in ${t.ms}ms after ${calls} attempt(s)`);
  assert.equal(t.out, '');
  assert.equal(calls, 1, 'no retry once the budget is spent');
  assert.ok(t.ms < 600, `must stop at the budget, took ${t.ms}ms`);

  // Budget already spent: the call is skipped without touching the API.
  calls = 0;
  const s = await api.claudeApiGenerate({ prompt: 'x', grounded: true });
  assert.equal(s, '');
  assert.equal(calls, 0, 'a spent budget must skip the call');
  endJobBudget(jobId);
});

// 5. The orchestrator skips Phase 2 when the budget leaves too little search
//    time, and runs it when there is no budget pressure.
const { ParallelSearchOrchestrator } = await import('../src/server/utils/parallelSearchOrchestrator');
async function runSearch(budgetMs: number | null) {
  const launched: number[] = [];
  let finalLevels: number[] = [];
  const fake = {
    executeLevelSearch: async (level: number) => { launched.push(level); return { level, rawComps: [] }; },
    onLevelReady: async () => {},
    tryProgressivePasses: async (_p: any, _s: any, _subj: any, levels: number[], final: boolean) => {
      if (final) finalLevels = levels;
      return [];
    },
    vertexQueue: { getStats: () => ({}) },
    geocodeQueue: { getStats: () => ({}) },
  };
  const id = `orchestrator-test-${budgetMs}`;
  await runInJobContext(id, async () => {
    if (budgetMs !== null) startJobBudget(id, budgetMs);
    await (ParallelSearchOrchestrator.prototype as any).executeParallelSearch.call(fake, { address: '1 Test St' });
    endJobBudget(id);
  });
  return { launched, finalLevels };
}
const tight = await runSearch(30_000); // 30 s left, minus the 0.1 s reserve: under the 45 s Phase 2 minimum
console.log('tight budget: levels launched', tight.launched.join(','), '| final pass over', tight.finalLevels.join(','));
assert.deepEqual(tight.launched, [1, 2], 'Phase 2 must not launch without enough budget');
assert.deepEqual(tight.finalLevels, [1, 2], 'final pass must use the Phase 1 levels');
const open = await runSearch(null);
console.log('no budget: levels launched', open.launched.join(','), '| final pass over', open.finalLevels.join(','));
assert.deepEqual(open.launched, [1, 2, 3, 4], 'Phase 2 must still run when there is time');
assert.deepEqual(open.finalLevels, [1, 2, 3, 4]);

console.log('claude-api deadline and job budget checks: passed');
// Importing the orchestrator opens a Redis client; exit before its reconnect noise.
process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
