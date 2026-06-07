# ingestd — Independent Drift / Coherence Review

Reviewer: verifier (fresh eyes, on-disk artifacts only)
Scope: CONTEXT.md, PRD.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, README.md, all `src/**`, plus `ingestd.config.example.json`, `package.json`, `tsconfig.json`.

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> Architecture: PASS
  - Architecture -> Delivery plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

The docs (PRD / ARCHITECTURE / PLAN / README / CONTEXT) are internally coherent and agree with one another on every checkable constant and contract. The **code**, however, contradicts the docs in many specific, checkable ways — several of them invert a documented behavior (conflict resolution, FIFO order, validation comparison, dedup window unit, soft-delete) and at least two are correctness-breaking (`recover()` rewinds `done` rows; the default/example config fails its own validation). This is **SIGNIFICANT DRIFT**.

---

### 1. Source Brief -> Architecture

The architecture addresses every numbered PRD requirement; nothing is unsatisfied, overbuilt, or contradicted at the doc level.

| Req | Title | Addressed in ARCHITECTURE? |
|-----|-------|----------------------------|
| R1 | Source scan & discovery | Yes — §2 Scanner, §4 (scan stage), 4.8 |
| R2 | Content-hash dedup | Yes — §2 Dedup, 4.1 |
| R3 | Bounded concurrency pool | Yes — §2 Pool, 4.2 |
| R4 | Retry w/ exponential backoff | Yes — §2 Retry, 4.3 |
| R5 | Dead-letter after N | Yes — 4.3, 4.9 |
| R6 | Checkpoint & resume | Yes — 3.2, 4.5, 4.7, §5 |
| R7 | Last-write-wins conflict | Yes — 4.4 |
| R8 | Batch sizing & flush | Yes — 4.5 |
| R9 | FIFO order | Yes — 4.6 |
| R10 | Soft delete & retention purge | Yes — 4.8 |
| R11 | Exit codes & graceful shutdown | Yes — 4.9 |
| R12 | Structured logging | Yes — 4.10 |

The data model (3.1/3.2/3.3), the canonical constants, and the status lifecycle in ARCHITECTURE match PRD §5 and CONTEXT exactly. **No drift at this layer.**

### 2. Architecture -> Delivery Plan

The plan builds the architecture bottom-up (types → config → logger → db → stages → ingestor → CLI), one module per phase, with a verify gate and unit checks per phase. Phases map cleanly onto the module inventory and the acceptance battery (A2/A4/A5/A6/A8) is allocated to Phases 5/6/8/9. The plan is coherent with the architecture.

