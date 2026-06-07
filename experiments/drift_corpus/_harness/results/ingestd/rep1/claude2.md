# ingestd — Independent Drift / Coherence Review

```text
VERDICT: FAIL
DIMENSIONS:
  - source-brief-to-architecture: PASS
  - architecture-to-plan: PASS
  - delivery-status-to-code: FAIL
BLOCKING:
  - src/config.ts: default + example config FAIL validation (flush/poll check inverted) — `ingestd run` cannot start
  - src/ingestor.ts: recover() rewinds `done`→`pending`, reprocessing all committed work (breaks R6 crash-safety)
  - src/scanner.ts: "soft delete" hard-DELETEs rows; `deleted_at` tombstone never written (breaks R10 retention)
  - src/dedup.ts: dedup window uses *60_000 (minutes) not *3_600_000 (hours) — 24h window is really 24min
  - src/ingestor.ts: FIFO dequeue ORDER BY is DESC/DESC (LIFO), violating R9
  - CONTEXT.md: "Clean baseline; all docs match code" is false — ≥12 concrete drifts
RIGOR: tuned
```

Reviewed with fresh eyes, on-disk only: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, `ingestd.config.example.json`, `package.json`, and all
of `src/`. No tests exist (`find` returns none) so all evidence is by static reading; `npm run
verify` was not run in this sandbox.

---

### 1. Source Brief → Architecture

The architecture (`ARCHITECTURE.md`) faithfully covers every numbered PRD requirement. Mapping:

| PRD Req | Architecture coverage | Status |
|---------|----------------------|--------|
| R1 Source scan & discovery | §2 Scanner, §4 (walk/upsert, no-symlink, mtime+size skip) | Addressed |
| R2 Content-hash dedup | §4.1 (SHA-256, 64 KiB chunks, live+done+window) | Addressed |
| R3 Bounded concurrency | §4.2 ("Exactly concurrency (4) tasks may run at once") | Addressed |
| R4 Retry/backoff + jitter | §4.3 (ceiling formula + full jitter, ceilings 200…3200) | Addressed |
| R5 Dead-letter after N | §4.3 (`attempts >= maxRetries`), requeue note in PRD R5 | Addressed |
| R6 Checkpoint & resume | §4.5 (single txn), §4.7 (`in_progress`→`pending` only) | Addressed |
| R7 Last-write-wins | §4.4 (`resolveConflict`, greater mtime, hash tiebreak) | Addressed |
| R8 Batch sizing & flush | §4.5 (size OR age, final partial flush) | Addressed |
| R9 FIFO order | §4.6 (`ORDER BY discovered_at ASC, id ASC`) | Addressed |
| R10 Soft delete & purge | §4.8 (`SET deleted_at`, hard purge after retention) | Addressed |
| R11 Exit codes & shutdown | §4.9 (`EXIT_CODES`, dead-letter abort, signal→3) | Addressed |
| R12 Structured logging | §4.10 (NDJSON when json, debug gated by verbose) | Addressed |

Findings:
- The architecture is a correct, complete refinement of the PRD. Nothing is unsatisfied or
  contradicted at the brief→architecture layer. The drift all appears later, in the code.
- Minor under-spec: the PRD §5 configuration table does **not** list a `sinkToken` key, but the
  architecture's data/handler model implies a token (and `src/types.ts` + the example config add
  one). This is a doc gap, not a contradiction — see §3 item 16.
- Naming note that becomes a code drift later: §4.4 names the conflict function
  `scanner.ts#resolveConflict`, but the code exports it as `candidateWins` (see §3 item 8).

Verdict for this layer: **PASS** (architecture satisfies the brief).

---

### 2. Architecture → Delivery Plan

`IMPLEMENTATION_PLAN.md` builds the architecture bottom-up (types → config → logger → db →
stages → ingestor → CLI) with a per-phase verify gate and targeted unit checks. The plan is
internally coherent with the architecture and, where it states the contract, it states it
**correctly** — which is what makes the code drift detectable:

- Phase 1 requires "defaults round-trip" and `flushIntervalMs <= pollIntervalMs`. The code's
  validation is inverted and would reject the very defaults this check asserts (§3 item 11).
- Phase 5 specifies the dedup window as `* 3600000`. Code uses `* 60_000` (§3 item 5).
- Phase 6 specifies `shouldDeadLetter = attempts >= maxRetries` and ceilings 200/400/800/1600/3200.
  Code uses `>` and a base of 500 (§3 items 2, 4).
- Phase 7 asserts "peak in-flight never exceeds 4." The pool admits 5 (§3 item 12).
- Phase 4 specifies `resolveConflict` (last-write-wins by mtime). Code never calls its
  conflict function and the comparison is inverted (§3 items 7, 8).
