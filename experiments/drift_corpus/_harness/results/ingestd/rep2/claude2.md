# Fresh-Eyes Drift Review — `ingestd`

Reviewer: verifier (independent, no prior context). Scope: `CONTEXT.md`, `PRD.md`,
`ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `ingestd.config.example.json`,
`package.json`, and all of `src/`. Read-only review; nothing was modified.

```text
VERDICT: FAIL
DIMENSIONS:
  - Brief→Architecture: PASS
  - Architecture→Plan: PASS
  - Status/Docs→Code: FAIL
BLOCKING:
  - src/config.ts: DEFAULT_CONFIG batchSize=128 / backoffBaseMs=500 contradict every doc (all say 64 / 200)
  - src/config.ts: flushIntervalMs validation comparison inverted — rejects the documented default config
  - src/dedup.ts: dedup window scaled by 60_000 (minutes), not 3600_000 (hours) — 24h window becomes 24min
  - src/retry.ts: nextDelayMs applies NO jitter; shouldDeadLetter uses `>` not `>=` (6 tries, not 5)
  - src/pool.ts: acquire uses `<=` — allows concurrency+1 (5) tasks in flight, not a hard 4
  - src/ingestor.ts: recover() rewinds `done` rows too — reprocesses committed work on every restart (breaks R6)
  - src/ingestor.ts: dequeue ORDER BY ... DESC — LIFO, not the documented FIFO (R9)
  - src/scanner.ts: softDeleteMissing hard-DELETEs rows instead of setting deleted_at (breaks R10/retention)
  - src/scanner.ts: candidateWins inverts last-write-wins (older mtime wins) and is never even called (R7)
  - CONTEXT.md: "all docs match code … verify green" is false — at least 12 concrete drifts below
RIGOR: tuned
```

---

### 1. Source Brief -> Architecture

The architecture satisfies the PRD requirements at the design level. Each PRD requirement maps
to a named module and a behavioral contract, and the data model covers the durable state.

| PRD Req | Addressed in ARCHITECTURE | Status |
|--------|----------------------------|--------|
| R1 Source scan & discovery | §2 Scanner, §4 (walk, mtime/size skip, no symlink) | Addressed |
| R2 Content-hash dedup | §4.1 (SHA-256, 64 KiB, live `done`, window) | Addressed |
| R3 Bounded concurrency | §4.2 ("exactly concurrency (4) at once") | Addressed |
| R4 Retry + backoff | §4.3 (ceiling formula + full jitter) | Addressed |
| R5 Dead-letter after N | §4.3 (`attempts >= maxRetries`) | Addressed |
| R6 Checkpoint & resume | §3.2, §4.5, §4.7 (txn commit + in_progress rewind) | Addressed |
| R7 Last-write-wins | §4.4 (greater mtime, hash tiebreak) | Addressed |
| R8 Batch sizing & flush | §4.5 (size OR age, final partial) | Addressed |
| R9 FIFO order | §4.6 (`discovered_at ASC, id ASC`) | Addressed |
| R10 Soft delete & purge | §4.8 (set `deleted_at`, hard-delete on retention) | Addressed |
| R11 Exit codes & shutdown | §4.9 (EXIT_CODES, dead-letter abort, signals) | Addressed |
| R12 Structured logging | §4.10 (NDJSON, debug gated on verbose) | Addressed |

No requirement is unsatisfied, overbuilt, or contradicted **at the architecture layer**. The
architecture is internally consistent with the PRD. (All failures below are code-vs-doc, not
brief-vs-architecture.) One small spec gap, not a contradiction: PRD §5 says `flushIntervalMs <=
pollIntervalMs`; the architecture never restates this, so the inverted code check in §3 has no
architecture-level guard to catch it.

### 2. Architecture -> Delivery Plan

The plan builds the architecture coherently and bottom-up (types → config → logger → db →
stages → ingestor → cli), with a per-phase `npm run verify` gate and acceptance checks (A2/A4/
A5/A6/A8) mapped to phases. Module names, table names, and contracts in the plan match the
architecture. No missing tasks or risky sequencing at the plan level.

Two plan-vs-code naming/coverage notes (the plan is correct; the code drifted from it):

- Plan Phase 4 and ARCHITECTURE §4.4 both name the conflict function `resolveConflict`. The code
  ships it as `candidateWins` (`src/scanner.ts:43`) and never calls it (see §3 item 6).
- Plan Phase 6 specifies `shouldDeadLetter(attempts, maxRetries) = attempts >= maxRetries`. The
  code uses `>` (see §3 item 9), so the plan's own Phase-6 check and acceptance A5 would fail.

The plan does not reference any component the architecture/code lacks. The drift is entirely that
the code diverged from a coherent plan.

### 3. Delivery/Status -> Code

CONTEXT.md (line 47) asserts: *"Clean baseline; all docs match code. `npm run verify` green."*
That status claim is false. The following concrete, individually checkable inconsistencies exist.
Note several are *behavioral* drifts that `tsc --noEmit` (the only "verify") cannot catch, so a
green type-check does not substantiate "docs match code."

1. **DRIFT:** `batchSize` default = **64** in PRD §5 (PRD.md:87), CONTEXT canonical-constants table
   (CONTEXT.md:16), README "Defaults at a glance" (README.md:53), and ARCHITECTURE §4.5 — **vs**
   `DEFAULT_CONFIG.batchSize = 128` in `src/config.ts:9`. CONTEXT explicitly designates
   `src/config.ts#DEFAULT_CONFIG` the source of truth, yet it disagrees with the table that cites it.