Two notes (both are really code-vs-doc and are itemized in §3, not plan-vs-arch contradictions):
- The plan and ARCHITECTURE 4.4 name the conflict helper **`resolveConflict`**; the code ships it as **`candidateWins`** and never calls it (see §3 #5).
- The plan's acceptance checks (Phase 6 "ceilings… dead-lettered at 5"; Phase 8 "200 results at batchSize 64 → 3 full + 1 partial"; Phase 9 A5/A6) are written against the documented behavior, which the code does not implement (see §3 #1, #6, #10).

### 3. Delivery/Status -> Code

CONTEXT.md (line 47) and README claim "all docs match code / clean baseline." They do not. Concrete, individually checkable inconsistencies:

1. **DRIFT: `batchSize` default = 64** (PRD §5 line 87; CONTEXT line 16; README line 56) **vs `DEFAULT_CONFIG.batchSize = 128`** (`src/config.ts:9`). Every doc says 64; code default is 128.

2. **DRIFT: `backoffBaseMs` default = 200** (PRD §5 line 91 & R4 line 55; CONTEXT line 18; README line 59; ARCHITECTURE 4.3 line 77 — "ceilings 200, 400, 800, 1600, 3200") **vs `DEFAULT_CONFIG.backoffBaseMs = 500`** (`src/config.ts:13`). With 500 the un-jittered ceilings become 500/1000/2000/4000/8000, not the documented 200…3200.

3. **DRIFT: config validation rule "`flushIntervalMs <= pollIntervalMs`"** (PRD §5 line 98; IMPLEMENTATION_PLAN Phase 1 line 11) **vs inverted comparison `if (c.flushIntervalMs < c.pollIntervalMs) throw`** (`src/config.ts:57`). The code throws when `flush < poll` (the normal/valid case) and *accepts* `flush > poll` (the invalid case); the error string still reads "must be <= pollIntervalMs". Consequence: `DEFAULT_CONFIG` (flush 2000 < poll 5000) and the shipped `ingestd.config.example.json` (flush 2000, poll 5000) both **fail validation → exit 2**, so the documented default/example config will not load.

4. **DRIFT: dedup window is `dedupWindowHours` *hours* → cutoff `now - dedupWindowHours*3600_000`** (ARCHITECTURE 4.1 line 71; PRD R2 line 49 "24 hours"; PLAN Phase 5 line 26 "*3600000"; CONTEXT line 22) **vs `const cutoff = now - dedupWindowHours * 60_000`** (`src/dedup.ts:31`). `60_000 ms` = 1 minute, so the window is treated as *minutes*: the default 24 becomes 24 **minutes**, 60× too short. Breaks acceptance A2 ("identical file within 24h yields a dedup hit").

5. **DRIFT: last-write-wins conflict resolution — "greater `mtime_ms` wins"** (PRD R7 line 64; ARCHITECTURE 4.4 line 80 `scanner.ts#resolveConflict`; CONTEXT line 39) **vs `candidateWins` returns `candidate.mtime_ms < existing.mtime_ms`** (`src/scanner.ts:48`). The comparison is inverted — the **older** mtime wins, the opposite of last-write-wins. Compounding: (a) the function is named `candidateWins`, not the documented `resolveConflict`; and (b) it is **dead code** — `grep` shows no caller. `upsertCandidate` (`src/scanner.ts:59-89`) requeues on *any* mtime/size change without ever consulting it, so the documented mtime/hash conflict policy is not applied at all.

6. **DRIFT: dead-letter at "`attempts >= maxRetries`", i.e. exactly 5 attempts** (PRD R5 line 58; ARCHITECTURE 4.3 line 77; PLAN Phase 6 line 30; CONTEXT line 29) **vs `shouldDeadLetter` returns `attempts > maxRetries`** (`src/retry.ts:24`). With `>`, a task is dead-lettered only after attempt 6, giving 6 tries instead of 5. Breaks acceptance A5 ("lands in `dead` after exactly 5 attempts").

7. **DRIFT: `nextDelayMs` applies full jitter, uniform in `[0, ceiling]`** (PRD R4 line 55; ARCHITECTURE 4.3 line 77 — `Math.floor(Math.random()*(ceiling+1))`; CONTEXT line 26) **vs `nextDelayMs` returns the ceiling unchanged with no jitter** (`src/retry.ts:16-19`). No `Math.random()` anywhere in `retry.ts`; the delay is the deterministic ceiling.

8. **DRIFT: pool holds "at most `concurrency` (4)" in flight; "peak in-flight never exceeds 4"** (PRD R3 line 52; ARCHITECTURE 4.2 line 74 "Exactly concurrency (4)"; PLAN Phase 7 line 35) **vs `acquire()` admits while `this.inFlight <= this.concurrency`** (`src/pool.ts:22`). `<=` lets a new task start when `inFlight == concurrency`, so peak in-flight reaches **concurrency + 1 = 5**. Should be `<`.

9. **DRIFT: FIFO dequeue "`ORDER BY discovered_at ASC, id ASC`"** (ARCHITECTURE 4.6 line 86; PRD R9 line 70; CONTEXT line 38) **vs `ORDER BY discovered_at DESC, id DESC`** (`src/ingestor.ts:85`). The SQL is LIFO (newest first); the in-code comment on `src/ingestor.ts:79` even claims "oldest discovered_at first." Directly violates R9.

10. **DRIFT: startup recovery rewinds *only* `in_progress` rows — "the only place `in_progress` rows are rewound"** (ARCHITECTURE 4.7 line 89 query `WHERE status='in_progress'`; PRD R6 line 61 "no committed work is repeated"; CONTEXT line 29) **vs `recover()` runs `... WHERE status IN ('in_progress', 'done')`** (`src/ingestor.ts:48`). Every restart rewinds **`done`** rows back to `pending`, so committed work is reprocessed on each run — violates PRD §1 ("Re-running after a crash must never double-process a file that was already committed") and acceptance A6. The method comment (`src/ingestor.ts:42-43`) says only `in_progress`.

11. **DRIFT: missing files are *soft-deleted* — "`UPDATE manifest SET deleted_at=? … WHERE path=?`", row retained** (ARCHITECTURE 4.8 line 92; PRD R10 line 73; CONTEXT line 40) **vs `softDeleteMissing` issues `DELETE FROM manifest WHERE path = ? AND deleted_at IS NULL`** (`src/scanner.ts:97-103`). It **hard-deletes** immediately despite the function name/comment ("soft-delete… tombstoned"). No tombstone is ever written, so the `retentionHours` purge has nothing to act on and dedup history for a deleted path is lost at once. Violates R10.

12. **DRIFT: `ingestd scan` = "Scan sources and enqueue, but do not process"** (README lines 28-29; PLAN Phase 10 line 46 lists `scan` as distinct from `run`) **vs the `scan` command calls `ingestor.runOnce()`** (`src/cli.ts:88-89`), which runs the full pipeline (scan → dedup → pool processing → batch commit). The `scan` command actually processes the queue, contradicting the README's "do not process."

Lower-severity / secondary observations (doc-vs-code, lower impact):

13. **Observation: `Status` value `failed` and `RunSummary.failed` are effectively unreachable.** ARCHITECTURE 3.3 / CONTEXT line 29 describe a persisted `failed` state and `failed → pending|dead` transitions, but `processRow` (`src/ingestor.ts:121-141`) retries in-process and only ever returns `done` or `dead`; `status='failed'` is never written and `summary.failed` (`src/ingestor.ts:181`) stays 0. The documented `failed` transition does not occur as written.

14. **Observation: log stream split vs "NDJSON logs to stdout."** README line 38 says `--json` emits "structured NDJSON logs **to stdout**"; `src/logger.ts:30,38` routes `warn`/`error` to **stderr**. Reasonable behavior, but it diverges from the README's stdout claim.

15. **Observation (status claim):** CONTEXT line 47 ("Clean baseline; all docs match code. `npm run verify` green") and README's "crash-safe / idempotent" framing are stale given #1–#12. Type-check (`npm run verify`) may still pass — these are behavioral, not type, defects — so a green `verify` is not evidence the baseline is clean.

### 4. Verdict

**SIGNIFICANT DRIFT.** The documentation set is self-consistent, but the code departs from it in at least 12 concrete, checkable ways, several of which invert a documented behavior. Most important first:

1. **#10 — `recover()` rewinds `done` rows** (`src/ingestor.ts:48`): breaks idempotency/crash-safety, the product's central promise (PRD §1, R6, A6). Highest severity.
2. **#3 — inverted config validation** (`src/config.ts:57`): the documented default and the shipped example config fail to load (exit 2); the binary is unusable out of the box with documented settings.
3. **#11 — hard delete instead of soft delete** (`src/scanner.ts:97`): destroys retention/tombstone semantics (R10) and dedup history.
4. **#4 — dedup window in minutes not hours** (`src/dedup.ts:31`): dedup default silently 60× too short; breaks A2.
5. **#9 — LIFO instead of FIFO dequeue** (`src/ingestor.ts:85`): violates R9; comment contradicts code.
6. **#5 — inverted (and unused) conflict resolution** (`src/scanner.ts:48`): older-write-wins, and the helper is dead code so the policy never runs.
7. **#6 / #7 — dead-letter at 6 not 5, and no jitter** (`src/retry.ts:24,16-19`): breaks A5 and the documented backoff contract.
8. **#8 — pool allows 5 in flight** (`src/pool.ts:22`): violates the hard concurrency cap (R3).
9. **#1 / #2 — `batchSize` 128 and `backoffBaseMs` 500 defaults** (`src/config.ts:9,13`): diverge from every doc.
10. **#12 — `scan` command processes** (`src/cli.ts:89`): contradicts README's "do not process."

No code or docs were modified during this review (report-only, per task).
