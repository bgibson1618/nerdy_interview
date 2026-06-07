# ledger-api — Fresh-Eyes Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/middleware/idempotency.ts: replay/conflict logic is inverted vs PRD R10 (same body -> 409, different body -> replay)
  - src/middleware/rateLimit.ts: limiter keyed by req.ip, not by token/account (violates R11 and the file's own contract)
  - src/routes/transfers.ts: POST /transfers requires `transfers:read`, not `transfers:write` (R9 / auth bypass)
  - src/services/transfers.ts: FEE_BPS = 190 (1.9%), every doc + the adjacent comment say 290 (2.9%)
  - src/utils/money.ts: exact-half branch rounds half-UP, not HALF_EVEN (R8); contradicts its own worked example
  - src/config.ts: defaultLimit 10 (docs 25), rateLimit.max 100 (docs 60), idempotency TTL ~24min (docs 24h), webhook backoff [1000,3000,9000] (docs [1000,2000,4000])
  - CONTEXT.md: claims a Phase 7 token-management API shipped; it does not exist and is listed out-of-scope by the plan, architecture, and CONTEXT itself
RIGOR: tuned
```

Reviewed with no prior context, from disk only: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, and all of `src/`. This is a report only — nothing was
changed.

---

### 1. Source Brief -> Architecture

The architecture is, on its own terms, a faithful and complete expansion of the PRD. Every
requirement is addressed:

| Req | Addressed in ARCHITECTURE | Notes |
|-----|---------------------------|-------|
| R1 Create/read accounts | §3 `accounts`, §4 scope table | OK |
| R2 List + cursor paging (default 25 / max 100) | §8, §12 | OK in prose |
| R3 Soft-delete + guards | §3 `accounts.closed_at`, narrative | OK |
| R4 Atomic double-entry | §5 | OK — single `withTransaction`, FOR UPDATE in id order, audit in-txn |
| R5 Balance invariant + 422 | §5 step 2/6 | OK |
| R6 Read transfers/history | §3 `transfers`/`entries`, §8 | OK |
| R7 Webhook 4 attempts / 1s,2s,4s / 5s / HMAC | §7 | **Self-inconsistent:** §7 says `timeoutMs = 5000`, but the §12 config table says webhook per-attempt timeout `10000` ms. |
| R8 Fee 290 bps, HALF_EVEN | §5 step 3, §6, §12 | Prose correct (290, HALF_EVEN). |
| R9 Bearer token + per-endpoint scopes, 401/403 | §4 | OK — scope table is the authoritative source |
| R10 Idempotency 24h, 409 on body mismatch | §9 | OK |
| R11 Rate limit per account/token, 60/60s, reads free | §10 | OK — explicitly "by token id … not IP" |
| R12 Immutable audit, 5 actions, posted-in-txn | §3 `audit_events`, §11 | Lists 5 actions incl. `transfer.failed`; no failure→audit path is described (see §2/§3) |
| R13 Health unauth `{status:"ok"}` | §2 | OK |

Architecture-level issues to carry forward:

- **A1 (internal):** §12 config table lists the webhook per-attempt timeout as `10000` ms,
  contradicting §7 (`5000`) and PRD R7 (5 s). The code agrees with §7/PRD (5000), so the §12
  cell is the outlier.
- **A2:** §6 / §12 treat the fee rate as a config constant (`FEE_BPS`), and §12 is headed
  "single source of truth: `src/config.ts`". In the code `FEE_BPS` is **not** in `config.ts` at
  all — it is a hard-coded export in `src/services/transfers.ts`. This is a structural drift the
  plan inherits (§2 below).

Nothing is overbuilt or contradicted at the PRD→Architecture seam itself; the damage is at the
plan/code seams.

---

### 2. Architecture -> Delivery Plan

The plan's phase decomposition (Phase 0 skeleton → Phase 6 webhook/audit) maps cleanly onto the
architecture, with per-phase acceptance criteria tied to requirement numbers. Sequencing is
sound (data layer → auth → accounts → engine → routes/idempotency/rate-limit → webhook/audit).

Drifts and stale assumptions:

- **P1 — "all constants live in `src/config.ts`."** IMPLEMENTATION_PLAN line 4 ("All constants
  cited here live in `src/config.ts`") and Phase 4 ("`FEE_BPS = 290`") assume the fee rate is a
  config constant. It is not — see A2. The plan references a config value the architecture's own
  single-source-of-truth file does not contain.

- **P2 — Phase 6 acceptance over-claims.** Phase 6 acceptance says "All five audit actions
  appear." The architecture describes write paths for only four (`account.created`,
  `account.closed`, `transfer.posted`, `transfer.settled`). There is no described path that ever
  emits `transfer.failed` or moves a transfer to `failed`. This acceptance criterion is not
  satisfiable as designed (and the code confirms it — §3 item 14).

- **P3 — CONTEXT references a phase the plan explicitly excludes.** The plan's "Out of scope
  (v1)" (line 102) lists "a token-management API" as NOT built. `CONTEXT.md` claims a Phase 7
  token-management API is "Done." The plan defines only Phases 0–6; there is no Phase 7. The
  status doc has drifted ahead of the plan (and ahead of reality — §3 item 12).

Otherwise the plan is coherent with the architecture: no missing tasks for R1–R13, no risky
sequencing.

---

### 3. Delivery/Status -> Code

Concrete inconsistencies, each independently checkable. Several are correctness/security/financial
defects, not cosmetic doc lag.

1. **DRIFT:** PRD R11, ARCHITECTURE §10, README "Rate limiting", CONTEXT, *and the limiter's own
   header comment* all say the rate limiter keys **per account/token, NOT per IP**
   vs `src/middleware/rateLimit.ts:28` keys the bucket on `req.ip ?? 'unknown'`. The code does
   the exact opposite of every doc and its own comment; `req.token` is never used as the key.

2. **DRIFT:** PRD R9 / Acceptance, ARCHITECTURE §4 table (`POST /transfers → transfers:write`),
   README endpoint table, *and the route file's own header comment* (`POST /transfers ->
   transfers:write`) vs `src/routes/transfers.ts:38` `requireScope('transfers:read')`. A
   read-only token can post (move money). Auth/scoping defect.

3. **DRIFT:** PRD R10, ARCHITECTURE §9, README "Idempotency", *and the middleware's own contract
   comment* ("same key … returns the STORED status+body … a different body is a 409") vs
   `src/middleware/idempotency.ts:52-56`, where the conditional is inverted: when
   `request_hash === requestHash` (same body) it throws **409**, and when the body **differs** it
   replays the stored response. Both branches are backwards; the 409 message
   ("reused with a different body") even fires on an identical body.

4. **DRIFT:** PRD R8, ARCHITECTURE §5/§6, README "Money & fees", CONTEXT ("FEE_BPS=290"), *and the
   adjacent code comment* `// … (2.9% = 290 bps)` vs `src/services/transfers.ts:31`
   `export const FEE_BPS = 190;` (1.9%). Every transfer is charged the wrong fee.

5. **DRIFT:** PRD R8 / README / CONTEXT require **HALF_EVEN** rounding, and
   `src/utils/money.ts:13-15` documents the worked example `computeFee(2, 2500) -> 0
   ("0.5 rounds to even 0")` vs `src/utils/money.ts:36-37`, where the exact-half branch
   returns `quotient + 1` unconditionally — i.e. round-half-**up**. `computeFee(2,2500)` actually
   returns `1`, not `0`. The implementation is not banker's rounding for exact halves.

6. **DRIFT:** PRD R2/R6, ARCHITECTURE §8 ("Default `limit` is **25**"), §12, README, CONTEXT
   (default 25), *and config.ts's own comment block* vs `src/config.ts:35`
   `pagination.defaultLimit: 10`. Both list endpoints default to 10 (`routes/accounts.ts:44`,
   `services/accounts.ts:51`, `routes/transfers.ts:85`).

7. **DRIFT:** PRD R11, ARCHITECTURE §10/§12 (rate-limit max **60**), README, CONTEXT, *and
   config.ts's own comment* ("60 mutating requests per rolling 60s window") vs `src/config.ts:43`
   `rateLimit.max: 100`. The 101st request, not the 61st, is throttled.

8. **DRIFT:** PRD R10, ARCHITECTURE §9/§12 (Idempotency TTL **24h** / `86400000` ms), README,
   CONTEXT vs `src/config.ts:50` `idempotency.ttlMs: 24 * 60 * 1000`, which is **1,440,000 ms =
   24 minutes**, not 24h. The inline comment `// 86400000 ms = 24h` is itself wrong (the
   expression evaluates to 1,440,000). Keys expire ~60× too early.

9. **DRIFT:** PRD R7, ARCHITECTURE §7/§12 (backoff **1s/2s/4s** = `[1000,2000,4000]`), README,
   CONTEXT, *and webhook.ts's own comment* (`config.webhook.backoffMs = [1000,2000,4000]`) vs
   `src/config.ts:58` `webhook.backoffMs: [1000, 3000, 9000]`. Actual waits are 1s/3s/9s.

10. **DRIFT:** ARCHITECTURE §12 config table lists webhook per-attempt timeout `10000` ms vs
    `src/config.ts:59` `webhook.timeoutMs: 5000`. Here the **doc** is wrong: code (5000) agrees
    with PRD R7, ARCHITECTURE §7, README, and CONTEXT (all 5 s); only the §12 table cell drifts.

11. **DRIFT:** PRD R2/R6 + ARCHITECTURE §8 ("Lists order by `(created_at DESC, id DESC)`",
    newest-first) vs `src/routes/transfers.ts:103` `ORDER BY created_at ASC, id ASC`. `GET
    /transfers` returns **oldest-first**, the reverse of the documented order (and of
    `GET /accounts`, which correctly uses `DESC` at `services/accounts.ts:66`). The keyset
    predicate at `transfers.ts:96` (`(created_at, id) < ($1, $2)`) is also paired with `ASC`
    ordering, so cursor paging walks the result set inconsistently.

12. **DRIFT:** CONTEXT.md:31-32 "Phase 7 — token-management endpoints (`POST /tokens`,
    `DELETE /tokens/:id`) … Done." vs the code: no `/tokens` route exists (`src/index.ts:20-21`
    mounts only `/accounts` and `/transfers`; there is no `routes/tokens.ts`). This also
    contradicts (a) CONTEXT.md's own "What's next (not built)" line 67 — "A token-management
    endpoint (tokens are seeded out of band today)"; (b) IMPLEMENTATION_PLAN line 102, which lists
    a token-management API as out of scope; and (c) ARCHITECTURE §4, which has no `/tokens`
    endpoints. The status claim is false in four directions at once.

