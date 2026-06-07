# ingestd — Architecture

## 1. System shape

`ingestd` is a single-process pipeline. The CLI parses args, loads config, opens the SQLite database, and drives an `Ingestor`. The library entrypoint exposes the same `Ingestor` for embedding. There is no network surface.

```
 CLI (cli.ts) ──▶ loadConfig (config.ts) ──▶ Ingestor (ingestor.ts)
                                                  │
      ┌───────────────────────────────────────────┼─────────────────────────┐
      ▼                    ▼                        ▼                         ▼
  Scanner            DedupService            WorkerPool                 BatchWriter
 (scanner.ts)        (dedup.ts)             (pool.ts)                  (batch.ts)
      │                    │                  │   │                        │
      └──── manifest ◀─────┴── RetryPolicy ◀──┘   └──▶ sink handler         └──▶ checkpoint
              (db.ts / schema)   (retry.ts)
```

Stages, in pipeline order: **scan → dedup-filter → enqueue → pool(process+retry) → batch-commit+checkpoint**.

## 2. Module inventory

| Module | File | Responsibility |
|--------|------|----------------|
| Types | `src/types.ts` | Shared types, `Status` enum, `EXIT_CODES`, `LogLevel`. |
| Config | `src/config.ts` | `loadConfig`, `DEFAULT_CONFIG`, validation. |
| Logger | `src/logger.ts` | Structured NDJSON / text logging. |
| DB & schema | `src/db.ts` | Open DB, run migrations, prepared statements. |
| Scanner | `src/scanner.ts` | Recursive discovery, mtime/size change detection, soft-delete. |
| Dedup | `src/dedup.ts` | SHA-256 hashing + window check. |
| Retry | `src/retry.ts` | Backoff math + jitter, attempt accounting. |
| Pool | `src/pool.ts` | Bounded concurrency executor. |
| Batch | `src/batch.ts` | Size/timer flush, transactional commit + checkpoint. |
| Ingestor | `src/ingestor.ts` | Orchestrates the pipeline; `runOnce` / `runForever`. |
| CLI | `src/cli.ts` | Arg parsing, command dispatch, exit codes, signals. |
| Library | `src/index.ts` | Public exports. |

## 3. Data model

SQLite via `better-sqlite3`, synchronous API, WAL mode (`PRAGMA journal_mode = WAL`). Times are integer **epoch milliseconds** unless noted.

### 3.1 `manifest`

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | monotonic insert id |
| `path` | TEXT UNIQUE NOT NULL | absolute source path |
| `content_hash` | TEXT | SHA-256 hex; NULL until first hash |
| `size_bytes` | INTEGER NOT NULL | |
| `mtime_ms` | INTEGER NOT NULL | source mtime (epoch ms) |
| `status` | TEXT NOT NULL | one of `Status` (default `pending`) |
| `attempts` | INTEGER NOT NULL DEFAULT 0 | total processing tries |
| `last_error` | TEXT | last failure message, else NULL |
| `discovered_at` | INTEGER NOT NULL | first-seen epoch ms (FIFO key) |
| `updated_at` | INTEGER NOT NULL | last state change epoch ms |
| `deleted_at` | INTEGER | soft-delete tombstone; NULL = live |

Indexes: `idx_manifest_status_order (status, discovered_at, id)` for FIFO dequeue; `idx_manifest_hash (content_hash, status, updated_at)` for dedup-window lookups.

### 3.2 `checkpoint`

Single-row table (`id = 1`). Columns: `id INTEGER PK CHECK(id = 1)`, `last_committed_id INTEGER NOT NULL DEFAULT 0`, `batches_committed INTEGER NOT NULL DEFAULT 0`, `updated_at INTEGER NOT NULL`.

### 3.3 `Status` enum

`pending`, `in_progress`, `done`, `failed`, `dead`. Lifecycle: `pending → in_progress → (done | failed)`; `failed → pending` (retry eligible) or `failed → dead` (retries exhausted). `in_progress` is transient and reset to `pending` on startup recovery.

## 4. Behavioral contracts

