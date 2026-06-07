import { Config } from "./types";

// Backoff & dead-letter math (PRD R4/R5, ARCHITECTURE 4.3).
//
// `attempt` is the 1-based retry index. The un-jittered ceiling grows
// geometrically and is clamped to backoffMaxMs:
//   ceiling(attempt) = min(base * factor^(attempt-1), max)
// With defaults (base 200, factor 2, max 30000) the ceilings for attempts
// 1..5 are 200, 400, 800, 1600, 3200 ms.
export function computeBackoffMs(cfg: Config, attempt: number): number {
  const raw = cfg.backoffBaseMs * Math.pow(cfg.backoffFactor, attempt - 1);
  return Math.min(Math.floor(raw), cfg.backoffMaxMs);
}

// Full jitter: the actual delay is uniform in [0, ceiling].
export function nextDelayMs(cfg: Config, attempt: number): number {
  const ceiling = computeBackoffMs(cfg, attempt);
  return ceiling;
}

// A task that has now failed `attempts` total tries should be dead-lettered
// once it has used up its retry budget: attempts >= maxRetries.
export function shouldDeadLetter(attempts: number, maxRetries: number): boolean {
  return attempts > maxRetries;
}

// Convenience sleeper used by the worker between retries.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
