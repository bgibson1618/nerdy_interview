VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
  - Verification Evidence: FAIL
BLOCKING:
  - src/config.ts: DEFAULT_CONFIG and validation contradict documented defaults and make the documented default/example config invalid.
  - src/ingestor.ts: recovery resets done rows to pending, contradicting crash-safe resume/no committed reprocessing.
  - src/retry.ts: retry jitter and dead-letter boundaries contradict PRD R4/R5.
  - src/scanner.ts: missing-file handling hard-deletes rows instead of soft-deleting and honoring retention.
  - runtime: documented `npm run verify` does not pass in this checkout because `better-sqlite3` is unresolved.
RIGOR: tuned

### 1. Source Brief -> Architecture

- R1 Source scan & discovery: Addressed. PRD requires recursive regular-file discovery, absolute paths, mtime/size recording, no symlink following, and unchanged-file skip (PRD.md:45-46); architecture assigns recursive discovery and mtime/size detection to `src/scanner.ts` (ARCHITECTURE.md:29).
- R2 Content-hash deduplication: Addressed. PRD requires SHA-256 content-addressed dedup within a 24-hour window against live `done` rows (PRD.md:48-49); architecture specifies streamed SHA-256, live `done` lookup, and no sink call on a hit (ARCHITECTURE.md:70-71).
- R3 Bounded concurrency pool: Addressed. PRD requires at most default 4 tasks in flight (PRD.md:51-52); architecture specifies an `inFlight` counter, FIFO wait queue, and cap at `concurrency` (ARCHITECTURE.md:73-74).
- R4 Retry with exponential backoff: Addressed. PRD requires exponential ceilings, clamp, and full jitter (PRD.md:54-55); architecture specifies `computeBackoffMs` and `nextDelayMs` with full jitter (ARCHITECTURE.md:76-77).
- R5 Dead-letter after N attempts: Addressed. PRD requires status `dead` at attempts reaching `maxRetries` and `requeue --dead` reset (PRD.md:57-58); architecture includes `attempts >= maxRetries` transition to `dead` (ARCHITECTURE.md:76-77).
- R6 Checkpoint & resume: Addressed. PRD requires batch manifest updates and checkpoint in one transaction plus `in_progress` recovery (PRD.md:60-61); architecture specifies batch/checkpoint atomicity and startup rewind (ARCHITECTURE.md:82-89).
- R7 Last-write-wins conflict resolution: Addressed but sequencing-sensitive. PRD requires greater `mtime_ms` and equal-mtime `content_hash` tiebreak (PRD.md:63-64); architecture assigns this to `scanner.ts#resolveConflict` (ARCHITECTURE.md:79-80), but that requires candidate content hashes to be available during scanning.
- R8 Batch sizing & flush: Addressed. PRD requires size or age flush and final partial flush (PRD.md:66-67); architecture specifies size/age thresholds, checkpoint update, and force-flush (ARCHITECTURE.md:82-83).
- R9 FIFO processing order: Addressed. PRD requires `discovered_at ASC, id ASC` and retries preserving order (PRD.md:69-70); architecture gives the exact dequeue query (ARCHITECTURE.md:85-86).
- R10 Soft delete & retention purge: Addressed. PRD requires missing files to set `deleted_at` and purge old tombstones after 168 hours (PRD.md:72-73); architecture specifies the soft-delete update and purge delete (ARCHITECTURE.md:91-92).
- R11 Exit codes & graceful shutdown: Addressed. PRD requires exit codes 0-4 and SIGINT/SIGTERM graceful drain (PRD.md:75-76); architecture maps the same exit codes and shutdown path (ARCHITECTURE.md:94-95).
- R12 Structured logging: Addressed. PRD requires NDJSON fields and verbose-gated debug logging (PRD.md:78-79); architecture specifies NDJSON/text behavior and debug suppression (ARCHITECTURE.md:97-98).

### 2. Architecture -> Delivery Plan

