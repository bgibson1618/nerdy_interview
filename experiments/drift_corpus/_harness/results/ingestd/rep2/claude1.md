# ingestd — Independent Coherence / Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

Fresh-eyes review of the project on disk in this workspace. Scope: `CONTEXT.md`,
`PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `src/*`, plus
`ingestd.config.example.json`, `package.json`, `tsconfig.json`. No code or docs were
modified — report only.

Headline: the three top-level docs (PRD → ARCH → PLAN) are mutually coherent and the
architecture satisfies the PRD. **The drift is overwhelmingly doc/status ↔ code.** The
code violates a large number of specific, checkable contracts, and `CONTEXT.md`'s "all
docs match code / verify green" status claim is false. Several drifts are correctness
bugs that would fail the PRD's own acceptance battery and, in one case, prevent the
program from even starting with its documented default config.

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement. Mapping (all **addressed**):

| PRD Req | Covered by ARCH | Notes |
|---------|-----------------|-------|
| R1 Source scan & discovery | §2 Scanner, §3.1 manifest, Plan Ph4 | mtime+size change detection, no symlink follow — specified. |
| R2 Content-hash dedup | §4.1 | SHA-256 streamed 64 KiB, live `done` rows, window check — specified. |
| R3 Bounded concurrency | §4.2 | "Exactly concurrency (4) at once", FIFO admission — specified. |
| R4 Retry + backoff | §4.3 | ceiling math + full jitter `floor(random*(ceiling+1))` — specified. |
| R5 Dead-letter after N | §4.3 | `attempts >= maxRetries` → dead — specified. |
| R6 Checkpoint & resume | §4.5, §4.7, §3.2 | one txn per batch; `in_progress`→`pending` on recovery — specified. |
| R7 Last-write-wins | §4.4 | greater `mtime_ms` wins, tiebreak greater hash — specified. |
| R8 Batch sizing & flush | §4.5 | size-or-age flush, final partial force-flush — specified. |
| R9 FIFO order | §4.6 | `ORDER BY discovered_at ASC, id ASC` — specified. |
| R10 Soft delete & purge | §4.8 | set `deleted_at`; hard purge after `retentionHours` — specified. |
| R11 Exit codes & shutdown | §4.9 | EXIT_CODES map, dead-letter abort, signal handling — specified. |
| R12 Structured logging | §4.10 | NDJSON when json; ts/level/event/msg; debug gated — specified. |

Nothing in the architecture is unsatisfied, overbuilt, or contradictory **relative to the
PRD**. The PRD's config table (§5) and the ARCH data model (§3) agree on defaults and on
the schema. This layer is clean.

### 2. Architecture -> Delivery Plan

The plan builds the architecture bottom-up (types → config → logger → db → stages →
ingestor → CLI), each phase mapped to requirements and acceptance checks (A2/A4/A5/A6/A8).
Coverage is coherent and complete; every architecture module has a corresponding phase.

Minor notes (not blocking at this layer, but they become real once code is compared):
- The plan (Phase 4) and ARCH §4.4 name the conflict-resolution function
  `resolveConflict`. The code instead exports `candidateWins` (see §3, item 12). The plan
  thus references a symbol the code does not provide under that name.
- Plan Phase 1 asserts "defaults round-trip" and Phase 7 asserts "peak in-flight never
  exceeds 4" — both are good acceptance checks, but the code fails them (§3 items 3 and 9).
  The plan itself is sound; the code diverged from it.

The plan is internally consistent with the architecture. No missing tasks or risky
sequencing at the plan level.

### 3. Delivery/Status -> Code

Every concrete doc-claim ↔ code inconsistency found, as a numbered list. Each can be
checked individually.

1. **DRIFT:** `batchSize` default = **64** (PRD §5 table; CONTEXT "Canonical constants";
   README "Defaults at a glance"; `ingestd.config.example.json:4`) vs code
   `DEFAULT_CONFIG.batchSize = 128` (`src/config.ts:9`). CONTEXT names
   `src/config.ts#DEFAULT_CONFIG` as the source of truth, yet that file disagrees with
   CONTEXT's own table.

2. **DRIFT:** `backoffBaseMs` default = **200** (PRD §5; PRD R4 "Defaults: backoffBaseMs =
   200"; CONTEXT; README; example config `:7`) vs code `DEFAULT_CONFIG.backoffBaseMs = 500`
   (`src/config.ts:13`). This also invalidates the documented ceiling sequence: PRD R4 /
   ARCH §4.3 / CONTEXT all state ceilings 200/400/800/1600/3200 ms, but with base 500 the
   actual ceilings are 500/1000/2000/4000/8000 ms.

3. **DRIFT:** Config validation comparison is inverted. PRD §5 requires
   `flushIntervalMs <= pollIntervalMs`; code throws on `flushIntervalMs < pollIntervalMs`
   (`src/config.ts:57`), i.e. it *requires* flush ≥ poll. The error string even says
   "flushIntervalMs must be <= pollIntervalMs" while the check enforces the opposite.
   Consequence: the documented defaults (flush 2000, poll 5000) and the shipped
   `ingestd.config.example.json` (same values) **fail validation and abort with exit 2** —
   the worker cannot start with its own documented defaults. Contradicts Plan Phase 1
   "defaults round-trip."

4. **DRIFT:** Backoff applies **no jitter**. PRD R4 and ARCH §4.3 specify full jitter —
   `Math.floor(Math.random() * (ceiling + 1))`, uniform in `[0, ceiling]`. Code
   `nextDelayMs` returns the ceiling unchanged (`src/retry.ts:16-19`); its own comment
   "Full jitter: the actual delay is uniform in [0, ceiling]" is contradicted by the body.

5. **DRIFT:** Dead-letter threshold is off by one. PRD R5 ("after `maxRetries` … i.e.
   `attempts` reaches 5"), ARCH §4.3 (`attempts >= maxRetries`), and Plan Phase 6
   (`attempts >= maxRetries`) all use `>=`. Code `shouldDeadLetter` returns
   `attempts > maxRetries` (`src/retry.ts:24`). With `maxRetries=5` the task dead-letters
   at **attempt 6**, not 5. Directly fails acceptance A5 ("lands in `dead` after exactly 5
   attempts"). The function's own comment says `attempts >= maxRetries`, contradicting its
   body.

6. **DRIFT:** Dedup window uses the wrong time unit. ARCH §4.1 and Plan Phase 5 specify
   `updated_at >= now - dedupWindowHours*3600_000` (hours). Code computes
   `cutoff = now - dedupWindowHours * 60_000` (`src/dedup.ts:31`) — that is **minutes**,
   so the effective window is 60× too small (default 24 → ~24 minutes, not 24 hours). The
   function comment "within the dedup window (now - dedupWindowHours hours)" is
   contradicted. Fails acceptance A2 ("re-ingesting an identical file within 24h yields a
   dedup hit").

7. **DRIFT:** Startup recovery rewinds committed work. PRD R6, ARCH §4.7 ("the only place
   `in_progress` rows are rewound", SQL `WHERE status='in_progress'`), and CONTEXT
   ("`in_progress` is rewound to `pending` on startup recovery") all restrict recovery to
   `in_progress`. Code runs `... WHERE status IN ('in_progress', 'done')`
   (`src/ingestor.ts:48-50`), so **every `done` row is reset to `pending` and reprocessed
   on each restart** — violates R6 "no committed work is repeated" and fails acceptance A6.
   The log message still says "rewound N in_progress rows," masking the behavior.

8. **DRIFT:** Dequeue order is reversed. PRD R9 and ARCH §4.6 specify FIFO
   `ORDER BY discovered_at ASC, id ASC`. Code uses
   `ORDER BY discovered_at DESC, id DESC` (`src/ingestor.ts:85`) — LIFO / newest-first.
   The method's own comment ("oldest discovered_at first, id ascending tiebreak",
   `src/ingestor.ts:79`) contradicts the SQL.

9. **DRIFT:** Concurrency cap is off by one. PRD R3 ("at most `concurrency` … never start
   a new task while `concurrency` tasks are already running") and ARCH §4.2 ("Exactly
   concurrency (4) tasks may run at once") specify a hard cap of 4. Code `acquire()` admits
   when `this.inFlight <= this.concurrency` (`src/pool.ts:22`); starting from 0 this lets
   `inFlight` reach **5** before blocking. Should be `<`. Fails Plan Phase 7 check ("peak
   in-flight never exceeds 4").

10. **DRIFT:** Conflict-resolution direction is inverted. PRD R7 and ARCH §4.4 say the
    **greater** `mtime_ms` wins (last-write-wins). Code `candidateWins` returns
    `candidate.mtime_ms < existing.mtime_ms` (`src/scanner.ts:47-48`) — the candidate wins
    only when it is **older**. (The tiebreak on greater `content_hash` at `:52` is correct.)

11. **DRIFT:** Last-write-wins conflict resolution is never actually applied. ARCH §4.4
    and Plan Phase 4 describe `resolveConflict`/`candidateWins` deciding whether a changed
    file replaces the row. But `upsertCandidate` (`src/scanner.ts:59-89`) never calls
    `candidateWins`; on any change it unconditionally overwrites `content_hash/size/mtime`
    and resets to `pending`. So the documented R7 behavior is dead code — discovery is
    effectively "most-recently-scanned wins" regardless of mtime.

12. **DRIFT (doc↔code symbol name):** ARCH §4.4 and Plan Phase 4 reference
    `scanner.ts#resolveConflict`. No such symbol exists; the code exports `candidateWins`
    (`src/scanner.ts:43`). A reader following the docs will not find the named function.

13. **DRIFT:** "Soft delete" is implemented as a **hard delete**. PRD R10, ARCH §4.8
    (`UPDATE manifest SET deleted_at=? …`), and CONTEXT ("Soft delete sets `deleted_at`;
    hard purge after retentionHours") all require setting the `deleted_at` tombstone and
    retaining the row. Code `softDeleteMissing` runs
    `DELETE FROM manifest WHERE path = ? AND deleted_at IS NULL` (`src/scanner.ts:97-99`),
    physically removing the row. The function name and its comment ("Only live rows are
    tombstoned") contradict the body, the `now` parameter is unused, and the
    `retentionHours` purge (`purgeExpired`) can never act on missing files because no
    tombstone is ever written.

14. **DRIFT:** The `scan` command processes the queue. README (`:28-29`) and Plan Phase 10
    describe `scan` as "Scan sources and enqueue, but do not process." Code's `scan` case
    calls `ingestor.runOnce()` (`src/cli.ts:88-92`), which scans **and** dequeues,
    processes through the pool, and commits — identical to `run --once`.

15. **DRIFT (stale status claim):** CONTEXT `Status` says "Clean baseline; all docs match
    code. `npm run verify` green." (`CONTEXT.md:46-47`). This is false: items 1–14 are
    live doc↔code mismatches. Relatedly, CONTEXT's "Canonical constants (source of truth:
    `src/config.ts#DEFAULT_CONFIG`)" table lists batchSize 64 / backoffBaseMs 200, which
    the cited file does not contain (128 / 500).

Items checked and found **consistent** (no drift): EXIT_CODES values (`types.ts:21-27` ↔
ARCH §4.9 ↔ README ↔ PRD R11); `Status` union/lifecycle (`types.ts:3-16` ↔ ARCH §3.3);
manifest & checkpoint schema incl. indexes (`db.ts:6-34` ↔ ARCH §3.1/3.2); WAL pragma;
dedup SHA-256 + 64 KiB chunk streaming and live/`done` predicate (`dedup.ts` ↔ ARCH §4.1,
aside from item 6); batch flush size-or-age + atomic manifest+checkpoint txn + final
force-flush (`batch.ts` ↔ ARCH §4.5); CLI command set and global flags
(`cli.ts` ↔ README/Plan Ph10); `requeueDead` resets attempts→0/status→pending (R5);
`purgeExpired` cutoff math `retentionHours*3600_000` (ARCH §4.8); library exports include
the documented surface (`index.ts`). `package.json` version 0.4.0 is not asserted by any
doc, so it is not a drift. (`db.ts:42` enables `foreign_keys = ON`, which no doc mentions,
but it is benign and non-contradictory.)

### 4. Verdict

**SIGNIFICANT DRIFT.**

Docs↔docs (PRD→ARCH→PLAN) are coherent; the failure is entirely doc/status ↔ code, and it
is broad (15 findings spanning 6 of the 12 source modules) and severe (multiple
correctness bugs, not cosmetic mismatches). Most important issues first:

1. **The worker cannot start with its documented defaults** — inverted config check (#3)
   rejects the default and example configs (flush 2000 < poll 5000) with exit 2. This
   also makes CONTEXT's "verify green / clean baseline" claim (#15) untrue at runtime.
2. **Crash-resume reprocesses all committed work** — recovery rewinds `done` rows (#7),
   directly violating the core R6 crash-safety/idempotency guarantee and failing A6.
3. **Dedup window is 60× too narrow** — minutes instead of hours (#6), failing A2; the
   product's headline "content-addressed dedup" silently stops deduping after minutes.
4. **Soft delete is a hard delete** (#13) — tombstones/retention (R10) do not exist in
   practice; deleted files are unrecoverable and `retentionHours` is inert.
5. **FIFO is actually LIFO** (#8) and **concurrency cap is 5 not 4** (#9) — both contradict
   P0 requirements R9/R3 and the plan's acceptance checks.
6. **Retry semantics wrong**: no jitter (#4) and dead-letter at attempt 6 not 5 (#5),
   failing A5.
7. **Conflict resolution (R7) is both inverted and unused** (#10, #11) and the docs name a
   function that doesn't exist (#12).
8. **Default-value drift** (#1 batchSize 128 vs 64, #2 backoffBaseMs 500 vs 200) and the
   `scan` command silently processing instead of only enqueuing (#14).

Recommendation: treat CONTEXT's "clean baseline, all docs match code" as stale and block
any "done" call until items #3, #6, #7, #13 (the runtime/correctness breakers) are
resolved or explicitly accepted with rationale; items #1–#2, #4–#5, #8–#12, #14 should
follow.

---

*Residual risk:* I did not execute `npm run verify`/`npm test` (no install performed in
this read-only review); findings are from static reading of docs and source. All are
type-level/logic mismatches that do not depend on runtime, except #3 whose runtime effect
(exit 2 on default config) I inferred from the comparison and the documented defaults — it
is worth a one-line manual confirmation. No `tests/` directory was present in the
workspace to cross-check against.
