VERDICT: FAIL
DIMENSIONS:
  - Specification Adherence: FAIL
  - Code Quality/Correctness: FAIL
  - Documentation Accuracy: FAIL
BLOCKING:
  - src/ingestor.ts: recover() resets 'done' rows to 'pending', causing total re-ingestion on restart.
  - src/ingestor.ts: dequeue() uses LIFO (DESC) order instead of specified FIFO (ASC).
  - src/scanner.ts: softDeleteMissing() performs hard DELETE instead of soft-delete via deleted_at.
  - src/retry.ts: nextDelayMs() lacks jitter, returning only the ceiling.
  - src/config.ts: DEFAULT_CONFIG values for batchSize and backoffBaseMs drift from PRD.
RIGOR: tuned

### 1. Source Brief -> Architecture

The architecture generally addresses the requirements, but with several significant gaps and contradictions:

- **R1 (Source scan):** Addressed in `Scanner`, but implementation in code (soft-delete) deviates.
- **R2 (Dedup):** Addressed in `DedupService`, but code uses incorrect time units (minutes vs hours).
- **R3 (Pool):** Addressed in `WorkerPool`, but code allows `concurrency + 1` tasks.
- **R4 (Retry):** Addressed in `RetryPolicy`, but code lacks specified jitter.
- **R5 (Dead-letter):** Addressed, but code allows one extra attempt (6 instead of 5) before dead-lettering.
- **R6 (Checkpoint & resume):** Addressed in `BatchWriter`, but `Ingestor.recover()` implementation is destructive (resets `done` items).
- **R7 (Conflict resolution):** Specified in `Scanner`, but `candidateWins` logic is inverted and unused in `upsertCandidate`.
- **R8 (Batch sizing):** Addressed in `BatchWriter`.
- **R9 (FIFO):** Specified in `ARCHITECTURE.md` (§4.6) as `ASC`, but code uses `DESC` (LIFO).
- **R10 (Soft delete):** Specified in PRD, but architecture/code implements hard `DELETE`.
- **R11 (Exit codes):** Addressed in `cli.ts`.
- **R12 (Structured logging):** Addressed in `logger.ts`.

### 2. Architecture -> Delivery Plan

The delivery plan is coherent with the architecture but fails to catch the drift in implementation:

- **Phase 1:** Plan claims to validate config, but does not specify ensuring defaults match the PRD.
- **Phase 4:** Plan references `resolveConflict` (last-write-wins), which is present in code as `candidateWins` but incorrectly implemented and unused.
- **Phase 6:** Plan references jitter, but the implementation in `retry.ts` omits it.
- **Phase 9:** Plan references A4/A5/A6/A8 acceptance criteria, but the `recover()` logic (A6) is fundamentally broken in a way that would technically "work" (by re-processing everything) but violates the "no committed item reprocessed" requirement.

### 3. Delivery/Status -> Code

1. DRIFT: `DEFAULT_CONFIG.batchSize` is 128 in `src/config.ts` vs 64 in PRD §5 and CONTEXT.md.
2. DRIFT: `DEFAULT_CONFIG.backoffBaseMs` is 500 in `src/config.ts` vs 200 in PRD §5 and CONTEXT.md.
3. DRIFT: `src/retry.ts#nextDelayMs` returns `ceiling` (no jitter) vs PRD R4 ("full jitter is applied: the actual delay is a uniform random value in [0, computed]").
4. DRIFT: `src/scanner.ts#softDeleteMissing` uses `DELETE` vs PRD R10 ("SHALL be soft-deleted by setting deleted_at").
5. DRIFT: `src/ingestor.ts#dequeue` uses `ORDER BY discovered_at DESC, id DESC` (LIFO) vs PRD R9 ("ascending discovered_at, with id ascending as the tiebreak" - FIFO) and ARCHITECTURE §4.6.
6. DRIFT: `src/ingestor.ts#recover` updates `status IN ('in_progress', 'done')` to `pending` vs PRD R6 ("any row left in in_progress ... is reset to pending"). This causes re-ingestion of all completed work on every restart.
7. DRIFT: `src/scanner.ts#candidateWins` returns `candidate.mtime_ms < existing.mtime_ms` vs PRD R7 ("row with the greater mtime_ms wins").
8. DRIFT: `src/dedup.ts#isDuplicate` uses `now - dedupWindowHours * 60_000` (minutes) vs ARCHITECTURE 4.1 (`now - dedupWindowHours*3600_000` - milliseconds).
9. DRIFT: `src/scanner.ts#upsertCandidate` does not call `candidateWins` or implement the tiebreak logic; it simply updates if any physical attribute differs.
10. DRIFT: `src/pool.ts#acquire` uses `this.inFlight <= this.concurrency`, which allows `concurrency + 1` (e.g., 5 if concurrency is 4) tasks in flight, vs PRD R3 ("at most concurrency (default 4) tasks").
11. DRIFT: `src/retry.ts#shouldDeadLetter` uses `attempts > maxRetries`, allowing 6 attempts (1 initial + 5 retries) vs PRD R5 ("After a task has failed maxRetries (default 5) times ... it SHALL be moved to status dead").

### 4. Verdict

**SIGNIFICANT DRIFT**

The project suffers from critical implementation errors that directly contradict the PRD and Architecture:
1. **Destructive Recovery:** `Ingestor.recover()` resets `done` rows to `pending`, causing the system to re-ingest the entire history on every restart. This violates the core PRD Goal of being "crash-safe" and "idempotent."
2. **Inverted Ordering:** The system processes files in LIFO order instead of the required FIFO order.
3. **Hard Deletion:** Soft-deletion (R10) is implemented as a hard `DELETE`, destroying manifest history.
4. **Logic Bugs:** Inverted conflict resolution, incorrect time units for deduplication, and missing jitter in the retry policy.
5. **Config Drift:** Core constants (batch size, backoff base) differ from the documented source of truth.
