# Verifier Report — ingestd (fresh-eyes drift review)

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

Reviewed on disk: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`,
`README.md`, `ingestd.config.example.json`, `package.json`, and all of `src/`. I did not
run `tsc`/tests (no install in this run dir); findings are from static reading and are
individually checkable by file + line.

Bottom line: the three planning docs (PRD → ARCHITECTURE → PLAN) are coherent with one
another, but the **code has drifted hard from the docs** — multiple P0 requirements are
violated, and `CONTEXT.md` still claims "all docs match code." This is **SIGNIFICANT DRIFT**.

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement. Mapping:

| PRD Req | Architecture coverage | Status |
|---------|-----------------------|--------|
| R1 Source scan & discovery | §2 Scanner; §4.8; no-symlink, mtime/size change detect | Addressed |
| R2 Content-hash dedup | §4.1 (SHA-256, 64 KiB chunks, live `done` + window) | Addressed |
| R3 Bounded concurrency | §4.2 (`inFlight` + FIFO queue, exactly `concurrency`) | Addressed |
| R4 Retry/backoff | §4.3 (`computeBackoffMs`, full jitter, ceilings 200..3200) | Addressed |
| R5 Dead-letter | §4.3 (`attempts >= maxRetries` → dead) | Addressed |
| R6 Checkpoint & resume | §4.5 (txn commit) + §4.7 (`in_progress`→`pending` recovery) | Addressed |
| R7 Last-write-wins | §4.4 (`resolveConflict`, greater mtime, tiebreak greater hash) | Addressed |
| R8 Batch sizing & flush | §4.5 (size OR age, final partial force-flush) | Addressed |
| R9 FIFO order | §4.6 (`ORDER BY discovered_at ASC, id ASC`) | Addressed |
| R10 Soft delete & purge | §4.8 (`UPDATE … deleted_at`; purge by retention) | Addressed |
| R11 Exit codes & shutdown | §4.9 (EXIT_CODES 0–4, stopping flag, exit 3) | Addressed |
| R12 Structured logging | §4.10 (NDJSON ts/level/event/msg, debug gated) | Addressed |

No unsatisfied, overbuilt, or contradicted requirements at the architecture layer. One
small under-spec: the PRD §5 config table and the ARCHITECTURE config list do **not**
mention the optional `sinkToken` field that the code's `Config`/`SinkHandler` and the
example config actually carry (see §3, item 16) — a documentation gap, not an architecture
defect.

### 2. Architecture -> Delivery Plan

The plan builds the architecture coherently, bottom-up (types → config → logger → db →
stages → ingestor → cli), with a green-`verify` gate per phase and acceptance battery
A2/A4/A5/A6/A8 mapped to phases 5/6/8/9. Every architecture module has a corresponding
phase. No missing tasks, risky sequencing, or plan claims that reference non-existent
components. The plan is internally consistent with the PRD and ARCHITECTURE; all drift
appears **between these docs and the implementation**, captured in §3.

### 3. Delivery/Status -> Code

Concrete doc-vs-code (and doc-vs-doc) inconsistencies. Each is independently checkable.

1. **DRIFT:** `batchSize` default = **64** (PRD §5 table line 87; CONTEXT.md line 16;
   README.md line 55) vs code `DEFAULT_CONFIG.batchSize = 128` (`src/config.ts:9`).

2. **DRIFT:** `backoffBaseMs` default = **200** (PRD §5 line 91; PRD R4 line 55; CONTEXT.md
   line 19; README.md line 59) vs code `DEFAULT_CONFIG.backoffBaseMs = 500`
   (`src/config.ts:13`). Knock-on: CONTEXT's stated ceiling sequence "200,400,800,1600,3200"
   (CONTEXT.md line 26; PRD R4 line 55) is unreachable with base 500.

3. **DRIFT:** Config validation rule is **inverted**. PRD §5 line 98 requires
   `flushIntervalMs <= pollIntervalMs`, but `src/config.ts:57` throws when
   `c.flushIntervalMs < c.pollIntervalMs`. With the documented defaults
   (flush 2000, poll 5000) this guard fires `2000 < 5000 → throw`, so a default/example
   config that supplies `sources` would be rejected with "flushIntervalMs must be <=
   pollIntervalMs" (the error text contradicts the guard). The example config
   (`ingestd.config.example.json`, flush 2000 / poll 5000) would fail to load.

4. **DRIFT:** Dedup window uses the **wrong time unit**. ARCHITECTURE §4.1 (line 71) and
   PLAN Phase 5 (line 26) specify `now - dedupWindowHours*3600000`, and PRD R2 (line 49)
   says the window is **24 hours**. Code computes `now - dedupWindowHours * 60_000`
   (`src/dedup.ts:31`) — i.e. minutes. The effective default window is **24 minutes**, not
   24 hours. Breaks acceptance A2 (PRD line 101) for any re-ingest > 24 min apart.

5. **DRIFT:** No **jitter** is applied. PRD R4 (line 55), ARCHITECTURE §4.3 (line 77), and
   PLAN Phase 6 (line 30) all require full jitter `Math.floor(Math.random()*(ceiling+1))`,
   uniform in `[0, ceiling]`. Code `nextDelayMs` (`src/retry.ts:16-19`) returns the raw
   ceiling unchanged — deterministic delay, no jitter.

6. **DRIFT:** Dead-letter threshold is **off by one**. PRD R5 (line 58), ARCHITECTURE §4.3
   (line 77), and PLAN Phase 6 (line 30) define `shouldDeadLetter = attempts >= maxRetries`.
   Code uses `attempts > maxRetries` (`src/retry.ts:24`). With default maxRetries=5 the row
   dead-letters at **attempts = 6**, not 5. Directly breaks acceptance A5 (PRD line 103:
   "lands in `dead` after exactly 5 attempts").

7. **DRIFT:** Concurrency cap is **off by one**. PRD R3 (line 52), ARCHITECTURE §4.2
   (line 74: "Exactly `concurrency` (4) tasks may run at once"), CONTEXT.md (line 36: "hard
   4 in-flight"), and PLAN Phase 7 (line 35: "peak in-flight never exceeds 4") all bound it
   at 4. Code `acquire()` admits while `this.inFlight <= this.concurrency`
   (`src/pool.ts:22`), so it admits a 5th task (peak in-flight = `concurrency + 1 = 5`).
   Should be `< this.concurrency`.

8. **DRIFT (most severe):** Startup recovery **also rewinds committed `done` rows**.
   PRD R6 (line 61), ARCHITECTURE §4.7 (line 89: query is `WHERE status='in_progress'`,
   "the only place `in_progress` rows are rewound"), and CONTEXT.md (line 29) say only
   `in_progress` is reset on recovery — "no committed work is repeated." Code
   `recover()` runs `UPDATE manifest SET status='pending' … WHERE status IN
   ('in_progress', 'done')` (`src/ingestor.ts:48`). Every previously-completed item is
   reset to `pending` and re-processed on each restart — destroying the idempotency /
   crash-safety guarantee and breaking acceptance A6 (PRD line 104). The log message still
   says "rewound N in_progress rows" (`src/ingestor.ts:52`), masking that `done` rows are
   included.

9. **DRIFT:** Dequeue order is **LIFO, not FIFO**. PRD R9 (line 70), ARCHITECTURE §4.6
   (line 86), CONTEXT.md (line 38), and PLAN (line 42) specify
   `ORDER BY discovered_at ASC, id ASC`. Code dequeues with
   `ORDER BY discovered_at DESC, id DESC` (`src/ingestor.ts:85`) — newest first.

10. **DRIFT:** Last-write-wins comparison is **inverted**. PRD R7 (line 64) and
    ARCHITECTURE §4.4 (line 80) say the **greater** `mtime_ms` wins. Code `candidateWins`
    returns `candidate.mtime_ms < existing.mtime_ms` (`src/scanner.ts:47-48`) — the
    candidate "wins" when its mtime is **smaller**. (The tie-break `candidate.content_hash >
    existingHash` at line 52 is correct.)

11. **DRIFT:** "Soft delete" is actually a **hard delete**. PRD R10 (lines 72-73),
    ARCHITECTURE §4.8 (line 92: `UPDATE manifest SET deleted_at=? …`), and CONTEXT.md
    (line 40: "Soft delete sets `deleted_at`") require tombstoning that retains the row.
    Code `softDeleteMissing` runs `DELETE FROM manifest WHERE path=? AND deleted_at IS NULL`
    (`src/scanner.ts:97-98`) — the row is removed outright. Consequences: no tombstone is
    ever written, so `purgeExpired` / `retentionHours` (PRD R10, 168h) has nothing to act
    on, and "soft-deleted rows are excluded from scans and dedup" is vacuously true because
    none exist. R10 is effectively unimplemented despite the function name.

12. **DRIFT:** Last-write-wins is **not wired into the scan path at all**, and the helper is
    misnamed. ARCHITECTURE §4.4 (line 80) names the function `scanner.ts#resolveConflict`;
    the code exports it as `candidateWins` (`src/scanner.ts:43`). More importantly,
    `upsertCandidate` (`src/scanner.ts:59-89`) never calls it — on any mtime/size change it
    **unconditionally overwrites** the manifest row (`src/scanner.ts:82-87`) regardless of
    which version has the greater mtime. So even ignoring the inverted logic in item 10, the
    documented R7 conflict resolution is dead code and not enforced during scanning.

