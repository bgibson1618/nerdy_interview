# ingestd

`ingestd` is a file-ingestion / sync worker shipped as both a **CLI** and a **library**. It watches one or more source directories, hashes file contents to skip duplicates, and ingests them through a bounded worker pool with retries, a dead-letter queue, and crash-safe checkpoint/resume. All worker state lives in a single SQLite database (`better-sqlite3`).

## Environment contract

- Canonical repo path: `/home/bgibs/projects/ingestd`
- Commands run in **WSL** (Node via `nvm`).
- Verification command: `npm run verify` (type-checks with `tsc --noEmit`).
- Stack: Node >= 18, TypeScript, `better-sqlite3`.

## Install & build

```bash
npm install
npm run build
```

## CLI

```bash
# Run the worker loop until the queue drains, then exit (one-shot)
ingestd run --once

# Run continuously, re-scanning every poll interval
ingestd run

# Scan sources and enqueue, but do not process
ingestd scan

# Show queue counts by status
ingestd status

# Re-queue dead-lettered items
ingestd requeue --dead
```

Global flags: `--config <path>` (default `./ingestd.config.json`), `--db <path>` (default `./ingestd.sqlite`), `--json` (structured NDJSON logs to stdout), `--verbose`.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success — queue drained (or `--once` completed) cleanly |
| 1 | Generic runtime error |
| 2 | Configuration error (invalid/unreadable config) |
| 3 | Interrupted by SIGINT/SIGTERM (graceful shutdown) |
| 4 | Dead-letter threshold exceeded (see `deadLetterAbortThreshold`) |

## Defaults at a glance

| Setting | Default |
|---------|---------|
| `pollIntervalMs` | 5000 |
| `batchSize` | 64 |
| `flushIntervalMs` | 2000 |
| `concurrency` | 4 |
| `maxRetries` | 5 |
| `backoffBaseMs` | 200 |
| `backoffFactor` | 2 |
| `backoffMaxMs` | 30000 |
| `dedupWindowHours` | 24 |
| `retentionHours` | 168 |
| `deadLetterAbortThreshold` | 100 |

See `PRD.md` for requirements, `ARCHITECTURE.md` for the design, and `IMPLEMENTATION_PLAN.md` for the build order.

## Library usage

```ts
import { Ingestor, loadConfig } from "ingestd";

const config = loadConfig("./ingestd.config.json");
const ingestor = new Ingestor(config, "./ingestd.sqlite");
const summary = await ingestor.runOnce();
console.log(summary); // { scanned, enqueued, deduped, processed, failed, dead }
```

Secrets, when present, must be placeholders such as `FAKE_DEMO_SECRET` in example configs.
