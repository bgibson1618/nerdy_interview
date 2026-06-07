# Independent Coherence / Drift Review — `ingestd`

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

Reviewed with fresh eyes from on-disk artifacts only: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, `ingestd.config.example.json`, `package.json`, and all of `src/`.
The docs are internally coherent and the architecture covers the PRD; the **code has drifted hard from the
docs**. Many drifts are behavior-changing and several break stated acceptance criteria. CONTEXT.md's claim
"Clean baseline; all docs match code" is false.

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement. Mapping:

| Req | Title | Addressed in ARCHITECTURE | Status |
|-----|-------|---------------------------|--------|
| R1 | Source scan & discovery | §2 Scanner, §4 (walk, no symlink follow, mtime/size change) | Satisfied |
| R2 | Content-hash dedup | §4.1 (SHA-256, 64 KiB chunks, live `done` window) | Satisfied |
| R3 | Bounded concurrency | §4.2 (inFlight ≤ concurrency, FIFO admission) | Satisfied |
| R4 | Retry + backoff | §4.3 (ceiling = min(base·factor^(k-1), max), full jitter) | Satisfied |
| R5 | Dead-letter after N | §4.3 (`attempts >= maxRetries` → dead) | Satisfied |
| R6 | Checkpoint & resume | §4.5 / §4.7 (txn commit + checkpoint; recover in_progress) | Satisfied |
| R7 | Last-write-wins conflict | §4.4 (greater mtime; tie → greater hash) | Satisfied |
| R8 | Batch sizing & flush | §4.5 (size OR age; final partial flush) | Satisfied |
| R9 | FIFO order | §4.6 (`ORDER BY discovered_at ASC, id ASC`) | Satisfied |
| R10 | Soft delete & purge | §4.8 (set `deleted_at`; purge after retention) | Satisfied |
| R11 | Exit codes & shutdown | §4.9 (EXIT_CODES; dead-letter abort; signal drain) | Satisfied |
| R12 | Structured logging | §4.10 (NDJSON ts/level/event/msg; debug gated) | Satisfied |

Data model (§3) covers the manifest/checkpoint schema, the `Status` enum, and the two indexes the
requirements imply. No requirement is unsatisfied, overbuilt, or contradicted **at the architecture level**.
The defects are all between the docs and the *code* (Section 3).

### 2. Architecture -> Delivery Plan

The `IMPLEMENTATION_PLAN.md` builds the architecture coherently: bottom-up phases (types → config → logger →
db → stages → ingestor → CLI), each gated on `npm run verify`, with per-phase unit checks and an acceptance
battery (A2/A4/A5/A6/A8) mapped to phases 5/6/8/9. No missing tasks or risky sequencing at the plan level.

One naming inconsistency that the plan inherits from the architecture and the code then contradicts:

- Plan Phase 4 and ARCHITECTURE §4.4 both name a `resolveConflict` routine on the scanner. The code ships a
  differently-named function (`candidateWins`) and never calls it (detail in Section 3, item 10). So the plan
  references a component the code does not actually have under that name or in that wiring.

The plan's Phase 6/7/9 "Check" lines also encode the *correct* (doc) behavior that the code violates — those
are surfaced as code drift below.

### 3. Delivery/Status -> Code

Every concrete doc-vs-code (or doc-vs-doc) inconsistency found, as a checkable numbered list:

1. **DRIFT:** `batchSize` default = **64** (PRD §5 line 87; CONTEXT.md line 16; README.md line 55;
   `ingestd.config.example.json` line 4) **vs** `batchSize: 128` in code (`src/config.ts:9`,
   `DEFAULT_CONFIG`).

2. **DRIFT:** `backoffBaseMs` default = **200** (PRD §5 line 91; CONTEXT.md line 19; README.md line 59;
   `ingestd.config.example.json`; ARCHITECTURE §4.3 line 77; `src/retry.ts` comment lines 7-9) **vs**
   `backoffBaseMs: 500` in code (`src/config.ts:13`).

3. **DRIFT:** Un-jittered backoff ceiling sequence stated as **"200, 400, 800, 1600, 3200 ms"** (CONTEXT.md
   line 26; PRD R4 line 55; ARCHITECTURE §4.3 line 77) **vs** the actual sequence with the code's default
   base of 500 = **500, 1000, 2000, 4000, 8000 ms** (`src/config.ts:13` feeding `src/retry.ts:10-13`).

