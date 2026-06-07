# ledger-api — Independent Coherence / Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> Architecture: PASS
  - Architecture -> Delivery plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
BLOCKING:
  - src/middleware/idempotency.ts: body-match logic inverted — replays on a DIFFERENT body, 409s on the SAME body (R10 reversed)
  - src/services/transfers.ts: destination cached balance += amount instead of += (amount − fee), breaking the R5 balance invariant
  - src/middleware/rateLimit.ts: limiter keyed by req.ip, not token/account (R11 violated)
  - src/routes/transfers.ts: POST /transfers requires transfers:read, not transfers:write (R9 violated — read-only tokens can move money)
  - src/utils/money.ts: fee rounding is HALF_UP at the exact half, not HALF_EVEN (R8 violated)
  - src/services/transfers.ts: FEE_BPS = 190, docs say 290 bps / 2.9% everywhere
  - src/config.ts: defaultLimit 10 (docs 25), rateLimit.max 100 (docs 60), idempotency.ttlMs 24min (docs 24h), webhook.backoffMs [1s,3s,9s] (docs [1s,2s,4s])
  - CONTEXT.md: claims a Phase 7 token-management API shipped that does not exist and is explicitly out of scope
```

Scope: fresh-eyes review of this workspace only. Read CONTEXT.md, PRD.md,
ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, README.md, and all of `src/`. No code was
modified. Numeric/behavioral claims below were spot-checked with `node` and `grep`.

---

### 1. Source Brief -> Architecture

The architecture satisfies the PRD requirements at the design level. Each PRD
requirement maps to a component, and the data model covers every entity. One
internal architecture inconsistency is noted at the end.

| Req | Requirement | Addressed in ARCHITECTURE? |
|-----|-------------|----------------------------|
| R1  | `POST /accounts`, `GET /accounts/:id`; balance starts 0, currency ISO-4217, status active | Yes — §2 routes, §3 `accounts` table, §4 scope table |
| R2  | `GET /accounts` cursor paging, `{data,next_cursor}`, default 25 / max 100, newest-first | Yes — §8 (default 25, max 100, `(created_at DESC, id DESC)`) |
| R3  | `DELETE /accounts/:id` soft-delete, retain row, guard already-closed / non-zero balance | Yes — §2 `services/accounts.ts`, §3 `closed_at` |
| R4  | `POST /transfers` atomic single-transaction double-entry, active + same-currency | Yes — §5 (steps 1–7 inside `withTransaction`) |
| R5  | balance == credits − debits; insufficient funds → 422 | Yes — §5 step 6, step 2 |
| R6  | `GET /transfers/:id`, `GET /transfers` cursor paging, newest-first | Yes — §2, §8 |
| R7  | webhook 4 attempts, 1s/2s/4s backoff, 5s timeout, HMAC `X-Ledger-Signature`, runs after commit | Yes — §7 (but see §12 timeout contradiction below) |
| R8  | fee 290 bps, HALF_EVEN, net = amount − fee, source debited full | Yes — §6 |
| R9  | bearer token, per-endpoint scope, 401 vs 403, four named scopes | Yes — §4 |
| R10 | Idempotency-Key required, 24h replay, body-mismatch → 409 | Yes — §9 |
| R11 | per-account rate limit 60/60s, 429, reads unlimited | Yes — §10 (keyed by token id) |
| R12 | append-only audit log; 5 actions; posted-audit inside txn | Yes — §3 `audit_events`, §11, §5 step 7 |
| R13 | `GET /health` → `{status:"ok"}`, unauthenticated | Yes — §2 |

Nothing in the PRD is unaddressed, overbuilt, or contradicted by the architecture
**at the design level.** The PRD non-goals (no FX, no token/identity management, no
UI) are respected by the architecture.

- **Architecture-internal contradiction (carry into §3):** ARCHITECTURE §7 and the
  §12 config table disagree on the webhook per-attempt timeout — §7 says **5000 ms**,
  the §12 table row says **10000 ms**. Every other source (PRD R7, README, CONTEXT,
  code) says 5 s.

---

### 2. Architecture -> Delivery Plan

The IMPLEMENTATION_PLAN builds the architecture coherently. Phases 0–6 map cleanly
onto the component map and each phase carries acceptance criteria tied to specific
PRD requirements. Sequencing is sound (skeleton → data layer → auth → accounts →
transfer engine → routes/idempotency/rate-limit → webhook/audit).

- The plan's **"Out of scope (v1)"** explicitly lists "a token-management API" as
  NOT built — consistent with the PRD non-goals and the architecture. This is
  directly contradicted by CONTEXT.md's "Phase 7 … Done" claim (see §3, items 14–15).
- The plan asserts constants "live in `src/config.ts`" (header line) and Phase 4
  says "`FEE_BPS = 290`". In the code `FEE_BPS` actually lives in
  `src/services/transfers.ts` (not config.ts) and is `190` — both a location and a
  value drift (see §3 items 9, 17).
- Plan Phase 6 acceptance: "All five audit actions appear." The code can only ever
  emit four (see §3 item 16).
- No missing tasks or risky sequencing in the plan itself; the drift is entirely
  between the plan/architecture/PRD and the **code + CONTEXT**, captured in §3.

---

### 3. Delivery/Status -> Code

Every concrete inconsistency found, as a checkable numbered list. Format:
`DRIFT: <doc claim + where> vs <conflicting code/doc fact + where>`.

1. **DRIFT:** Default list page size is **25** (PRD R2; ARCHITECTURE §8 & §12 table;
   README "Pagination"; CONTEXT config table; plan Phase 3) vs code
   `pagination.defaultLimit: 10` in `src/config.ts:35`.

2. **DRIFT:** Rate limit is **60 requests / 60 s** (PRD R11; ARCHITECTURE §10 & §12;
   README "Rate limiting"; CONTEXT) vs code `rateLimit.max: 100` in
   `src/config.ts:43`. The same file's own comment (`src/config.ts:39-40`) says "60
   mutating requests," so the code contradicts its own comment.

3. **DRIFT:** Idempotency TTL is **24 hours / 86,400,000 ms** (PRD R10; ARCHITECTURE
   §9 & §12 table which literally says `86400000 ms`; README; CONTEXT) vs code
   `idempotency.ttlMs: 24 * 60 * 1000` in `src/config.ts:50`, which evaluates to
   **1,440,000 ms = 24 minutes**. The inline comment claims "= 86400000 ms = 24h"
   but the expression is wrong (missing a ×60).

4. **DRIFT:** Webhook backoff is **[1000, 2000, 4000] ms (1s/2s/4s)** (PRD R7;
   ARCHITECTURE §7 & §12; README; CONTEXT; and the comment in
   `src/services/webhook.ts:6`) vs code `webhook.backoffMs: [1000, 3000, 9000]` in
   `src/config.ts:58` (1s/3s/9s).

5. **DRIFT:** Rate limiting MUST be keyed **per account/token, not per IP** (PRD R11;
   ARCHITECTURE §10 "keyed … by token id … not IP"; CONTEXT "per account/token, not
   per IP"; README) vs code that keys the bucket by `req.ip`:
   `const key = req.ip ?? 'unknown';` in `src/middleware/rateLimit.ts:28`. The
   function never reads `req.token`, contradicting its own header comment
   (`rateLimit.ts:3-7`) and the line-27 note that "req.token is always set here." A
   client can evade the limit by rotating IPs — the exact failure mode R11 forbids.

6. **DRIFT:** Idempotency replay rule — same key + **same body → replay** the stored
   response; same key + **different body → 409** (PRD R10; ARCHITECTURE §9; README;
   and the contract comment in `src/middleware/idempotency.ts:4-9`) vs code with the
   condition **inverted** at `src/middleware/idempotency.ts:52-56`: it throws
   `409 'idempotency key reused with a different body'` when
   `existing.request_hash === requestHash` (i.e. the body is the **same**), and
   replays the stored response when the body **differs**. This breaks idempotent
   retries (legitimate same-body retries get 409) and corrupts conflicting reuse
   (different-body reuse silently replays a stale response).

7. **DRIFT:** `POST /transfers` MUST require scope **`transfers:write`** (PRD R9;
   ARCHITECTURE §4 scope table; README endpoints table) vs code
   `requireScope('transfers:read')` at `src/routes/transfers.ts:38`. A token holding
   only `transfers:read` can post money-moving transfers — a privilege-escalation
   drift.

8. **DRIFT:** Transfer listing MUST be **newest-first** ordered by
   `(created_at DESC, id DESC)` (PRD R6 / R2; ARCHITECTURE §8; cursor.ts:4 comment)
   vs code `ORDER BY created_at ASC, id ASC` at `src/routes/transfers.ts:103`. The
   accounts list correctly uses `DESC` (`src/services/accounts.ts:66`), so the two
   list endpoints disagree. The transfers cursor predicate is also still
   `(created_at, id) < ($1, $2)` (`transfers.ts:96`), which is wrong for an ASC
   order — pagination would skip/repeat rows.

9. **DRIFT:** Fee is **290 bps (2.9%)** (PRD R8; ARCHITECTURE §5/§6/§12; README;
   CONTEXT Phase 4; plan Phase 4) vs code `export const FEE_BPS = 190;` at
   `src/services/transfers.ts:31`. The line's own comment says "2.9% = 290 bps,"
   contradicting the value beside it.

10. **DRIFT:** Fee rounding MUST be **HALF_EVEN (banker's rounding)** — exact halves
    round to the nearest **even** integer (PRD R8; ARCHITECTURE §6; README; CONTEXT;
    and money.ts's own worked example claiming `computeFee(2, 2500) → 0`) vs code at
    `src/utils/money.ts:35-36` that returns `quotient + 1` **unconditionally** on an
    exact half — i.e. HALF_UP. Verified: `computeFee(2, 2500)` returns **1**, not the
    0 the comment promises (quotient 0 is already even, so half-even must stay 0).

11. **DRIFT:** Balance invariant — each account's cached `balance` MUST equal
    `Σ credits − Σ debits`, and balance updates MUST "match the entries exactly"
    (PRD R5; ARCHITECTURE §5 step 6) vs code at `src/services/transfers.ts:136-139`
    that credits the **destination's cached balance by `amount`**, while the
    destination's actual credit **entry** is `net = amount − fee`
    (`transfers.ts:117-120`). The destination's cached balance ends up `fee` higher
    than the sum of its entries — the invariant is violated and the ledger
    self-inconsistency is exactly what R5 forbids.

12. **DRIFT (doc vs doc + doc vs code):** Webhook per-attempt timeout is **5000 ms**
    (PRD R7; ARCHITECTURE §7; README; CONTEXT; code `webhook.timeoutMs: 5000` at
    `src/config.ts:59`) vs ARCHITECTURE **§12 config table** row "Webhook per-attempt
    timeout `10000` ms." The architecture doc contradicts itself and the code.

13. **DRIFT (status claim):** CONTEXT.md:18 says "**All six build phases are
    complete**," but the same section then lists Phase 0 through **Phase 7** (eight
    entries). The plan defines only Phases 0–6. Both the count ("six") and the
    Phase 7 entry are inconsistent with `IMPLEMENTATION_PLAN.md`.

14. **DRIFT (status claim vs code):** CONTEXT.md:31-32 claims "Phase 7 —
    token-management endpoints (`POST /tokens`, `DELETE /tokens/:id`) … **Done**." No
    such routes exist: `src/index.ts:20-21` mounts only `/accounts` and `/transfers`,
    there is no `src/routes/tokens.ts`, and `grep` finds no `/tokens` route. The plan
    lists "a token-management API" under **"Out of scope (v1)"**
    (`IMPLEMENTATION_PLAN.md:100-103`), and the PRD non-goals say "tokens are
    provisioned out of band" (`PRD.md:44`).

15. **DRIFT (doc self-contradiction):** CONTEXT.md:31-32 says the token-management
    endpoints are "Done," while CONTEXT.md:65-67 ("What's next — not built") lists "A
    token-management endpoint (tokens are seeded out of band today)." The same
    document claims the feature is both shipped and not built.

16. **DRIFT (under-implementation):** The audit log MUST be able to emit
    **`transfer.failed`** as one of five actions (PRD R12; README; CONTEXT;
    ARCHITECTURE §11; plan Phase 6 acceptance "All five audit actions appear"). In
    code `transfer.failed` appears only in the `AuditAction` type
    (`src/types.ts:21`) and is **never written** — no `recordAudit('transfer.failed',
    …)` call exists. Only four actions can occur (`account.created`,
    `account.closed`, `transfer.posted`, `transfer.settled`).

17. **DRIFT (structural):** ARCHITECTURE §12 names `src/config.ts` the "single source
    of truth" for constants and lists "Fee … (constant `FEE_BPS`)" there, but
    `FEE_BPS` is defined in `src/services/transfers.ts:31`, not in `config.ts`
    (secondary to the value drift in item 9, but worth noting since it undercuts the
    "single source of truth" claim).

**Spot-checks that PASSED (no drift):** `GET /health` → `{status:'ok'}`
(`index.ts:14-15`); 401-vs-403 scope semantics (`auth/tokens.ts:31,43`); SHA-256
token hashing; account soft-delete guards — already-closed 409 and non-zero-balance
409, row retained (`services/accounts.ts:83-98`); accounts list newest-first DESC +
lookahead pagination; `POST /accounts` correctly requires `accounts:write`; fee
*direction* (source debited full `amount`, destination credited `net`, fee account
credited `fee`) matches R8; webhook fires after commit, signs HMAC-SHA256 into
`X-Ledger-Signature`, 4 attempts, success only on 2xx; audit `transfer.posted`
written on the same transaction client (`transfers.ts:147-152`); schema.sql matches
the architecture data model (tables, enums, UUID PKs, BIGINT money, CHECK
constraints). The webhook `maxAttempts` (4) and `timeoutMs` (5000) in config are
correct; only `backoffMs` drifts.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

The design layer is coherent — the architecture satisfies the PRD and the plan
builds the architecture faithfully. The drift is concentrated in the **code and in
CONTEXT.md**, and several items are functional/financial-correctness defects, not
cosmetic doc lag. Most important first:

1. **Idempotency logic inverted (item 6)** — same-body retries are rejected with 409
   and different-body reuse silently replays stale responses. Idempotency is a core
   guarantee (R10) and is currently backwards.
2. **Balance invariant broken (item 11)** — destination cached balance is credited
   `amount` instead of `amount − fee`, so cached balances diverge from the entry
   ledger by the fee on every transfer. This corrupts the central correctness
   property (R5) of a double-entry system.
3. **Rate limiter keyed by IP, not token (item 5)** and **POST /transfers requires
   `transfers:read` (item 7)** — two control violations: the per-account throttle
   (R11) is bypassable by IP rotation, and a read-only token can move money (R9
   privilege escalation).
4. **Fee wrong in two ways (items 9, 10)** — `FEE_BPS = 190` (should be 290) and the
   rounding is HALF_UP at the exact half (should be HALF_EVEN). Every transfer
   computes the wrong fee with the wrong rounding bias.
5. **Config constants drift (items 1–4)** — page size 10 vs 25, rate max 100 vs 60,
   idempotency TTL 24 min vs 24 h, webhook backoff 1/3/9s vs 1/2/4s. Each contradicts
   the docs (and in several cases the file's own comment).
6. **False "shipped" status in CONTEXT (items 13–15)** — a Phase 7 token-management
   API is claimed Done but does not exist and is explicitly out of scope; CONTEXT
   even contradicts itself. Transfers list ordering (item 8), the `transfer.failed`
   audit gap (item 16), and the architecture's internal 5s-vs-10s timeout
   contradiction (item 12) round out the list.

**Verification evidence:** values confirmed via `node` (`24*60*1000 = 1,440,000`;
`computeFee(2,2500) = 1`) and `grep` (no `/tokens` route; `transfer.failed` only in
`types.ts`; `requireScope('transfers:read')` on POST; transfers `ORDER BY … ASC`;
destination `balance = balance + amount`). Code was not executed beyond these pure
checks; no database was available, so runtime behavior is inferred from source.

**Residual risk:** I reviewed only the files named in the task plus
`package.json`/`tsconfig.json`/`schema.sql`. There are no tests in the tree, so none
of these drifts is caught by an automated gate today — each must be verified by
reading the cited line. The most dangerous items (6, 11) produce silently wrong data
rather than errors.

**Open questions:** none blocking — see `questions.md` for two low-priority
clarifications (whether the inverted idempotency / IP-keying / scope / fee values are
intentional fixture seeds vs. real regressions). Per the task, nothing was fixed;
this is report-only.