- Phase 9 maps acceptance A4/A5/A6/A8; A5 ("dead after exactly 5 attempts"), A6 (no committed
  item reprocessed), and the FIFO check are all contradicted by current code.

Findings:
- No missing tasks or risky sequencing in the plan itself; the build order is sound.
- **Stale assumption risk:** the plan (and CONTEXT) assert every phase ends on a green verify and
  that acceptance A2/A4/A5/A6/A8 pass. `tsc --noEmit` would likely still pass (all drifts are
  type-correct), but the *behavioral* acceptance battery the plan claims is satisfied is not —
  multiple items would fail at runtime. The plan documents the right contract; the code diverged
  from it without the plan/CONTEXT being updated.
- The plan references no component the architecture/code lacks. (The reverse — code lacking what
  the plan promised — is the problem.)

Verdict for this layer: **PASS** for plan↔architecture coherence; the plan is the trustworthy
document and the code has silently outgrown/violated it.

---

### 3. Delivery/Status → Code

Every concrete doc-vs-code (or doc-vs-doc) inconsistency, as a numbered list. "Default" facts are
checked against `CONTEXT.md`, `PRD.md §5`, `README.md`, `ingestd.config.example.json`, and
`ARCHITECTURE.md`; behavior is checked against §4 of the architecture, PRD requirements, and the
plan.

1. **DRIFT (batchSize default):** `batchSize` default is **64** per PRD §5 (line 87), CONTEXT.md
   (line 16), README "Defaults at a glance" (line 56), `ingestd.config.example.json` (line 4), and
   ARCHITECTURE §4.5 (line 83) — vs **`batchSize: 128`** in `src/config.ts` `DEFAULT_CONFIG`
   (line 9).

2. **DRIFT (backoffBaseMs default):** `backoffBaseMs` default is **200** per PRD §5 (line 91),
   CONTEXT.md (line 19), README (line 59), example config (line 8), and ARCHITECTURE §4.3 — vs
   **`backoffBaseMs: 500`** in `src/config.ts` (line 13). This also breaks the documented
   un-jittered ceiling sequence: docs say 200/400/800/1600/3200 ms (PRD R4 line 55, CONTEXT line 26,
   ARCH §4.3 line 77); with base 500 the real sequence is 500/1000/2000/4000/8000 ms.