13. **DRIFT:** CONTEXT.md:18 "All **six** build phases are complete" vs the body, which lists
    **eight** phases (Phase 0 through Phase 7), while IMPLEMENTATION_PLAN defines **seven** (Phase
    0–6). The phase count is internally inconsistent in CONTEXT and disagrees with the plan.

14. **DRIFT:** PRD R12 + README "Audit log" + IMPLEMENTATION_PLAN Phase 6 acceptance ("All five
    audit actions appear", incl. `transfer.failed`) vs the code, which never emits
    `transfer.failed` and never sets a transfer's status to `failed`. The action exists only in
    the `AuditAction` type (`src/types.ts:21`) and the `transfers.status` CHECK constraint
    (`src/db/schema.sql:30`); no code path writes it (confirmed by grep — only type/DDL hits).
    Only four of the five documented audit actions can ever occur.

15. **DRIFT:** CONTEXT.md "Config quick reference (`src/config.ts`)" table and ARCHITECTURE §12
    ("single source of truth: `src/config.ts`") present the fee (`290 bps`) as a `config.ts`
    value vs `src/config.ts`, which has **no** fee/bps field at all — `FEE_BPS` lives in
    `src/services/transfers.ts:31`. The "single source of truth" claim is inaccurate for the one
    monetary constant.

(Items 4 and 5 compound: the fee rate is wrong *and* its rounding is wrong.)

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

This is not stale-doc lag around a correct implementation — the code carries multiple injected
defects that flatly contradict the specs (and frequently their own neighboring comments). Highest
priority first:

1. **Inverted idempotency logic** (item 3) — same-key retries get a 409 while *different*-body
   requests replay a stale response. Breaks the core "safe retry" guarantee (R10) and is a
   data-integrity hazard.
2. **Rate limiter keyed by IP, not account/token** (item 1) — directly violates R11's stated
   threat model ("a client cannot get more throughput by rotating IPs"); also misattributes
   limits across accounts behind a shared IP.
3. **POST /transfers requires `transfers:read`** (item 2) — a read-scoped token can move money.
   Authorization defect.
4. **Wrong fee rate (190 vs 290 bps) and non-HALF_EVEN rounding** (items 4, 5) — every transfer
   computes the wrong fee, and exact-half cases round the wrong direction. Financial correctness.
5. **Config constants wrong across the board** (items 6–9): default page size 10 vs 25, rate
   limit 100 vs 60, idempotency TTL 24 min vs 24 h, webhook backoff 1/3/9 s vs 1/2/4 s.
6. **`GET /transfers` returns oldest-first** (item 11) — contradicts the newest-first contract and
   diverges from `GET /accounts`.
7. **False "Phase 7 token API shipped" status** (item 12) plus the phase miscount (item 13) — the
   status narrative claims work that does not exist and that the plan excludes.
8. Lower severity but real: `transfer.failed` audit action never emitted (item 14); ARCHITECTURE
   §12 timeout cell wrong (item 10); fee constant misattributed to `config.ts` (item 15).

Recommended gate action: **block**. The auth-scope, idempotency, rate-limit-key, and fee/rounding
items are correctness/security/financial bugs that should be fixed and re-verified before any
"done" claim; the config-value and status-doc items should be reconciled in the same pass.

---

*Open Questions:* see `questions.md`.
*Verification evidence:* file:line citations inline above; confirmed by direct reads of all of
`src/` and all five docs, plus grep sweeps for `/tokens` routes, `transfer.failed` emission, and
`FEE_BPS` location.
*Residual risk:* review is static (no DB available to run the service); behavioral items (e.g.
the cursor-paging inconsistency in item 11, the idempotency inversion in item 3) are inferred from
code reading, not executed. The injected-defect density suggests treating any *untouched* doc
claim as "verify before trust" rather than assumed-correct.
