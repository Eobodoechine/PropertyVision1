// Per-job time budget. A run must finish in under 5 minutes, so every job gets
// a hard deadline when it starts processing. Model calls are cut off at that
// deadline instead of running on, and Phase 2 is skipped when too little time
// is left for it. The job is found through the same AsyncLocalStorage context
// that jobLog uses, so callers don't need to pass anything.
//
// Env:
//   PV_JOB_BUDGET_MS          total time for one job (default 270000 = 4.5 min)
//   PV_SEARCH_RESERVE_MS      time kept back after the last web search for
//                             parsing and ARV (default 35000)
import { getCurrentJobId } from './jobLogger';

const deadlines = new Map<string, number>();

export function jobBudgetMs(): number {
  return Number(process.env.PV_JOB_BUDGET_MS || 270_000);
}

export function searchReserveMs(): number {
  return Number(process.env.PV_SEARCH_RESERVE_MS || 35_000);
}

export function startJobBudget(jobId: string, budgetMs = jobBudgetMs()): void {
  deadlines.set(jobId, Date.now() + budgetMs);
}

export function endJobBudget(jobId: string): void {
  deadlines.delete(jobId);
}

// Milliseconds left before the current job's deadline. Infinity outside a job
// (scripts, tests), so code that runs without a budget behaves as before.
export function jobTimeLeftMs(jobId: string | undefined = getCurrentJobId()): number {
  const d = jobId ? deadlines.get(jobId) : undefined;
  return d === undefined ? Infinity : d - Date.now();
}

// Time left for web-search calls: the job deadline minus the reserve for
// parsing and ARV that follow the last search.
export function searchTimeLeftMs(jobId?: string): number {
  return jobTimeLeftMs(jobId) - searchReserveMs();
}