2. **DRIFT:** `backoffBaseMs` default = **200** in PRD §5 (PRD.md:92), CONTEXT (CONTEXT.md:19),
   README (README.md:59), ARCHITECTURE §4.3, and `ingestd.config.example.json:8` — **vs**
   `DEFAULT_CONFIG.backoffBaseMs = 500` in `src/config.ts:13`. Consequently CONTEXT.md:26's stated
   ceiling sequence "200, 400, 800, 1600, 3200 ms" is wrong for the code default (it would be
   500/1000/2000/4000/8000).

3. **DRIFT:** PRD §5 (PRD.md:98) requires validation `flushIntervalMs <= pollIntervalMs` (reject when
   flush **>** poll) — **vs** `src/config.ts:57` which throws when `c.flushIntervalMs < c.pollIntervalMs`.
   The comparison is inverted: it rejects the *valid* case. With the documented defaults
   (flush 2000, poll 5000) and with `ingestd.config.example.json` (flush 2000, poll 5000),
   `loadConfig` throws `ConfigError` → exit 2. The shipped example config does not load.

4. **DRIFT:** R7 (PRD.md:64) / ARCHITECTURE §4.4 / CONTEXT.md:39 specify last-write-wins = **greater**
   `mtime_ms` wins — **vs** `src/scanner.ts:47-48`, where `candidateWins` returns
   `candidate.mtime_ms < existing.mtime_ms`, i.e. the **older** mtime wins. The conflict rule is inverted.

5. **DRIFT:** R10 (PRD.md:72) / ARCHITECTURE §4.8 / CONTEXT.md:40 specify a **soft** delete
   (`UPDATE manifest SET deleted_at=…`, row retained, purged later after `retentionHours`) — **vs**
   `src/scanner.ts:97-99` `softDeleteMissing`, which runs `DELETE FROM manifest WHERE path = ? AND
   deleted_at IS NULL` — a **hard** delete. Tombstones are never created; `purgeExpired`
   (`scanner.ts:111`) and the entire `retentionHours`/168h retention story become dead code, and
   "soft-deleted rows are excluded from scans and dedup" is moot.

6. **DRIFT:** ARCHITECTURE §4.4 and IMPLEMENTATION_PLAN Phase 4 reference `scanner.ts#resolveConflict`
   — **vs** the code, which (a) names it `candidateWins` (`src/scanner.ts:43`) and (b) **never calls
   it**. `upsertCandidate` (`scanner.ts:59-89`) unconditionally overwrites on any mtime/size change,
   so R7 last-write-wins is not actually enforced in the scan path regardless of item 4.