- The delivery plan broadly follows the architecture's bottom-up module order: types/config/logger/db before scanner, dedup, retry, pool, batch, ingestor, and CLI (IMPLEMENTATION_PLAN.md:3-47 vs ARCHITECTURE.md:21-36).
- Risky sequencing: architecture and plan put last-write-wins conflict resolution in `scanner.ts` (ARCHITECTURE.md:79-80; IMPLEMENTATION_PLAN.md:21-23), but equal-mtime conflict resolution requires candidate `content_hash`, while hashing is not introduced until the later dedup phase (IMPLEMENTATION_PLAN.md:25-27).
- Missing acceptance infrastructure: the plan calls for phase checks and acceptance battery A2/A4/A5/A6/A8 (IMPLEMENTATION_PLAN.md:12,19,23,27,31,35,39,43,49-51), but the repository has no test files under `src/` or elsewhere in the reviewed file inventory.
- Stale API assumption: the architecture and plan name `scanner.ts#resolveConflict` (ARCHITECTURE.md:79-80; IMPLEMENTATION_PLAN.md:21-23), but the code exports `candidateWins` and never calls it from `upsertCandidate` (src/scanner.ts:43-53,59-89).
- Missing delivery detail: Phase 3 says `src/db.ts` exposes prepared statements used by other modules (IMPLEMENTATION_PLAN.md:17-19), while the architecture only says DB/schema owns prepared statements (ARCHITECTURE.md:28); the actual modules prepare SQL locally, so the plan's module boundary is stale.
- Verification sequencing is stale: the plan says every phase ends with green `npm run verify` (IMPLEMENTATION_PLAN.md:3,49-50), but the documented verification command currently fails in this checkout.

### 3. Delivery/Status -> Code

