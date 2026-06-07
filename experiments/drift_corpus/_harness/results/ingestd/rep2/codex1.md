### 1. Source Brief -> Architecture

R1 Source scan & discovery: Addressed by `ARCHITECTURE.md` section 2 Scanner responsibility and section 3.1 `manifest.path` uniqueness. Slightly under-specified because the architecture does not restate the PRD's exact "same `mtime_ms` AND `size_bytes` skip" condition outside the module table.

R2 Content-hash deduplication: Addressed by `ARCHITECTURE.md` section 4.1, including SHA-256, live `done` rows, dedup window, and no sink call on hit.

R3 Bounded concurrency pool: Addressed by `ARCHITECTURE.md` section 4.2.

R4 Retry with exponential backoff: Addressed by `ARCHITECTURE.md` section 4.3.

R5 Dead-letter after N attempts: Addressed by `ARCHITECTURE.md` section 4.3 and section 4.9.

R6 Checkpoint & resume: Addressed by `ARCHITECTURE.md` section 4.5 and section 4.7.

R7 Last-write-wins conflict resolution: Partially addressed, but under-specified. `ARCHITECTURE.md` section 4.4 says `scanner.ts#resolveConflict(existing, candidate)` compares `candidate.content_hash`, while section 1 places hashing in the later `DedupService` stage; the architecture does not explain how Scanner obtains the candidate hash needed for the equal-`mtime_ms` tiebreak.

R8 Batch sizing & flush: Addressed by `ARCHITECTURE.md` section 4.5.

R9 FIFO processing order: Addressed by `ARCHITECTURE.md` section 4.6.

R10 Soft delete & retention purge: Addressed by `ARCHITECTURE.md` section 4.8.

R11 Exit codes & graceful shutdown: Addressed by `ARCHITECTURE.md` section 4.9. Config-validation details from `PRD.md` section 5 are only summarized in the module inventory, not spelled out in the architecture.

R12 Structured logging: Addressed by `ARCHITECTURE.md` section 4.10.

Overall: the architecture covers the PRD at the design level, with the main PRD-to-architecture gap around R7's hash-based conflict tiebreak and a smaller under-specification of exact config validation.

### 2. Architecture -> Delivery Plan

The delivery plan broadly follows the architecture's module order and maps phases to the numbered requirements. It is coherent as a build sequence, but it carries several risky or stale assumptions:

- `IMPLEMENTATION_PLAN.md` Phase 4 and `ARCHITECTURE.md` section 4.4 both assume a `resolveConflict` path that has candidate content hashes available during scanning; this is not coherently sequenced with hashing being delivered in the later Dedup phase.
- `IMPLEMENTATION_PLAN.md` Phase 8 says `BatchWriter` flushes on size or age, but the plan does not specify who owns the age timer. Without that, the implementation can satisfy a method shape while missing the PRD's elapsed-time flush behavior.
- `IMPLEMENTATION_PLAN.md` Phase 10 and `README.md` agree that `scan` should scan/enqueue only; this requires a CLI path separate from `runOnce`, but the plan does not call out that separation as an acceptance criterion.
- `IMPLEMENTATION_PLAN.md` repeatedly lists checks and an acceptance battery, but the workspace has no test files and `npm test` reports 0 tests. The plan's "green verify plus unit checks" evidence is therefore not present in the delivered tree.
- The code and example config include `sinkToken`, but the PRD/architecture configuration surface does not specify it. That is a code/config feature with incomplete documentation and plan coverage.

### 3. Delivery/Status -> Code

