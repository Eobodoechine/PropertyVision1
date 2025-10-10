import { useState, useEffect, useMemo } from 'react';

interface JobStatus {
  status: string;
  progress: number;
  phase?: string;
  phaseMessage?: string;
  estimatedTimeRemaining?: number;
  phaseStartTime?: number;
  serverNow?: number;
  createdAt?: number;
}

// Phase budgets for 5-minute total (300 seconds)
const PHASE_BUDGETS: Record<number, number> = {
  0: 5,       // QUEUED
  10: 60,     // SUBJECT_PROPERTY
  25: 190,    // COMPARABLE_SEARCH
  85: 35,     // DEDUPLICATION
  92: 10,     // ARV_CALCULATION
  97: 0,      // FINALIZING (instant)
  100: 0      // COMPLETED
};

const TOTAL_BUDGET = 300; // 5 minutes

// Phase progression map for smooth interpolation
const PHASE_NEXT_PROGRESS: Record<number, number> = {
  0: 10,    // QUEUED → SUBJECT_PROPERTY
  10: 25,   // SUBJECT_PROPERTY → COMPARABLE_SEARCH
  25: 85,   // COMPARABLE_SEARCH → DEDUPLICATION (skip L2, L3, L4 since they don't get called)
  85: 92,   // DEDUPLICATION → ARV_CALCULATION
  92: 97,   // ARV_CALCULATION → FINALIZING
  97: 100   // FINALIZING → COMPLETED
};

/**
 * Hook for smart countdown: 300s - (sum of completed phase budgets)
 * Shows total remaining time, jumping down as each phase completes
 */
export function useCountdown(jobStatus?: JobStatus) {
  const [countdown, setCountdown] = useState(TOTAL_BUDGET);

  // Calculate clock drift once per status update
  const driftMs = useMemo(() => {
    return jobStatus?.serverNow ? Date.now() - jobStatus.serverNow : 0;
  }, [jobStatus?.serverNow]);

  useEffect(() => {
    if (!jobStatus || jobStatus.status !== 'processing') {
      setCountdown(TOTAL_BUDGET);
      return;
    }

    const updateCountdown = () => {
      const currentProgress = jobStatus.progress || 0;

      // Calculate total budget consumed by completed phases
      let budgetConsumed = 0;
      for (const [progressKey, budget] of Object.entries(PHASE_BUDGETS)) {
        const progress = Number(progressKey);
        if (progress < currentProgress) {
          budgetConsumed += budget;
        }
      }

      // Calculate remaining time for current phase
      let currentPhaseRemaining = 0;
      if (jobStatus.phaseStartTime && jobStatus.estimatedTimeRemaining) {
        const now = Date.now() - driftMs;
        const elapsed = (now - jobStatus.phaseStartTime) / 1000;
        currentPhaseRemaining = Math.max(0, jobStatus.estimatedTimeRemaining - elapsed);
      }

      // Total remaining = (Total budget - Budget consumed by completed phases) - Time elapsed in current phase
      const currentPhaseBudget = PHASE_BUDGETS[currentProgress] || 0;
      const currentPhaseElapsed = currentPhaseBudget - currentPhaseRemaining;
      const totalRemaining = TOTAL_BUDGET - budgetConsumed - currentPhaseElapsed;

      // Clamp to minimum 1 second while processing
      const clamped = Math.max(1, Math.ceil(totalRemaining));

      setCountdown(clamped);
    };

    // Update immediately
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [jobStatus?.progress, jobStatus?.phaseStartTime, jobStatus?.estimatedTimeRemaining, jobStatus?.status, driftMs]);

  return countdown;
}

/**
 * Hook for smooth progress interpolation
 * Progress bar smoothly animates from current phase to next milestone
 */
export function useInterpolatedProgress(jobStatus?: JobStatus) {
  const baseProgress = jobStatus?.progress ?? 0;
  const nextProgress = PHASE_NEXT_PROGRESS[baseProgress] ?? baseProgress;
  const estimatedSeconds = jobStatus?.estimatedTimeRemaining ?? 0;
  const phaseStartTime = jobStatus?.phaseStartTime;
  const serverNow = jobStatus?.serverNow;

  const [smoothProgress, setSmoothProgress] = useState(baseProgress);

  // Calculate clock drift
  const driftMs = useMemo(() => {
    return serverNow ? Date.now() - serverNow : 0;
  }, [serverNow]);

  useEffect(() => {
    // If no phase timing info, just use base progress
    if (!phaseStartTime || !estimatedSeconds) {
      setSmoothProgress(baseProgress);
      return;
    }

    let rafId = 0;

    const update = () => {
      // Use server-synced time
      const now = Date.now() - driftMs;
      const elapsed = (now - phaseStartTime) / 1000;

      // Calculate fraction of phase completed (0 to 1)
      const fraction = Math.min(1, Math.max(0, elapsed / estimatedSeconds));

      // Interpolate between base and next progress
      // Never let it reach the next milestone until phase actually changes
      const maxProgress = nextProgress - 0.5; // Stop just before next milestone
      const interpolated = baseProgress + (maxProgress - baseProgress) * fraction;

      setSmoothProgress(interpolated);

      // Continue animating
      rafId = requestAnimationFrame(update);
    };

    // Start animation
    rafId = requestAnimationFrame(update);

    return () => cancelAnimationFrame(rafId);
  }, [baseProgress, nextProgress, estimatedSeconds, phaseStartTime, driftMs]);

  // Round to whole number for display
  return Math.round(smoothProgress);
}

/**
 * Hook to check if phase is taking longer than usual
 * Useful for showing "taking longer than expected" messages
 */
export function useIsSlowPhase(jobStatus?: JobStatus, p90Threshold?: number) {
  const [isSlow, setIsSlow] = useState(false);

  const driftMs = useMemo(() => {
    return jobStatus?.serverNow ? Date.now() - jobStatus.serverNow : 0;
  }, [jobStatus?.serverNow]);

  useEffect(() => {
    if (!jobStatus?.phaseStartTime || !p90Threshold) {
      setIsSlow(false);
      return;
    }

    const checkIfSlow = () => {
      const now = Date.now() - driftMs;
      const elapsed = (now - jobStatus.phaseStartTime!) / 1000;
      setIsSlow(elapsed > p90Threshold);
    };

    checkIfSlow();
    const interval = setInterval(checkIfSlow, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [jobStatus?.phaseStartTime, p90Threshold, driftMs]);

  return isSlow;
}
