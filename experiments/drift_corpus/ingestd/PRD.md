# ingestd — Product Requirements Document

## 1. Overview

`ingestd` is a long-running (or one-shot) file-ingestion worker that synchronizes the contents of one or more **source directories** into a downstream **sink** via a pluggable handler. It is delivered as a CLI and as an embeddable TypeScript library. Durable state (the manifest, the queue, and the resume checkpoint) is kept in a single local SQLite database accessed with `better-sqlite3`.

The worker must be **crash-safe**, **idempotent**, and **bounded** in its resource use. Re-running after a crash must never double-process a file that was already committed, and must resume exactly where it left off.

## 2. Goals & non-goals

### Goals
- Deterministic, replayable ingestion with content-addressed deduplication.
- Bounded concurrency and bounded memory regardless of source size.
- Transparent retry/backoff with a dead-letter escape hatch.
- Operable from a CLI with meaningful exit codes and structured logs.

### Non-goals
- Distributed/multi-node coordination (single-process only).
- A network server or HTTP API.
- Streaming partial-file ingestion (files are processed whole).

## 3. Personas
- **Operator** — runs the CLI, reads logs/exit codes, requeues dead items.
- **Integrator** — embeds the library, supplies a sink handler.

## 4. Numbered requirements

> Priority: P0 = must, P1 = should. Each requirement is verifiable against the code module named in `ARCHITECTURE.md`.

| # | Title | Priority |
|----|-------|----------|
| R1 | Source scan & discovery | P0 |
| R2 | Content-hash deduplication | P0 |
| R3 | Bounded concurrency pool | P0 |
| R4 | Retry with exponential backoff | P0 |
| R5 | Dead-letter after N attempts | P0 |
| R6 | Checkpoint & resume | P0 |
| R7 | Last-write-wins conflict resolution | P0 |
| R8 | Batch sizing & flush | P0 |
| R9 | FIFO processing order | P1 |
| R10 | Soft delete & retention purge | P1 |
| R11 | Exit codes & graceful shutdown | P0 |
| R12 | Structured logging | P1 |

### R1 — Source scan & discovery (P0)
The worker SHALL recursively scan each configured source root and discover regular files. Each discovered file is recorded in the `manifest` table keyed by absolute `path`. A scan records, per file, its `size_bytes` and source modification time `mtime_ms`. Symlinks are not followed. A discovered file that is unchanged since its last recorded `mtime_ms` AND `size_bytes` SHALL NOT be re-enqueued.

### R2 — Content-hash deduplication (P0)
For each file selected for ingestion, the worker SHALL compute a **SHA-256** hex digest of the full file contents (`content_hash`). If a manifest row with the **same `content_hash`** reached status `done` within the **dedup window** (default **24 hours**, `dedupWindowHours`), the new file SHALL be marked `done` immediately as a dedup hit and SHALL NOT be handed to the sink handler. Dedup is content-addressed, not path-addressed: the same bytes under a different path are a dedup hit.

### R3 — Bounded concurrency pool (P0)
Processing SHALL run through a worker pool that holds at most `concurrency` (default **4**) tasks in flight simultaneously. The pool SHALL never start a new task while `concurrency` tasks are already running; it starts the next queued task only when an in-flight slot frees up.

### R4 — Retry with exponential backoff (P0)
A task that throws SHALL be retried. The delay before the *k*-th retry (k = 1 for the first retry) is `backoffBaseMs * (backoffFactor ^ (k - 1))`, clamped to at most `backoffMaxMs`, then **full jitter** is applied: the actual delay is a uniform random value in `[0, computed]`. Defaults: `backoffBaseMs = 200`, `backoffFactor = 2`, `backoffMaxMs = 30000`. With defaults the un-jittered ceiling sequence is 200, 400, 800, 1600, 3200 ms.

### R5 — Dead-letter after N attempts (P0)
`attempts` counts total processing tries (the initial try is attempt 1). After a task has failed `maxRetries` (default **5**) times — i.e. `attempts` reaches 5 — it SHALL be moved to status `dead` and SHALL NOT be retried again automatically. Dead items remain in the manifest and can be re-queued with `ingestd requeue --dead`, which resets `attempts` to 0 and status to `pending`.