7. **DRIFT:** ARCHITECTURE §4.1 specifies the dedup cutoff `now - dedupWindowHours*3600_000` (hours →
   ms) — **vs** `src/dedup.ts:31` `const cutoff = now - dedupWindowHours * 60_000;`. `60_000` is
   ms-per-**minute**, so the default 24-**hour** window is actually 24 **minutes**. Acceptance A2
   ("re-ingesting an identical file within 24h yields a dedup hit") fails for hits 25 min–24 h old.

8. **DRIFT:** R4 (PRD.md:55) / ARCHITECTURE §4.3 / CONTEXT.md:26 require **full jitter** — actual delay
   uniform in `[0, ceiling]` via `Math.floor(Math.random() * (ceiling + 1))` — **vs** `src/retry.ts:16-19`
   `nextDelayMs`, which returns the **ceiling** unchanged. No jitter is applied; the doc'd
   `Math.random()` jitter is absent.

9. **DRIFT:** R5 (PRD.md:58) / ARCHITECTURE §4.3 / IMPLEMENTATION_PLAN Phase 6 define dead-letter as
   `attempts >= maxRetries` (dead at attempts = 5) — **vs** `src/retry.ts:24`
   `return attempts > maxRetries;` (dead only at attempts = 6). Tasks get **6** tries, not 5;
   acceptance A5 ("dead after exactly 5 attempts") fails.

10. **DRIFT:** R3 (PRD.md:52) / ARCHITECTURE §4.2 ("exactly concurrency (4) at once") / CONTEXT.md:36
    ("hard 4 in-flight") — **vs** `src/pool.ts:22` `if (this.inFlight <= this.concurrency)`. The `<=`
    lets `inFlight` reach `concurrency + 1` (5 with the default). Peak concurrency is 5, not a hard 4;
    IMPLEMENTATION_PLAN Phase 7's "peak in-flight never exceeds 4" check fails.

11. **DRIFT:** R6 (PRD.md:61) / ARCHITECTURE §4.7 ("the **only** place `in_progress` rows are rewound")
    / CONTEXT.md:29 say startup recovery rewinds **only** `in_progress` — **vs** `src/ingestor.ts:48`
    `... WHERE status IN ('in_progress', 'done')`. Recovery also resets every **committed `done`** row
    to `pending`, so all previously-completed work is reprocessed on every restart — a direct
    violation of "no committed item reprocessed" (R6, acceptance A6). The adjacent comment
    (`ingestor.ts:42-43`) and log message (`ingestor.ts:52`, "rewound N in_progress rows") still
    claim in_progress-only, so the code contradicts itself.

12. **DRIFT:** R9 (PRD.md:70) / ARCHITECTURE §4.6 / CONTEXT.md:38 specify FIFO dequeue
    `ORDER BY discovered_at ASC, id ASC` — **vs** `src/ingestor.ts:85`
    `ORDER BY discovered_at DESC, id DESC`. This is **LIFO** (newest first). It also contradicts the
    function's own comment one line above (`ingestor.ts:79`, "oldest discovered_at first, id ascending
    tiebreak") and defeats the purpose of `idx_manifest_status_order`.

13. **DRIFT (lifecycle modeling):** ARCHITECTURE §3.3 / CONTEXT.md:29 document a status machine with
    `failed → pending` (retry) and `failed → dead` transitions, implying `failed` is persisted between
    attempts — **vs** the code, which performs the entire retry loop in-memory inside
    `processRow` (`src/ingestor.ts:121-140`) and only ever persists `done` or `dead`. The `failed`
    status (in `Status`/`STATUSES`, `types.ts:7,14`) is never written, and `summary.failed` is never
    incremented for a real `failed` row. The documented `failed → pending` retry transition does not
    occur in code.

14. **DRIFT (minor):** README.md:38 describes `--json` as "structured NDJSON logs **to stdout**" —
    **vs** `src/logger.ts:30,38`, which routes `warn`/`error` records to **stderr** and only
    info/debug to stdout. (PRD R12 does not constrain the stream, so this is a README-only overclaim.)