13. **DRIFT (doc-vs-doc / doc-vs-code):** CONTEXT.md's "Canonical constants" table
    (lines 11-24) declares "source of truth: `src/config.ts#DEFAULT_CONFIG`" yet lists
    `batchSize 64` and `backoffBaseMs 200`, which **disagree with that very file**
    (`src/config.ts:9,13` → 128 and 500). The doc points at config.ts as authoritative while
    contradicting it.

14. **DRIFT (stale status claim):** CONTEXT.md line 47 states "Clean baseline; all docs
    match code. `npm run verify` green." This is false — items 1–12 are live doc/code
    contradictions. (`npm run verify` may still pass, since these are logic bugs, not type
    errors; a green `tsc` is not evidence the docs match the code.)

15. **DRIFT (minor, downstream of #2/#5):** CONTEXT.md line 26 and PRD R4 assert the
    realized backoff ceilings are 200/400/800/1600/3200 ms. Given code base = 500
    (`src/config.ts:13`) and no jitter (`src/retry.ts:16-19`), neither the sequence nor the
    jitter claim holds at runtime.

16. **DRIFT (minor, doc gap):** `sinkToken` config key + `SinkHandler` token parameter exist
    in code (`src/types.ts:46,81-84`), the example config (`ingestd.config.example.json:14`),
    and are honored by the ingestor (`src/ingestor.ts:124`), but are absent from the PRD §5
    config table and the ARCHITECTURE config/module inventory. Code carries a config surface
    the specs don't document.

17. **NIT (undocumented, harmless):** `src/db.ts:42` issues `PRAGMA foreign_keys = ON`,
    not mentioned in ARCHITECTURE §3/§5. No foreign keys are defined, so it is a no-op — flag
    only for doc completeness.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The planning chain (PRD → ARCHITECTURE → PLAN) is sound and self-consistent. The
**implementation has diverged from it on multiple P0 requirements**, and `CONTEXT.md` still
advertises a clean baseline. Most important issues first:

1. **Recovery re-runs committed work** (item 8, `src/ingestor.ts:48`) — `done` rows are
   rewound to `pending` on every restart. Breaks the core crash-safe / idempotent promise
   (R6, A6). Highest severity.
2. **Soft delete is a hard delete** (item 11, `src/scanner.ts:97-98`) — R10 tombstoning and
   retention are not implemented; data is destroyed instead of retained.
3. **Dedup window is 24 minutes, not 24 hours** (item 4, `src/dedup.ts:31`) — wrong unit
   (`*60_000`); breaks R2/A2 for realistic re-ingest intervals.
4. **Processing order is LIFO, not FIFO** (item 9, `src/ingestor.ts:85`) — `DESC, DESC`
   violates R9.
5. **Last-write-wins not enforced + inverted helper** (items 10 & 12,
   `src/scanner.ts:47-48,59-89`) — R7 conflict resolution is dead code and the comparison is
   backwards.
6. **Dead-letter at 6 attempts, not 5** (item 6, `src/retry.ts:24`, `>` vs `>=`) — breaks
   R5/A5.
7. **Concurrency peaks at 5, not 4** (item 7, `src/pool.ts:22`, `<=` vs `<`) — violates R3.
8. **No retry jitter** (item 5, `src/retry.ts:16-19`) — violates R4.
9. **Config validation inverted** (item 3, `src/config.ts:57`) — default/example configs are
   rejected; error text contradicts the guard.
10. **Default constants wrong** (items 1–2, `src/config.ts:9,13`) — batchSize 128 vs 64,
    backoffBaseMs 500 vs 200.
11. **Docs assert their own correctness while contradicting code** (items 13–14) — CONTEXT
    cites config.ts as source of truth while disagreeing with it, and claims "all docs match
    code."

Recommended next step (not performed here, per review scope): treat items 1–12 as blocking
remediation; once code is corrected, refresh CONTEXT.md's constants table and the
"Clean baseline" status line, and document `sinkToken` in PRD §5 / ARCHITECTURE.

---

**Open Questions:** None blocking. (Whether `npm run verify`/tests are currently green could
not be confirmed in this run dir — no install present — but type-checking would not catch any
of items 1–12, which are behavioral.)

**Verification Evidence:** Static read of all docs and `src/*` with file:line citations
above. No build/test executed (no node_modules in the review workspace).

**Residual Risk:** If a reviewer trusts CONTEXT.md line 47 ("all docs match code") or a green
`tsc`, every behavioral defect above ships silently. The defects cluster in correctness-
critical paths (recovery, dedup, ordering, dead-letter, concurrency, soft-delete), so the
runtime behavior diverges materially from the documented contract.