### R6 — Checkpoint & resume (P0)
Progress SHALL be checkpointed in the `checkpoint` table after **each batch commit** within a single SQLite transaction that also writes the batch's manifest status updates. On restart the worker SHALL resume from the checkpoint: any row left in `in_progress` (a crash mid-batch) is reset to `pending` before scanning resumes, so no committed work is repeated and no in-flight work is lost.

### R7 — Last-write-wins conflict resolution (P0)
When the same `path` is rediscovered with different content, the row with the **greater `mtime_ms`** wins (last write wins). If two candidate versions have **equal `mtime_ms`**, the tiebreak is the lexicographically greater `content_hash`. The winning version replaces the manifest row's `content_hash`, `size_bytes`, and `mtime_ms` and resets status to `pending` so the new content is ingested.

### R8 — Batch sizing & flush (P0)
Completed tasks SHALL be committed in batches. A batch is flushed (committed in one transaction) when **either** it reaches `batchSize` (default **64**) completed tasks **or** `flushIntervalMs` (default **2000**) has elapsed since the batch's first task completed — whichever comes first. A final partial batch is always flushed on drain/shutdown.

### R9 — FIFO processing order (P1)
Queued items SHALL be dequeued in **first-in-first-out** order: ascending `discovered_at`, with `id` ascending as the tiebreak. Retries do not jump the queue ahead of older pending items; a retried item keeps its original `discovered_at`.

### R10 — Soft delete & retention purge (P1)
When a source file disappears, its manifest row SHALL be **soft-deleted** by setting `deleted_at` (the row is retained). Soft-deleted rows are excluded from scans and dedup. A separate purge SHALL **hard-delete** rows whose `deleted_at` is older than `retentionHours` (default **168**, i.e. 7 days).

### R11 — Exit codes & graceful shutdown (P0)
The CLI SHALL exit with: `0` success, `1` generic error, `2` configuration error, `3` interrupted by signal, `4` dead-letter abort threshold exceeded. On SIGINT/SIGTERM the worker SHALL stop accepting new tasks, let in-flight tasks finish, flush the final batch, then exit `3`.

### R12 — Structured logging (P1)
With `--json`, every log line SHALL be a single JSON object (NDJSON) including at least `ts` (ISO-8601), `level` (`debug|info|warn|error`), `event`, and `msg`. Without `--json`, logs are human-readable text. `debug` lines are emitted only when `--verbose` is set.

## 5. Configuration

| Key | Type | Default | Requirement |
|-----|------|---------|-------------|
| `sources` | string[] | `[]` (required, non-empty) | R1 |
| `pollIntervalMs` | int | 5000 | R1 |
| `batchSize` | int | 64 | R8 |
| `flushIntervalMs` | int | 2000 | R8 |
| `concurrency` | int | 4 | R3 |
| `maxRetries` | int | 5 | R5 |
| `backoffBaseMs` | int | 200 | R4 |
| `backoffFactor` | number | 2 | R4 |
| `backoffMaxMs` | int | 30000 | R4 |
| `dedupWindowHours` | int | 24 | R2 |
| `retentionHours` | int | 168 | R10 |
| `deadLetterAbortThreshold` | int | 100 | R11 |

Validation (R11/exit 2): `sources` must be a non-empty array; all numeric fields must be positive integers (except `backoffFactor` > 1); `flushIntervalMs <= pollIntervalMs`. Any violation aborts with exit code 2 before any DB work.

## 6. Acceptance criteria (selected)
- A2: Re-ingesting an identical file within 24h yields a dedup hit and zero sink calls (R2).
- A4: A handler that throws on attempts 1-4 and succeeds on attempt 5 results in status `done` with `attempts = 5` (R4/R5).
- A5: The same handler that always throws lands in `dead` after exactly 5 attempts (R5).
- A6: Killing the process mid-batch and restarting resumes with no committed item reprocessed and no in-flight item lost (R6).
- A8: With `batchSize=64`, a run of 200 completed tasks produces 3 full commits + 1 partial (R8).