1. DRIFT: `CONTEXT.md` section Environment contract and `README.md` section Environment contract claim the canonical repo path is `/home/bgibs/projects/ingestd` vs the reviewed workspace is `/home/bgibs/projects/agent-roster-observe-smoke/experiments/drift_corpus/_harness/runs/ingestd-r2-codex1` (`pwd`).
2. DRIFT: `CONTEXT.md` section Status claims "Clean baseline; all docs match code. `npm run verify` green." vs `npm run verify` exits 2 with `src/db.ts(1,22): error TS2307: Cannot find module 'better-sqlite3'...`.
3. DRIFT: `IMPLEMENTATION_PLAN.md` sections Phases/Verification lists phase checks and acceptance battery A2/A4/A5/A6/A8 vs no test files exist under the workspace and `npm test` reports `tests 0`, `suites 0`.
4. DRIFT: `CONTEXT.md` section Canonical constants, `PRD.md` section 5, `README.md` section Defaults, and `IMPLEMENTATION_PLAN.md` Phase 1 claim `batchSize` default is 64 vs `src/config.ts` `DEFAULT_CONFIG.batchSize` is 128.
5. DRIFT: `CONTEXT.md` section Canonical constants, `PRD.md` section 5, `README.md` section Defaults, and `IMPLEMENTATION_PLAN.md` Phase 1 claim `backoffBaseMs` default is 200 vs `src/config.ts` `DEFAULT_CONFIG.backoffBaseMs` is 500.
6. DRIFT: `PRD.md` section 5 and `IMPLEMENTATION_PLAN.md` Phase 1 say config is valid when `flushIntervalMs <= pollIntervalMs` vs `src/config.ts` `validateConfig` throws when `flushIntervalMs < pollIntervalMs`, rejecting the documented `2000 <= 5000` default/example and allowing values greater than the poll interval.
7. DRIFT: `ARCHITECTURE.md` section 2 and section 3.3 call `Status` an enum vs `src/types.ts` implements `Status` as a TypeScript string union plus `STATUSES`, not an enum.
8. DRIFT: `IMPLEMENTATION_PLAN.md` Phase 3 says `src/db.ts` exposes prepared statements used by other modules vs `src/db.ts` only exports `openDb`, `readCheckpoint`, and types; other modules create their own prepared statements.
9. DRIFT: `CONTEXT.md` section Status lifecycle and `ARCHITECTURE.md` section 3.3 define `pending -> in_progress -> done|failed` and `failed -> pending|dead` vs `src/ingestor.ts` retries in memory and only batches final `done`/`dead` results, with no normal write of `failed` or retry `pending` status.
10. DRIFT: `PRD.md` R5, `CONTEXT.md` section Status lifecycle, `ARCHITECTURE.md` section 4.3, and `IMPLEMENTATION_PLAN.md` Phase 6 say dead-letter when `attempts >= maxRetries` vs `src/retry.ts` `shouldDeadLetter` returns true only when `attempts > maxRetries`.
11. DRIFT: `PRD.md` acceptance A5 and `IMPLEMENTATION_PLAN.md` Phase 6 say an always-throwing handler lands in `dead` after exactly 5 attempts and attempt 6 is unreachable vs `src/retry.ts` plus `src/ingestor.ts` allow a sixth attempt before returning `dead`.
12. DRIFT: `PRD.md` R4, `CONTEXT.md` section Canonical constants, `ARCHITECTURE.md` section 4.3, and `IMPLEMENTATION_PLAN.md` Phase 6 require full jitter over `[0, ceiling]` vs `src/retry.ts` `nextDelayMs` returns the ceiling directly with no randomness.
13. DRIFT: `CONTEXT.md` section Canonical constants and `PRD.md` R4 claim default backoff ceilings are `200, 400, 800, 1600, 3200` ms vs `src/config.ts` default `backoffBaseMs: 500` makes the implemented default ceilings start `500, 1000, 2000, 4000, 8000` before clamping.
14. DRIFT: `PRD.md` R2, `CONTEXT.md` section Invariants, `ARCHITECTURE.md` section 4.1, and `IMPLEMENTATION_PLAN.md` Phase 5 define `dedupWindowHours` in hours vs `src/dedup.ts` computes the cutoff with `dedupWindowHours * 60_000`, making the unit minutes.
15. DRIFT: `PRD.md` R10, `CONTEXT.md` section Invariants, `ARCHITECTURE.md` section 4.8, and `IMPLEMENTATION_PLAN.md` Phase 4 say missing files are soft-deleted by setting `deleted_at` and retained until purge vs `src/scanner.ts` `softDeleteMissing` hard-deletes rows immediately with `DELETE FROM manifest`.
16. DRIFT: `PRD.md` R10 and `ARCHITECTURE.md` section 4.8 say retention purge hard-deletes tombstoned rows after `retentionHours` vs `src/scanner.ts` never creates tombstones for missing files, so normal missing-file retention cannot occur.
17. DRIFT: `ARCHITECTURE.md` section 4.4 and `IMPLEMENTATION_PLAN.md` Phase 4 name `scanner.ts#resolveConflict` vs `src/scanner.ts` has no `resolveConflict`; it has `candidateWins`, and `upsertCandidate` does not call it.
18. DRIFT: `PRD.md` R7, `CONTEXT.md` section Invariants, and `ARCHITECTURE.md` section 4.4 say the greater `mtime_ms` wins a path conflict vs `src/scanner.ts` `candidateWins` returns true when `candidate.mtime_ms < existing.mtime_ms`.
19. DRIFT: `PRD.md` R7 and `ARCHITECTURE.md` section 4.4 say equal-`mtime_ms` conflicts tiebreak by lexicographically greater `content_hash` and overwrite `content_hash` vs `src/scanner.ts` `upsertCandidate` does not hash the candidate, treats equal `mtime_ms` plus equal `size_bytes` as unchanged, and sets `content_hash = NULL` on changed/resurrected rows.
20. DRIFT: `CONTEXT.md` section Status lifecycle and `ARCHITECTURE.md` section 4.7 say only `in_progress` rows are rewound to `pending` during startup recovery vs `src/ingestor.ts` `recover()` rewinds rows where status is `in_progress` or `done`.
21. DRIFT: `PRD.md` section 1/R6 and `CONTEXT.md` section What this is claim committed work is not repeated on crash-safe resume vs `src/ingestor.ts` `recover()` resets `done` rows to `pending`, causing already committed rows to be eligible for reprocessing.
22. DRIFT: `PRD.md` R9, `CONTEXT.md` section Invariants, `ARCHITECTURE.md` section 4.6, and `IMPLEMENTATION_PLAN.md` Phase 9 require FIFO `ORDER BY discovered_at ASC, id ASC` vs `src/ingestor.ts` `dequeue()` orders `discovered_at DESC, id DESC`.
23. DRIFT: `PRD.md` R3, `CONTEXT.md` section Invariants, `ARCHITECTURE.md` section 4.2, and `IMPLEMENTATION_PLAN.md` Phase 7 require at most `concurrency` tasks in flight vs `src/pool.ts` admits a task while `inFlight <= concurrency`, allowing `concurrency + 1` active tasks.
24. DRIFT: `PRD.md` R6/R8, `CONTEXT.md` section Invariants, `ARCHITECTURE.md` section 4.5, and `IMPLEMENTATION_PLAN.md` Phase 8 say manifest status updates and checkpoint update commit in one SQLite transaction vs `src/batch.ts` `commitTxn` is a plain function and never wraps the updates in `db.transaction`.
25. DRIFT: `PRD.md` R8, `ARCHITECTURE.md` section 4.5, and `IMPLEMENTATION_PLAN.md` Phase 8 say a batch flushes when `flushIntervalMs` elapses since the first completion, whichever comes first vs `src/batch.ts` only exposes `isFlushDue()` and `src/ingestor.ts` checks it after another result completes, with no timer that flushes at the elapsed deadline.
26. DRIFT: `ARCHITECTURE.md` section 1 and `IMPLEMENTATION_PLAN.md` Phase 9 say the pipeline is `scan -> dedup-filter -> enqueue/dequeue -> pool(process+retry)` vs `src/ingestor.ts` marks rows `in_progress` and runs hash/dedup inside `WorkerPool` in `processRow`.
27. DRIFT: `PRD.md` R4 says a task that throws shall be retried vs `src/ingestor.ts` calls `hashFile(row.path)` before entering the retry loop, so hash/read errors reject the task and become a fatal `runOnce` error rather than retry/backoff/dead-letter handling.
28. DRIFT: `PRD.md` R5 says `attempts` counts total processing tries and R6 says resume is crash-safe vs `src/ingestor.ts` keeps retry attempts in a local variable and only persists attempts in the final batched `TaskResult`, so attempts made before a crash during retry are not durable.
29. DRIFT: `README.md` section CLI and `IMPLEMENTATION_PLAN.md` Phase 10 say `ingestd scan` scans sources and enqueues but does not process vs `src/cli.ts` handles `scan` by calling `ingestor.runOnce()`, which scans and processes queued rows.
30. DRIFT: `README.md` section CLI says `--json` emits structured NDJSON logs to stdout vs `src/logger.ts` writes JSON `warn` and `error` records to stderr.
31. DRIFT: `PRD.md` section 5 enumerates configuration keys without `sinkToken` vs `src/types.ts` `Config` and `ingestd.config.example.json` include `sinkToken`, making the delivered config surface broader than the PRD/architecture describe.

### 4. Verdict

SIGNIFICANT DRIFT - The project is not a clean baseline. The most important issues are behavioral, not cosmetic: recovery rewinds completed work, retry/dead-letter semantics are off by one and not durable during crashes, FIFO and concurrency guarantees are violated, missing files are hard-deleted instead of soft-deleted, dedup windows use minutes instead of hours, documented defaults do not match `DEFAULT_CONFIG`, and batch commits are not transactionally atomic. The docs also claim verification is green, but `npm run verify` fails in this workspace and there are zero tests despite the plan's acceptance-check claims.