4. **DRIFT:** Config validation rule is **"`flushIntervalMs <= pollIntervalMs`"** (PRD §5 line 98) **vs**
   `src/config.ts:57` which throws when `c.flushIntervalMs < c.pollIntervalMs` — the comparison is inverted
   (it actually requires `flushIntervalMs >= pollIntervalMs`). The error string even says "must be <=" while
   enforcing the opposite. Consequence: the shipped defaults (`flushIntervalMs 2000`, `pollIntervalMs 5000`)
   make `2000 < 5000` true, so `loadConfig` throws `ConfigError` on the default config and the example config.

5. **DRIFT:** Dedup window is in **hours** — `now - dedupWindowHours*3600_000` (ARCHITECTURE §4.1 line 71;
   PRD R2 line 49 "default 24 hours") **vs** `src/dedup.ts:31` `const cutoff = now - dedupWindowHours * 60_000`
   (60_000 ms = 1 **minute**). With `dedupWindowHours: 24` the effective window is ~24 **minutes**. Breaks
   acceptance A2 ("re-ingesting an identical file within 24h yields a dedup hit"). Note `src/scanner.ts:112`
   correctly uses `* 3600_000` for retention, so the units are inconsistent even within the code.

6. **DRIFT:** Retry uses **full jitter, uniform in `[0, ceiling]`** (PRD R4 line 55; ARCHITECTURE §4.3 line 77
   `Math.floor(Math.random()*(ceiling+1))`; CONTEXT.md line 26) **vs** `src/retry.ts:16-19` `nextDelayMs`
   which returns the ceiling unchanged — **no jitter is applied** (the function body contradicts its own
   docstring on line 15).

7. **DRIFT:** Dead-letter trigger is **`attempts >= maxRetries`** (PRD R5 line 58 "attempts reaches 5";
   ARCHITECTURE §4.3 line 77; CONTEXT.md line 29 "attempts ≥ 5"; PLAN Phase 6) **vs** `src/retry.ts:24`
   `return attempts > maxRetries`. With `maxRetries = 5` the code dead-letters only after **6** attempts.
   Breaks acceptance A5 ("lands in `dead` after exactly 5 attempts").

8. **DRIFT:** FIFO dequeue order is **`ORDER BY discovered_at ASC, id ASC`** (PRD R9 line 70;
   ARCHITECTURE §4.6 line 86; CONTEXT.md line 38) **vs** `src/ingestor.ts:85` `ORDER BY discovered_at DESC,
   id DESC` — the queue is processed **LIFO**, the reverse of the requirement.

9. **DRIFT:** Conflict resolution is **last-write-wins: greater `mtime_ms` wins** (PRD R7 line 64;
   ARCHITECTURE §4.4 line 80; CONTEXT.md line 39) **vs** `src/scanner.ts:47-49` `candidateWins`, which returns
   `candidate.mtime_ms < existing.mtime_ms` — it favors the **smaller/older** mtime (first-write-wins).
   Direction is inverted (the tie-break on greater `content_hash`, line 52, is correct).

10. **DRIFT:** ARCHITECTURE §4.4 line 80 and PLAN Phase 4 name `scanner.ts#resolveConflict(existing,
    candidate)` and say it is invoked on a changed path **vs** the code: the function is named `candidateWins`
    (`src/scanner.ts:43`) and is **never called** by `upsertCandidate` (or anywhere). `upsertCandidate`
    (`src/scanner.ts:59-89`) unconditionally overwrites on any mtime/size change, so R7's last-write-wins guard
    is not actually enforced in the write path regardless of item 9.

11. **DRIFT:** Pool admits **at most `concurrency` (4)** in flight ("never start a new task while concurrency
    tasks are already running", PRD R3 line 52; ARCHITECTURE §4.2 line 74 "Exactly concurrency (4)…"; PLAN
    Phase 7 "peak in-flight never exceeds 4") **vs** `src/pool.ts:22` `if (this.inFlight <= this.concurrency)`
    — an off-by-one that admits while `inFlight == concurrency`, allowing **`concurrency + 1` = 5** in flight.

