# ingestd — Implementation Plan

Build order is bottom-up: types → config → logging → DB/schema → stages → orchestrator → CLI. Each phase ends with a green `npm run verify` (type-check) and the noted unit checks.

## Phase 0 — Scaffold
- `package.json` (bin `ingestd` → `dist/cli.js`), `tsconfig.json` (strict, CommonJS, outDir `dist`).
- `npm run verify` must pass on an empty `src/`.

## Phase 1 — Types & config (R11 validation)
- `src/types.ts`: `Status` union (`pending|in_progress|done|failed|dead`), `Config`, `EXIT_CODES`, `LogLevel`, `TaskResult`, `RunSummary`.
- `src/config.ts`: `DEFAULT_CONFIG` with the exact defaults from PRD §5; `loadConfig(path)` merges file over defaults and validates (positive ints; `backoffFactor > 1`; non-empty `sources`; `flushIntervalMs <= pollIntervalMs`). Invalid config throws `ConfigError` → CLI maps to exit 2.
- Check: loading a config with `concurrency: 0` throws; defaults round-trip.

## Phase 2 — Logger (R12)
- `src/logger.ts`: `createLogger({ json, verbose })`. NDJSON object `{ ts, level, event, msg, ...fields }` when `json`; text otherwise. `debug()` is a no-op unless `verbose`.

## Phase 3 — DB & schema (R6 tables)
- `src/db.ts`: `openDb(path)` → enables WAL, runs idempotent `CREATE TABLE IF NOT EXISTS` for `manifest` and `checkpoint`, creates indexes `idx_manifest_status_order` and `idx_manifest_hash`, seeds `checkpoint` row `id=1`. Exposes prepared statements used by other modules.
- Check: opening twice is idempotent; checkpoint row exists with `last_committed_id = 0`.

## Phase 4 — Scanner (R1/R7/R10)
- `src/scanner.ts`: recursive walk (no symlink follow); for each file upsert into `manifest`. Unchanged (same `mtime_ms` AND `size_bytes`) → skip. Changed content → `resolveConflict` (last-write-wins by `mtime_ms`, tiebreak greater `content_hash`). Missing files → soft-delete. `purge(retentionHours)` hard-deletes expired tombstones.
- Check: rediscovery with larger `mtime_ms` updates the row and resets to `pending`; equal mtime keeps the lexically greater hash.

## Phase 5 — Dedup (R2)
- `src/dedup.ts`: `hashFile(path)` streams SHA-256 in 64 KiB chunks → lowercase hex. `isDuplicate(hash, now)` true iff a live `done` row shares the hash with `updated_at >= now - dedupWindowHours*3600000`.
- Check: identical bytes within window → duplicate; same bytes after window → not duplicate.

## Phase 6 — Retry (R4/R5)
- `src/retry.ts`: `computeBackoffMs(attempt)` = `min(base * factor^(attempt-1), max)`; `nextDelayMs(attempt)` = full jitter over `[0, ceiling]`. `shouldDeadLetter(attempts, maxRetries)` = `attempts >= maxRetries`.
- Check: ceilings for attempts 1..5 are 200/400/800/1600/3200 with defaults; attempt 6 ceiling clamps but is unreachable (dead-lettered at 5).

## Phase 7 — Pool (R3)
- `src/pool.ts`: `WorkerPool(concurrency)` with `submit(task)` and `drain()`. At most `concurrency` (4) in flight. FIFO admission.
- Check: with concurrency 4 and 10 tasks, peak in-flight never exceeds 4.

## Phase 8 — Batch (R6/R8)
- `src/batch.ts`: `BatchWriter(db, batchSize, flushIntervalMs)`. `add(result)` buffers; flush on size **or** age; `flush()` commits manifest updates + checkpoint in one transaction; `close()` force-flushes the remainder.
- Check: 200 results at batchSize 64 → 3 full + 1 partial commit; checkpoint `last_committed_id` equals the max committed id.

## Phase 9 — Ingestor (R6 recovery, orchestration)
- `src/ingestor.ts`: `recover()` rewinds `in_progress`→`pending`; `runOnce()` = scan → dedup-filter → dequeue FIFO → pool process w/ retry → batch commit; returns `RunSummary` `{ scanned, enqueued, deduped, processed, failed, dead }`; `runForever()` loops `runOnce` every `pollIntervalMs` until stopped or dead-letter abort.
- Check: acceptance A4/A5/A6/A8 from PRD §6.

## Phase 10 — CLI (R11)
- `src/cli.ts`: commands `run` (`--once`), `scan`, `status`, `requeue --dead`; global flags `--config/--db/--json/--verbose`. Maps `ConfigError`→2, signal→3, dead-letter abort→4, other errors→1, clean drain→0. Installs SIGINT/SIGTERM handlers that set `stopping`.
- `src/index.ts`: re-export `Ingestor`, `loadConfig`, `DEFAULT_CONFIG`, types.

## Verification
- `npm run verify` (type-check) green after every phase.
- Acceptance battery A2/A4/A5/A6/A8 mapped to Phases 5/6/8/9.
