### 1. Source Brief -> Architecture
The architecture generally satisfies the PRD requirements in terms of system shape and module decomposition, but there are several underspecified or mismatched areas:

- **R1 (Source scan):** Addressed by `Scanner` and `upsertCandidate`.
- **R2 (Deduplication):** Addressed by `DedupService`, but the architecture notes it only dedups against "live, done" rows, whereas the PRD doesn't explicitly restrict it to "live" rows (though it's a sensible design choice).
- **R3 (Concurrency):** Addressed by `WorkerPool`.
- **R4/R5 (Retry/Dead-letter):** Addressed by `RetryPolicy`.
- **R6 (Checkpoint/Resume):** Addressed by `BatchWriter` and `Ingestor#recover`.
- **R7 (Conflict Resolution):** Addressed in `ARCHITECTURE.md` §4.4, but the implementation in `scanner.ts` is mismatched (logic exists but is unused in the upsert path).
- **R8 (Batching):** Addressed by `BatchWriter`.
- **R9 (FIFO):** Addressed in `ARCHITECTURE.md` §4.6, but the implementation in `ingestor.ts` is LIFO.
- **R10 (Soft delete/Purge):** Addressed by `Scanner`, but implementation in `scanner.ts` is actually a hard delete.
- **R11 (Exit codes):** Addressed by `CLI` and `types.ts`.
- **R12 (Logging):** Addressed by `Logger`.

**Flagged:**
- **R7 (Conflict Resolution):** The architecture claims a specific last-write-wins tiebreak logic that the code doesn't actually employ in its `upsertCandidate` path.
- **R9 (FIFO):** The architecture claims FIFO order, but the code implements LIFO.
- **R10 (Soft Delete):** The architecture and PRD claim soft-deletion, but the code performs hard deletes.

### 2. Architecture -> Delivery Plan
The implementation plan follows the architecture's module inventory and behavioral contracts closely.

- **Phase 4 (Scanner):** Claims to implement `resolveConflict` (last-write-wins), but the actual code in `scanner.ts` has an unused `candidateWins` function and `upsertCandidate` ignores it.
- **Phase 9 (Ingestor):** Claims to implement FIFO dequeue, but the code uses `DESC` ordering.

**Flagged:**
- **Phase 9 (Ingestor):** The plan assumes the `recover()` function only rewinds `in_progress` rows, but the implementation also rewinds `done` rows, which would cause infinite re-processing of completed work.
- **Phase 1 (Types/Config):** The plan claims to validate `flushIntervalMs <= pollIntervalMs`, but the implementation throws on valid values and allows invalid ones due to an inverted condition.

### 3. Delivery/Status -> Code
1. DRIFT: `batchSize` default is 64 in PRD §5 and README.md vs 128 in `src/config.ts` (DEFAULT_CONFIG).
2. DRIFT: `backoffBaseMs` default is 200 in PRD §5 and CONTEXT.md vs 500 in `src/config.ts` (DEFAULT_CONFIG).
3. DRIFT: Config validation for `flushIntervalMs <= pollIntervalMs` is inverted: throws when `flush < poll` (valid) in `src/config.ts` (§ validateConfig).
4. DRIFT: `Ingestor#recover` rewinds both `in_progress` AND `done` rows to `pending` in `src/ingestor.ts` (§ recover), violating PRD R6 ("no committed work is repeated").
5. DRIFT: Dequeue order is LIFO (`ORDER BY discovered_at DESC, id DESC`) in `src/ingestor.ts` (§ dequeue) vs FIFO (`ASC`) specified in PRD R9.
6. DRIFT: Deduplication window multiplier is 60,000 (1 minute) in `src/dedup.ts` (§ isDuplicate) vs 3,600,000 (1 hour) implied by `dedupWindowHours` in PRD R2.
7. DRIFT: Conflict resolution `candidateWins` uses `<` for `mtime_ms` (first-write-wins) in `src/scanner.ts` (§ candidateWins) vs `>` (last-write-wins) in PRD R7.
8. DRIFT: `upsertCandidate` in `src/scanner.ts` does not use the `candidateWins` logic; it overwrites whenever `mtime_ms` or `size_bytes` changes regardless of which is newer.
9. DRIFT: `softDeleteMissing` in `src/scanner.ts` performs a hard `DELETE` instead of a soft-delete (setting `deleted_at`) as required by PRD R10.
10. DRIFT: `nextDelayMs` in `src/retry.ts` returns the ceiling directly without applying jitter, violating PRD R4.
11. DRIFT: `shouldDeadLetter` in `src/retry.ts` uses `attempts > maxRetries` instead of `>=` (or similar logic), allowing one extra attempt beyond the limit of 5 specified in PRD R5.
12. DRIFT: `WorkerPool#acquire` in `src/pool.ts` allows `inFlight <= concurrency`, permitting `concurrency + 1` (5) tasks in flight vs the limit of 4 in PRD R3.
13. DRIFT: `BatchWriter` in `src/batch.ts` lacks a `db.transaction` wrapper for its multi-statement flush, violating the atomicity requirement in PRD R6 and ARCHITECTURE §4.5.

### 4. Verdict
**VERDICT: SIGNIFICANT DRIFT**

The most critical issues are:
1. **Critical Bug in Recovery:** The `recover()` function rewinds `done` rows to `pending`, meaning every restart will re-process every previously completed file, leading to infinite work loops and storage/sink churn.
2. **Data Integrity/Soft-Delete Failure:** `softDeleteMissing` performs hard deletes, destroying historical manifest data that the PRD explicitly requires for retention and purging.
3. **Atomicity Failure:** Batch commits are not wrapped in a transaction, breaking the core "crash-safe" promise; a crash mid-batch will leave the manifest and checkpoint in an inconsistent state.
4. **Logic Inversions:** Config validation is inverted (blocking valid configs), and processing order is LIFO instead of the required FIFO.
5. **Deduplication Window Error:** The window is 24 minutes instead of 24 hours due to a millisecond multiplier error.