1. DRIFT: `CONTEXT.md` claims "Clean baseline; all docs match code. `npm run verify` green" (CONTEXT.md:46-47) vs `npm run verify` fails with `src/db.ts(1,22): error TS2307: Cannot find module 'better-sqlite3' or its corresponding type declarations`, and there is no `node_modules` directory in this checkout.
2. DRIFT: `CONTEXT.md` and `README.md` claim the canonical repo path is `/home/bgibs/projects/ingestd` (CONTEXT.md:6-8; README.md:5-10) vs the actual reviewed workspace is `/home/bgibs/projects/agent-roster-observe-smoke/experiments/drift_corpus/_harness/runs/ingestd-r1-codex1`.
3. DRIFT: docs claim `batchSize` default is 64 (PRD.md:83-88; CONTEXT.md:11-16; README.md:50-56; ingestd.config.example.json:4) vs `DEFAULT_CONFIG.batchSize` is 128 (src/config.ts:6-10).
4. DRIFT: docs claim `backoffBaseMs` default is 200 (PRD.md:83-93; CONTEXT.md:18-20; README.md:58-60; ingestd.config.example.json:8) vs `DEFAULT_CONFIG.backoffBaseMs` is 500 (src/config.ts:11-15).
5. DRIFT: PRD says `flushIntervalMs <= pollIntervalMs` is valid and violations abort (PRD.md:98), with documented defaults `flushIntervalMs=2000` and `pollIntervalMs=5000` (PRD.md:86-88) vs validation throws when `flushIntervalMs < pollIntervalMs`, rejecting the documented defaults and example config (src/config.ts:57-59; ingestd.config.example.json:3-5).
6. DRIFT: PRD configuration table omits `sinkToken` as a supported config key (PRD.md:81-97) vs `Config` includes optional `sinkToken` and the example config uses it (src/types.ts:31-47; ingestd.config.example.json:14).
7. DRIFT: PRD/architecture/plan claim full jitter over `[0, ceiling]` for retry delay (PRD.md:54-55; ARCHITECTURE.md:76-77; IMPLEMENTATION_PLAN.md:29-31; CONTEXT.md:26) vs `nextDelayMs` returns the ceiling directly with no `Math.random` jitter (src/retry.ts:15-19).
8. DRIFT: PRD/architecture/CONTEXT say dead-letter occurs when `attempts >= maxRetries` / attempts reaches 5 (PRD.md:57-58; ARCHITECTURE.md:76-77; CONTEXT.md:28-29) vs `shouldDeadLetter` returns true only when `attempts > maxRetries`, so an always-failing task reaches attempt 6 (src/retry.ts:21-25; src/ingestor.ts:121-139).
9. DRIFT: PRD acceptance A5 says an always-throwing handler lands in `dead` after exactly 5 attempts (PRD.md:102-103) vs code waits until `shouldDeadLetter(6, 5)` before returning status `dead` (src/retry.ts:23-25; src/ingestor.ts:121-130).
10. DRIFT: PRD/architecture/plan say the dedup window is hours, specifically `dedupWindowHours*3600000` / 24 hours by default (PRD.md:48-49; ARCHITECTURE.md:70-71; IMPLEMENTATION_PLAN.md:25-27; CONTEXT.md:35) vs `isDuplicate` computes `now - dedupWindowHours * 60_000`, making the default 24 minutes (src/dedup.ts:25-41).
11. DRIFT: PRD/architecture/CONTEXT say missing source files are soft-deleted by setting `deleted_at` and retained (PRD.md:72-73; ARCHITECTURE.md:91-92; CONTEXT.md:40) vs `softDeleteMissing` runs `DELETE FROM manifest WHERE path = ? AND deleted_at IS NULL`, hard-deleting immediately (src/scanner.ts:91-108).
12. DRIFT: PRD/architecture/plan say expired soft-deleted tombstones are hard-purged after `retentionHours` (PRD.md:72-73; ARCHITECTURE.md:91-92; IMPLEMENTATION_PLAN.md:21-23) vs missing-file rows are already hard-deleted before `purgeExpired` can enforce retention (src/scanner.ts:93-108,110-119).
13. DRIFT: PRD/architecture/CONTEXT say last-write-wins keeps the greater `mtime_ms` (PRD.md:63-64; ARCHITECTURE.md:79-80; CONTEXT.md:39) vs `candidateWins` returns true when `candidate.mtime_ms < existing.mtime_ms`, preferring older mtimes if used (src/scanner.ts:43-49).
14. DRIFT: PRD/architecture/plan say equal-mtime conflicts use lexicographically greater `content_hash` and the winner overwrites `content_hash` (PRD.md:63-64; ARCHITECTURE.md:79-80; IMPLEMENTATION_PLAN.md:21-23) vs `upsertCandidate` does not compute or compare candidate hashes, never calls `candidateWins`, and clears `content_hash` to NULL on change (src/scanner.ts:59-89).
15. DRIFT: architecture and plan reference `scanner.ts#resolveConflict(existing, candidate)` (ARCHITECTURE.md:79-80; IMPLEMENTATION_PLAN.md:21-23) vs no `resolveConflict` export exists; the nearest helper is `candidateWins` (src/scanner.ts:43-53).
16. DRIFT: PRD/architecture/CONTEXT say startup recovery rewinds only `in_progress` rows so committed work is not repeated (PRD.md:60-61; ARCHITECTURE.md:88-89; CONTEXT.md:28-29,37) vs `recover()` rewinds both `in_progress` and `done` rows to `pending` (src/ingestor.ts:42-56).
17. DRIFT: PRD says restart resumes from the checkpoint with no committed item reprocessed (PRD.md:60-61) vs `Ingestor` never reads `checkpoint.last_committed_id` and `recover()` can requeue committed `done` rows (src/ingestor.ts:1-15,42-56; src/db.ts:58-62).
18. DRIFT: PRD/architecture/CONTEXT require FIFO dequeue by `discovered_at ASC, id ASC` (PRD.md:69-70; ARCHITECTURE.md:85-86; CONTEXT.md:38) vs `dequeue()` orders `discovered_at DESC, id DESC`, processing newest first (src/ingestor.ts:79-88).
19. DRIFT: PRD/architecture/CONTEXT say the pool holds at most `concurrency` tasks in flight and never starts a new task while that many are running (PRD.md:51-52; ARCHITECTURE.md:73-74; CONTEXT.md:36) vs `WorkerPool.acquire()` admits a task when `inFlight <= concurrency`, allowing `concurrency + 1` tasks (src/pool.ts:21-25).
20. DRIFT: PRD/architecture/CONTEXT say batch manifest updates and checkpoint updates commit in one SQLite transaction atomically (PRD.md:60-61; ARCHITECTURE.md:82-83; CONTEXT.md:37) vs `BatchWriter` defines `commitTxn` as a plain function and never calls `db.transaction` (src/batch.ts:18-46,67-75).
21. DRIFT: PRD/architecture/plan say age-based batch flush occurs when `flushIntervalMs` has elapsed since the first task completed (PRD.md:66-67; ARCHITECTURE.md:82-83; IMPLEMENTATION_PLAN.md:37-39) vs code only checks `isFlushDue()` after task completions and has no timer to flush solely because time elapsed (src/batch.ts:53-65; src/ingestor.ts:173-185).
22. DRIFT: architecture lifecycle says `pending -> in_progress -> (done | failed)` and `failed -> pending` for retry eligibility (ARCHITECTURE.md:64-66; CONTEXT.md:28-29) vs `processRow` retries failures in memory and only returns final `done` or `dead`, so retryable `failed`/`pending` transitions are not persisted (src/ingestor.ts:119-140,173-183).
23. DRIFT: architecture says pipeline order is `scan -> dedup-filter -> enqueue -> pool(process+retry) -> batch-commit+checkpoint` (ARCHITECTURE.md:19) and plan says `runOnce()` does `scan -> dedup-filter -> dequeue FIFO -> pool process` (IMPLEMENTATION_PLAN.md:41-43) vs code marks rows pending during scan, dequeues them, marks `in_progress`, and runs dedup inside `processRow` within the pool (src/scanner.ts:64-70,80-88; src/ingestor.ts:79-108,164-185).
24. DRIFT: README says `ingestd scan` will "Scan sources and enqueue, but do not process" (README.md:28-29) vs CLI `scan` calls `ingestor.runOnce()`, which scans and processes queued rows through the pool and sink (src/cli.ts:88-91; src/ingestor.ts:145-194).
25. DRIFT: README says `--json` produces structured NDJSON logs to stdout (README.md:38) vs logger writes JSON `warn` and `error` records to stderr (src/logger.ts:27-31,37-39).
26. DRIFT: IMPLEMENTATION_PLAN.md says `src/db.ts` exposes prepared statements used by other modules (IMPLEMENTATION_PLAN.md:17-19) vs `src/db.ts` only exports DB open/read helpers and other modules prepare SQL directly (src/db.ts:39-62; src/scanner.ts:60-87; src/ingestor.ts:81-94).
27. DRIFT: IMPLEMENTATION_PLAN.md says acceptance battery A2/A4/A5/A6/A8 is mapped for verification (IMPLEMENTATION_PLAN.md:49-51) vs the reviewed repository contains no test files for those acceptance cases under `src/` or any other tracked project path.

### 4. Verdict

SIGNIFICANT DRIFT — the architecture broadly covers the PRD, but the delivery/status claims do not match the implementation.

Most important issues:

1. The documented verification status is false: `npm run verify` fails because `better-sqlite3` is unresolved in this checkout.
2. Crash-safe resume is contradicted by code: `recover()` rewinds committed `done` rows to `pending`, which can reprocess completed work.
3. Core PRD invariants are broken or stale in code: default config values, config validation, retry jitter, dead-letter attempt count, FIFO ordering, dedup-window units, soft delete/retention, bounded concurrency, and batch transaction atomicity.
4. CLI documentation overstates behavior: `ingestd scan` is documented as scan-only but actually runs the full processing path.
5. The implementation plan is stale relative to code: expected helpers, prepared statement boundaries, and acceptance tests are missing or renamed.