3. **DRIFT (retry jitter missing):** PRD R4 (line 55), ARCHITECTURE §4.3 (line 77,
   `Math.floor(Math.random() * (ceiling + 1))`), and CONTEXT.md (line 26, "full jitter applied over
   `[0, ceiling]`") all require **full jitter** — vs `src/retry.ts#nextDelayMs` (lines 16-19) which
   returns the bare `ceiling` with **no `Math.random`** anywhere in `src/` (grep confirms). The
   delay is deterministic, not jittered. The function's own comment (`retry.ts` line 15, "Full
   jitter: the actual delay is uniform in `[0, ceiling]`") contradicts its body.

4. **DRIFT (dead-letter off-by-one):** PRD R5 (line 58, "after … `maxRetries` (default 5) times —
   i.e. `attempts` reaches 5"), ARCHITECTURE §4.3 (line 77, `attempts >= maxRetries`), and
   IMPLEMENTATION_PLAN Phase 6 (line 30, `attempts >= maxRetries`) — vs
   `src/retry.ts#shouldDeadLetter` (line 24) returning **`attempts > maxRetries`**. An
   always-throwing handler dead-letters at `attempts = 6`, not 5, breaking PRD acceptance A5
   ("`dead` after exactly 5 attempts").

5. **DRIFT (dedup window unit):** ARCHITECTURE §4.1 (line 71, `now - dedupWindowHours*3600_000`) and
   IMPLEMENTATION_PLAN Phase 5 (line 26, `* 3600000`) — vs `src/dedup.ts#isDuplicate` (line 31)
   computing `cutoff = now - dedupWindowHours * 60_000`. The "24 **hour**" window (PRD R2 line 49)
   is actually **24 minutes**. The function comment (`dedup.ts` line 23, "now - dedupWindowHours
   hours") also contradicts the code.

6. **DRIFT (FIFO → LIFO):** PRD R9 (line 70, "ascending `discovered_at`, with `id` ascending"),
   ARCHITECTURE §4.6 (line 86, `ORDER BY discovered_at ASC, id ASC`), and CONTEXT.md (line 38,
   "FIFO order = `discovered_at ASC, id ASC`") — vs `src/ingestor.ts#dequeue` (line 85)
   `ORDER BY discovered_at DESC, id DESC`. The queue is processed newest-first (LIFO), violating R9.

7. **DRIFT (last-write-wins comparison inverted):** PRD R7 (line 64, "greater `mtime_ms` wins"),
   ARCHITECTURE §4.4 (line 80, "greater `mtime_ms`"), and CONTEXT.md (line 39) — vs
   `src/scanner.ts#candidateWins` (lines 47-49) returning `candidate.mtime_ms < existing.mtime_ms`,
   i.e. the candidate wins when its mtime is **smaller**. This is first-write-wins, the opposite of
   the spec. (The hash tiebreak on line 52 is correct.)

8. **DRIFT (conflict function unused + misnamed):** ARCHITECTURE §4.4 (line 80) and
   IMPLEMENTATION_PLAN Phase 4 (line 22) say conflicts go through `scanner.ts#resolveConflict`
   applying last-write-wins — vs the code: the function is named `candidateWins` (not
   `resolveConflict`) and, per grep, **has no caller**. `src/scanner.ts#upsertCandidate`
   (lines 74-88) treats any non-`unchanged` row as "changed" and overwrites unconditionally,
   never consulting `candidateWins`. Last-write-wins is therefore not enforced at all — a
   rediscovery with an older mtime still overwrites.

9. **DRIFT (recovery rewinds committed work):** PRD R6 (line 61, only `in_progress` reset),
   ARCHITECTURE §4.7 (line 89, `WHERE status='in_progress'`, "the only place `in_progress` rows
   are rewound"), and CONTEXT.md (line 29) — vs `src/ingestor.ts#recover` (line 48)
   `UPDATE manifest SET status='pending' … WHERE status IN ('in_progress', 'done')`. Every startup
   resets all **`done`** rows to `pending`, reprocessing committed work and breaking R6 ("no
   committed work is repeated") and acceptance A6. The log message "rewound N in_progress rows"
   (line 52) is also now inaccurate.

10. **DRIFT (soft delete is actually a hard delete):** PRD R10 (line 73, "**soft-deleted** by
    setting `deleted_at` (the row is retained)"), ARCHITECTURE §4.8 (line 92,
    `UPDATE manifest SET deleted_at=? …`), and CONTEXT.md (line 40, "Soft delete sets
    `deleted_at`") — vs `src/scanner.ts#softDeleteMissing` (lines 97-99) which runs
    `DELETE FROM manifest WHERE path = ? AND deleted_at IS NULL`. Missing files are hard-deleted
    immediately; grep confirms nothing ever *sets* `deleted_at` to a timestamp. Consequently the
    retention tombstone never exists and `purgeExpired` (`scanner.ts` line 111) is dead in
    practice — the `retentionHours`/168h retention contract (R10) is unreachable.

11. **DRIFT (config validation inverted — default & example fail):** PRD §5 (line 98) and
    IMPLEMENTATION_PLAN Phase 1 (line 11) require `flushIntervalMs <= pollIntervalMs` to be
    **valid** — vs `src/config.ts#validateConfig` (lines 57-59) which throws when
    `c.flushIntervalMs < c.pollIntervalMs`. With the documented defaults (flush 2000, poll 5000)
    `2000 < 5000` is true, so `DEFAULT_CONFIG` **and** `ingestd.config.example.json` both throw
    `ConfigError` → exit 2. The guard should be `flushIntervalMs > pollIntervalMs`. As written,
    `ingestd run` with the shipped example config cannot start.

12. **DRIFT (concurrency cap off-by-one):** PRD R3 (line 52, "at most `concurrency` (default 4)"),
    ARCHITECTURE §4.2 (line 74, "Exactly `concurrency` (4) tasks may run at once"), and
    IMPLEMENTATION_PLAN Phase 7 (line 35, "peak in-flight never exceeds 4") — vs
    `src/pool.ts#acquire` (line 22) `if (this.inFlight <= this.concurrency)`. With `<=`, a slot is
    granted while `inFlight === concurrency`, so up to **5** tasks run concurrently with the default
    4. Should be `<`.

13. **DRIFT (stale "clean baseline" status claim):** CONTEXT.md (line 47, "Clean baseline; all docs
    match code. `npm run verify` green") and CONTEXT.md (line 11, `src/config.ts#DEFAULT_CONFIG`
    declared the source of truth) — vs reality: at least items 1-12 above are doc↔code conflicts,
    and `DEFAULT_CONFIG` disagrees with every other defaults table (items 1, 2). The "all docs match
    code" claim is false.

14. **DRIFT (log stream vs README claim):** README (line 38) states `--json` produces "structured
    NDJSON logs **to stdout**" — vs `src/logger.ts` (lines 30, 38) which writes `error` and `warn`
    records to **stderr** (only `info`/`debug` go to stdout). Under `--json`, warn/error NDJSON does
    not appear on stdout. (Minor; PRD R12 does not pin a stream, so this is README-specific.)

15. **DRIFT (claimed tests absent):** CONTEXT.md (line 8) lists `npm test` (node:test) and PRD §6 +
    IMPLEMENTATION_PLAN "Verification" reference an acceptance battery (A2/A4/A5/A6/A8) and per-phase
    unit checks — vs the repository, which contains **no test files** (`find` for `*.test.*`/`*test*`
    returns none; `package.json` `"test": "node --test"` would discover nothing). The acceptance
    claims are therefore unverified by any committed test, and several would fail given items 4, 6,
    9 above.

16. **DRIFT (sinkToken config key undocumented in PRD):** `src/types.ts` (lines 44-46) defines an
    optional `sinkToken`, and `ingestd.config.example.json` (line 14) sets it to `FAKE_DEMO_SECRET`
    — vs PRD §5's configuration table (lines 83-96), which does not list `sinkToken`. (Minor doc gap;
    CONTEXT line 41 and README line 79 acknowledge the placeholder, but the canonical config table
    omits the key.)

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

The docs (PRD, ARCHITECTURE, IMPLEMENTATION_PLAN, README, CONTEXT) form a coherent, mutually
consistent set — and the *plan and architecture state the correct contracts*. The **code has
diverged from those contracts in at least 16 concrete, checkable ways**, several of them
ship-blocking or correctness-breaking. CONTEXT's "Clean baseline; all docs match code" is no longer
true.

Most important issues, highest first:

1. **The default and example configs cannot load** (item 11). Inverted `flush <= poll` guard rejects
   the documented defaults → `ingestd run` exits 2 out of the box. This blocks basic operation.
2. **Crash-safety / idempotency are broken two ways:** `recover()` rewinds `done`→`pending` and
   reprocesses all committed work (item 9), and the "soft delete" hard-deletes rows so retention
   never functions (item 10). Both directly contradict R6/R10 and acceptance A6.
3. **Dedup window is 24 minutes, not 24 hours** (item 5) — a 60× unit error that silently
   defeats the core dedup guarantee (A2) outside a tiny window.
4. **FIFO is actually LIFO** (item 6) and **last-write-wins is unenforced / inverted** (items 7, 8)
   — ordering and conflict-resolution guarantees (R7/R9) are not met.
5. **Retry semantics are wrong:** no jitter (item 3), dead-letter at 6 not 5 attempts (item 4),
   and a backoff base of 500 instead of 200 (item 2) — breaking R4/R5 and acceptance A5.
6. **Concurrency cap is 5, not 4** (item 12) — R3 bound violated by one.
7. **Two default values disagree with every defaults table** (items 1, 2) and the **"all docs match
   code" status is stale** (item 13).
8. Lower severity: README's stdout-only log claim (item 14), absent acceptance tests (item 15), and
   the `sinkToken` key missing from the PRD config table (item 16).

Recommendation: treat this as code-side remediation against the (correct) docs — the plan/architecture
are the trustworthy reference. No documentation rewrite is warranted except updating CONTEXT's status
line once the code is fixed.

---

#### Output Contract

**Findings:** 16 numbered drifts in §3; 12 of them are doc↔code conflicts (items 1-12), one is a
stale-status doc claim (13), and items 14-16 are minor.

**Open Questions:** See `questions.md`. Chiefly: is `DEFAULT_CONFIG` or the docs the intended source
of truth for `batchSize`/`backoffBaseMs`, and is the inline per-call retry loop (vs cross-pass
retry) the intended R4 model?

**Verification Evidence:** Static read of all docs + `src/` (cited file:line above). `grep` confirmed
`candidateWins` has no caller, no `Math.random` exists in `src/`, and `deleted_at` is never set to a
timestamp. `find` confirmed zero test files. `npm run verify` / `npm test` were not executed in this
sandbox; the drifts are type-correct so `tsc --noEmit` would not catch them.

**Residual Risk:** Without a test suite, behavioral regressions (items 3-12) are invisible to
`npm run verify`; the acceptance battery the plan claims is satisfied is not exercised. Some
second-order interactions (e.g., same-run dedup before a batch flush commits `done`) were not
exhaustively traced.

**Gate Verdict:** `FAIL` — see the contract block at the top. Hand-off blocked until the
ship-blocking items (11, 9, 10, 5) and the remaining correctness drifts are resolved or explicitly
accepted with rationale.