### 4.1 Deduplication (R2)
`dedup.ts` hashes the full file with Node `crypto.createHash('sha256')` streamed in 64 KiB chunks and returns a lowercase hex digest. A dedup hit requires another **live** (`deleted_at IS NULL`) manifest row with the same `content_hash`, `status = 'done'`, and `updated_at >= now - dedupWindowHours*3600_000`. On a hit the new row is set to `done` without a sink call and counted under `deduped`.

### 4.2 Concurrency (R3)
`pool.ts` keeps an `inFlight` counter and a pending FIFO queue. `submit` resolves a slot only while `inFlight < concurrency`; otherwise the task waits. Exactly `concurrency` (4) tasks may run at once. The pool drains by awaiting all settled tasks.

### 4.3 Retry & backoff (R4/R5)
`retry.ts#computeBackoffMs(attempt)` returns `min(backoffBaseMs * backoffFactor^(attempt-1), backoffMaxMs)` as the **ceiling**, and `nextDelayMs(attempt)` applies full jitter: `Math.floor(Math.random() * (ceiling + 1))`, i.e. uniform in `[0, ceiling]`. `attempt` here is the retry index (1-based). A task increments `attempts` on each try; when `attempts >= maxRetries` (5) after a failure it transitions to `dead` instead of back to `pending`. The un-jittered ceilings for attempts 1..5 are 200, 400, 800, 1600, 3200 ms.

### 4.4 Conflict resolution (R7)
When a rediscovered `path` has a different `content_hash`, `scanner.ts#resolveConflict(existing, candidate)` keeps the version with the greater `mtime_ms`; on a tie it keeps the lexicographically greater `content_hash`. The winner overwrites `content_hash`, `size_bytes`, `mtime_ms`, sets `status = 'pending'`, `attempts = 0`, and bumps `updated_at`.

### 4.5 Batch flush & checkpoint (R6/R8)
`batch.ts` accumulates completed task results. It flushes when `pending.length >= batchSize` (64) OR `now - firstAddedAt >= flushIntervalMs` (2000). A flush runs a single `db.transaction`: it writes every status update AND updates `checkpoint.last_committed_id` to the max `id` in the batch, increments `batches_committed`, and stamps `updated_at`. Either the whole batch + checkpoint commit, or none of it (atomicity). The final partial batch is force-flushed on drain/shutdown.

### 4.6 Ordering (R9)
Dequeue query: `SELECT ... FROM manifest WHERE status = 'pending' AND deleted_at IS NULL ORDER BY discovered_at ASC, id ASC LIMIT ?`. Retried items keep their original `discovered_at`, so they do not preempt older work.

### 4.7 Startup recovery (R6)
On open, `ingestor.ts#recover()` runs `UPDATE manifest SET status='pending', updated_at=? WHERE status='in_progress'` before the first scan. This is the only place `in_progress` rows are rewound.

### 4.8 Soft delete & purge (R10)
Missing files: `UPDATE manifest SET deleted_at=?, updated_at=? WHERE path=? AND deleted_at IS NULL`. Purge: `DELETE FROM manifest WHERE deleted_at IS NOT NULL AND deleted_at < now - retentionHours*3600_000`.

### 4.9 Exit codes & shutdown (R11)
`EXIT_CODES = { OK: 0, ERROR: 1, CONFIG: 2, INTERRUPTED: 3, DEAD_LETTER: 4 }`. A run that produces more than `deadLetterAbortThreshold` (100) newly dead items aborts the loop and returns exit 4. SIGINT/SIGTERM sets a `stopping` flag; the pool finishes in-flight tasks, the batcher force-flushes, and the CLI exits 3.

### 4.10 Logging (R12)
`logger.ts` emits NDJSON when `json=true`, else text. Every record carries `ts`, `level`, `event`, `msg`. `debug` is suppressed unless `verbose=true`.

## 5. Concurrency & transaction notes
- All DB access is synchronous (`better-sqlite3`); the only async surface is the sink handler and the inter-task scheduling in `pool.ts`.
- Exactly one writer: batch commits are serialized through the single connection, so the per-batch transaction is the unit of atomicity for both manifest updates and the checkpoint.
- WAL mode is enabled for crash durability.
