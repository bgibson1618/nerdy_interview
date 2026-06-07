# ingestd — Working Context

## What this is
A file-ingestion / sync worker (CLI + library). Watches source dirs, dedups by SHA-256 content hash, ingests through a bounded worker pool with retry/backoff, dead-letters after N attempts, and checkpoints for crash-safe resume. State is one SQLite file via `better-sqlite3`.

## Environment contract
- Repo: `/home/bgibs/projects/ingestd` (WSL, Node via nvm).
- Verify: `npm run verify` (tsc `--noEmit`). Build: `npm run build`. Tests: `npm test` (node:test).
- No network surface; single process.

## Canonical constants (source of truth: `src/config.ts#DEFAULT_CONFIG`)
| Constant | Value |
|----------|-------|
| pollIntervalMs | 5000 |
| batchSize | 64 |
| flushIntervalMs | 2000 |
| concurrency | 4 |
| maxRetries | 5 |
| backoffBaseMs | 200 |
| backoffFactor | 2 |
| backoffMaxMs | 30000 |
| dedupWindowHours | 24 |
| retentionHours | 168 |
| deadLetterAbortThreshold | 100 |

Backoff ceilings (attempts 1..5): 200, 400, 800, 1600, 3200 ms; full jitter applied over `[0, ceiling]`.

## Status lifecycle
`pending → in_progress → done|failed`; `failed → pending` (retry) or `failed → dead` (attempts ≥ 5). `in_progress` is rewound to `pending` on startup recovery.

## Exit codes
0 OK · 1 generic error · 2 config error · 3 interrupted · 4 dead-letter threshold exceeded.

## Invariants worth remembering
- Dedup is **content-addressed** (same bytes anywhere = hit), window default 24h, only against **live, `done`** rows.
- Concurrency cap is a hard 4 in-flight; pool is FIFO.
- Checkpoint + manifest updates commit in **one** transaction per batch (atomic); final partial batch always flushes.
- FIFO order = `discovered_at ASC, id ASC`; retries keep original `discovered_at`.
- Conflict = last-write-wins by `mtime_ms`, tiebreak = greater `content_hash`.
- Soft delete sets `deleted_at`; hard purge after `retentionHours` (168h).
- Any example secret is a placeholder like `FAKE_DEMO_SECRET`.

## Module map
types → config → logger → db → scanner/dedup/retry/pool/batch → ingestor → cli/index. See `ARCHITECTURE.md` §2.

## Status
Clean baseline; all docs match code. `npm run verify` green.