Items that are **consistent** (checked, no drift): exit-code map (`types.ts:21-27` vs PRD R11/ARCH
§4.9); `Status` enum members (`types.ts:3-16`); `manifest`/`checkpoint` schema and the two indexes
(`db.ts:6-35` vs ARCH §3.1/§3.2); WAL pragma; CLI commands/flags and their defaults
(`cli.ts` vs README/Plan Phase 10); `requeueDead` reset semantics (`ingestor.ts:225-232` vs R5);
batch flush "size OR age, final partial" structure (`batch.ts`); single-transaction
manifest+checkpoint commit (`batch.ts:39-46`); SHA-256 64 KiB streaming hash (`dedup.ts:5-19`);
dead-letter abort `> threshold` (`ingestor.ts:210` vs ARCH §4.9); placeholder secret
`FAKE_DEMO_SECRET` (`ingestd.config.example.json:14`). `package.json` version is `0.4.0`; no doc
pins a version, so that is not a drift.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The architecture and plan are coherent with the PRD; the damage is concentrated in the code, which
has quietly violated the documented contracts in at least 12 concrete, behavioral ways while
CONTEXT.md still advertises a "clean baseline; all docs match code." Because the only "verify" is
`tsc --noEmit`, a green type-check masks all of it.

Most important issues, in order:

1. **Crash-safety is broken (item 11).** `recover()` resets `done` rows to `pending`, so every
   restart reprocesses all previously committed work — the exact opposite of the R6 resume guarantee
   and acceptance A6. Highest-impact correctness defect.
2. **The shipped example config will not load (item 3).** The inverted `flushIntervalMs` check
   rejects the documented defaults, so `ingestd run` against `ingestd.config.example.json` exits 2.
   This is an out-of-the-box blocker.
3. **Dedup window is 24 minutes, not 24 hours (item 7).** Silent data-correctness drift: near-duplicate
   files re-ingest far sooner than promised; A2 fails.
4. **FIFO is actually LIFO (item 12)** and **last-write-wins is inverted and unwired (items 4, 6)** —
   ordering and conflict-resolution guarantees (R9/R7) are both wrong.
5. **Retry/concurrency math is off:** no jitter (item 8), 6 attempts instead of 5 (item 9), and up to
   5 concurrent tasks instead of a hard 4 (item 10) — each contradicts a P0 requirement and a named
   acceptance/plan check.
6. **Soft delete is a hard delete (item 5)**, nullifying tombstones, retention/purge, and the
   `retentionHours` config entirely.
7. **Config defaults drift (items 1, 2)** even against CONTEXT's own designated source of truth,
   invalidating the documented default-derived constants (e.g. the backoff ceiling table).

Recommendation: do not treat this as a clean baseline. The CONTEXT/README status claims should be
retracted until the code is reconciled with the PRD/ARCHITECTURE contracts and a real behavioral
test battery (A2/A4/A5/A6/A8 plus FIFO, concurrency cap, soft-delete, and recover scope) is run —
type-checking alone cannot catch any of the items above.

---

#### Verification Evidence
- Read every file under `src/` plus all five docs, `ingestd.config.example.json`, and `package.json`.
- Drifts located by line: `config.ts:9,13,57`; `scanner.ts:43,47-48,59-89,97-99,111`; `dedup.ts:31`;
  `retry.ts:16-19,24`; `pool.ts:22`; `ingestor.ts:48,79,85`; `logger.ts:30,38`. Cross-checked against
  PRD R1–R12 / §5 / §6, ARCHITECTURE §3–§4, CONTEXT canonical-constants + invariants, and README tables.
- Did not run `npm run verify`/tests (read-only review; no install in this run dir). The defects in
  items 4,5,7,8,9,10,11,12 are behavioral and would not be surfaced by `tsc --noEmit` regardless.

#### Open Questions
- None blocking. (See `questions.md`: none required.)

#### Residual Risk
- A few drifts may be *intended* recent changes that the docs simply have not caught up to (e.g.
  config defaults). Either direction is reported; ground truth is "doc and code disagree," which holds
  regardless of which side is authoritative. The CONTEXT "source of truth = DEFAULT_CONFIG" line means
  items 1–2 are self-contradictory no matter the intent.