12. **DRIFT:** Startup recovery rewinds **only `in_progress`** rows ("the only place `in_progress` rows are
    rewound", ARCHITECTURE §4.7 line 89 `WHERE status='in_progress'`; PRD R6 line 61; CONTEXT.md line 29)
    **vs** `src/ingestor.ts:48` `WHERE status IN ('in_progress', 'done')`. Recovery also rewinds **`done`**
    rows to `pending`, so every restart reprocesses already-committed work — directly violating R6 ("no
    committed work is repeated") and breaking acceptance A6. (The log message line 52 still says "rewound N
    in_progress rows," compounding the drift.)

13. **DRIFT:** Soft delete **sets `deleted_at` and retains the row** (PRD R10 line 73; ARCHITECTURE §4.8 line
    92 `UPDATE manifest SET deleted_at=…`; CONTEXT.md line 40 "Soft delete sets `deleted_at`") **vs**
    `src/scanner.ts:97-98` `softDeleteMissing`, which runs `DELETE FROM manifest WHERE path = ? AND deleted_at
    IS NULL` — a **hard delete**. No tombstone is ever written, so retention/purge (R10) has nothing to act on.

14. **DRIFT:** CONTEXT.md line 11 declares `src/config.ts#DEFAULT_CONFIG` the "source of truth" and line 47
    states "Clean baseline; all docs match code" **vs** the code: the CONTEXT table itself disagrees with
    `DEFAULT_CONFIG` (items 1, 2) and at least a dozen behavioral drifts exist. The status claim is false.

15. **DRIFT:** PLAN Phase 6 check "`shouldDeadLetter(attempts, maxRetries) = attempts >= maxRetries`" and
    "ceilings for attempts 1..5 are 200/400/800/1600/3200 with defaults" (IMPLEMENTATION_PLAN.md lines 30-31)
    **vs** code `src/retry.ts:24` (`>`, item 7) and `src/config.ts:13` (base 500, item 3). PLAN Phase 7 check
    "peak in-flight never exceeds 4" **vs** `src/pool.ts:22` (item 11). The plan's own acceptance checks would
    fail against the shipped code.

16. **DRIFT (code-internal):** `src/retry.ts` comment lines 7-9 state "With defaults (base 200, factor 2, max
    30000) the ceilings for attempts 1..5 are 200, 400, 800, 1600, 3200 ms" **vs** `DEFAULT_CONFIG.backoffBaseMs
    = 500` (`src/config.ts:13`). The comment describes a base the code no longer uses.

Items verified as **consistent** (no drift): `Status` enum members (`src/types.ts:3-16` vs ARCHITECTURE §3.3 /
PRD); `EXIT_CODES` values 0-4 (`src/types.ts:21-27` vs PRD R11 / ARCHITECTURE §4.9 / README); manifest &
checkpoint DDL and both indexes (`src/db.ts:6-35` vs ARCHITECTURE §3); CLI commands/flags and defaults
(`src/cli.ts` vs README/PLAN); batch flush-on-size-or-age and atomic txn + checkpoint logic (`src/batch.ts`);
dead-letter abort comparison `> threshold` (`src/ingestor.ts:210`); retention purge unit `*3600_000`
(`src/scanner.ts:112`); WAL mode (`src/db.ts:41`); SHA-256 streamed in 64 KiB chunks → lowercase hex
(`src/dedup.ts`); library exports cover README's usage (`src/index.ts`).

### 4. Verdict

**SIGNIFICANT DRIFT.**

The documentation set (PRD → Architecture → Plan) is coherent and complete, but the code has diverged from it
in ~16 concrete, checkable places, several of which are behavior-breaking and falsify stated acceptance
criteria. Most important first:

1. **Recovery rewinds `done` rows** (item 12) — every restart reprocesses committed work. Breaks the central
   crash-safety guarantee (R6/A6); arguably the most damaging defect.
2. **Default config fails its own validation** (item 4, inverted comparison) — `loadConfig` throws on the
   shipped defaults and the example config, so the tool does not start out of the box.
3. **Soft delete is a hard delete** (item 13) — destroys the tombstone/retention model (R10) and any audit of
   removed files.
4. **Dedup window is minutes, not hours** (item 5) and **dead-letter fires at 6 attempts, not 5** (item 7) —
   break acceptance A2 and A5 respectively.
5. **FIFO is actually LIFO** (item 8) and **conflict resolution is inverted and unwired** (items 9, 10) —
   ordering and last-write-wins guarantees (R9/R7) are not delivered.
6. **No retry jitter** (item 6) and **concurrency cap off-by-one (5 not 4)** (item 11) — bounded-resource and
   thundering-herd protections (R3/R4) are weaker than specified.
7. **Default constants drift** (items 1, 2, 3) and **CONTEXT's "all docs match code" is false** (item 14) —
   the documented numbers and status claim cannot be trusted as-is.

Recommend treating the docs as the intended spec and correcting the code (or, where a default was
intentionally changed, updating every doc + the example config in lockstep and re-baselining CONTEXT.md).

---

**Open Questions:** none blocking — this is a report-only review.

**Verification Evidence:** Static cross-read of all listed artifacts against `src/`. Tests were not run
(`npm run verify` is type-check only; no unit tests are present in the workspace, and the task scope is
doc/code drift, not execution). Line citations above are the evidence.

**Residual Risk:** Drift counts may undercount: there are no shipped unit tests to confirm runtime behavior,
so items 4, 5, 7, 8, 11, 12 are asserted from code reading. If a hidden test suite exists outside this
workspace it was not consulted.
