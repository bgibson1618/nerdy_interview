# ledger-api — Fresh-Eyes Coherence / Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> Architecture: PASS
  - Architecture -> Delivery plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/services/transfers.ts:31: FEE_BPS = 190, not the documented 290 bps
  - src/utils/money.ts:36: exact-half rounds UP, not HALF_EVEN (contradicts R8 + its own example)
  - src/middleware/rateLimit.ts:28: limiter keyed by req.ip, not per account/token (violates R11)
  - src/routes/transfers.ts:38: POST /transfers requires transfers:read, not transfers:write (violates R9)
  - src/middleware/idempotency.ts:52-57: replay/conflict logic inverted (violates R10)
  - src/config.ts:50: idempotency TTL is 24 minutes, not 24h
  - CONTEXT.md:31-32: claims token-management endpoints shipped; no such code exists
RIGOR: tuned
```

Scope: read-only review of `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, and all of `src/` (+ `package.json`,
`tsconfig.json`, `schema.sql`). No tests were run (none present); findings are
from static reading of docs vs. code. Every checkable constant was traced to
`src/config.ts` / the relevant source line.

---

### 1. Source Brief -> Architecture

The architecture is a faithful and complete realization of the PRD's *intent*.
Every requirement is addressed at the design level:

| Req | Addressed in ARCHITECTURE? | Notes |
|-----|----------------------------|-------|
| R1 create/read accounts | Yes — §2 routes, §3 `accounts` table | OK |
| R2 list + cursor pagination | Yes — §8 | OK (design says default 25 / max 100) |
| R3 soft-delete + guards | Yes — §3 (`closed_at`), §2 services | OK |
| R4 atomic double-entry | Yes — §5 | OK |
| R5 balance invariant / 422 | Yes — §5 | OK |
| R6 read transfers + history | Yes — §2, §8 | OK |
| R7 webhook retry/backoff/HMAC | Yes — §7 | **Internally inconsistent timeout (see below)** |
| R8 fee 290 bps HALF_EVEN | Yes — §6 | Design correct; code is not (§3 below) |
| R9 token auth + scopes + 401/403 | Yes — §4 | OK |
| R10 idempotency 24h / 409 | Yes — §9 | OK |
| R11 per-account rate limit | Yes — §10 | OK (design says "by token id, not IP") |
| R12 immutable audit log | Yes — §11 | Design lists 5 actions; code emits 4 (§3) |
| R13 health | Yes — §2 | OK |

Nothing in the PRD is unsatisfied, overbuilt, or contradicted at the
architecture level. Two architecture-internal issues:

- **ARCHITECTURE §12 contradicts ARCHITECTURE §7 on the webhook timeout.** §7
  says `config.webhook.timeoutMs = 5000` (5s); the §12 config table row says
  "Webhook per-attempt timeout `10000` ms". The PRD (R7), README, and CONTEXT
  all say 5s. The §12 value is the outlier (and the code agrees with §7, not
  §12 — see §3 item 11).
- The architecture correctly does **not** describe any token-management API
  (consistent with PRD §3 non-goals). That makes CONTEXT's "Phase 7 … Done"
  claim baseless (see §3 items 14–15).

Verdict for this layer: **PASS** (design matches brief; the drift is code- and
status-doc-level, not architecture-level).

---

### 2. Architecture -> Delivery Plan

The plan (Phases 0–6) builds the architecture coherently and each phase carries
acceptance criteria mapped to requirements. Issues:

- **Plan claims a single source of truth that the code does not honor.** The
  plan header (`IMPLEMENTATION_PLAN.md:4`) and Phase 4 say "All constants cited
  here live in `src/config.ts`" and "`FEE_BPS = 290`". `FEE_BPS` is **not** in
  `config.ts`; it is defined in `src/services/transfers.ts:31` (and its value is
  190, not 290). ARCHITECTURE §12 likewise labels Fee as "constant `FEE_BPS`"
  without placing it in the config table. Minor architectural drift in *where*
  the constant lives, compounded by the value drift in §3.
- **Plan Phase 6 acceptance is unachievable by the delivered design/code.** It
  asserts "All five audit actions appear" (`account.created`, `account.closed`,
  `transfer.posted`, `transfer.settled`, `transfer.failed`). Neither the
  architecture's transfer flow (§5/§7) nor the code ever produces a
  `transfer.failed` audit row (see §3 item 12). The acceptance criterion
  references behavior the system does not implement.
- Sequencing is otherwise sound. The plan correctly lists a token-management API
  as **out of scope (v1)** — which directly contradicts CONTEXT's "Phase 7 …
  Done" status claim (§3 items 14–15).

Verdict for this layer: **FAIL** (stale "single source of truth" claim + an
acceptance criterion the build cannot satisfy).

---

### 3. Delivery/Status -> Code

Each finding is independently checkable. Form: `DRIFT: <doc claim @ where> vs
<conflicting fact @ where>`.

1. **DRIFT: Fee rate is 290 bps (2.9%)** — PRD R8 (lines 101-107), ARCHITECTURE
   §5/§6/§12, README "Money & fees", CONTEXT Phase 4 + config table — **vs
   `FEE_BPS = 190` (1.9%)** at `src/services/transfers.ts:31`. The comment one
   line above even says "2.9% = 290 bps", so code contradicts its own comment.

2. **DRIFT: Fee rounding is HALF_EVEN (banker's rounding)** — PRD R8,
   ARCHITECTURE §6 ("on an exact half rounds to the nearest **even** quotient"),
   `config.ts:27-29`, and `utils/money.ts`'s own header + worked example
   ("`2, 2500 -> 0` (0.5 rounds to even 0)") — **vs code that always rounds an
   exact half UP**: the exact-half branch returns `quotient + 1` unconditionally
   at `src/utils/money.ts:36` (it never checks whether `quotient` is even). For
   the documented example (amount 2, bps 2500) the code returns **1**, not 0.
   This is HALF_UP, not HALF_EVEN.

3. **DRIFT: Rate limiting is per authenticated account/token, NOT per IP** —
   PRD R11 (lines 122-126), ARCHITECTURE §10, README "Rate limiting", CONTEXT,
   and `rateLimit.ts`'s own header comment ("keyed by the authenticated TOKEN id
   … NOT by client IP") — **vs code that keys the bucket by `req.ip`** at
   `src/middleware/rateLimit.ts:28` (`const key = req.ip ?? 'unknown';`).
   `req.token` is available but unused. A client can evade the limit by rotating
   IPs; conversely all accounts behind one IP share a bucket.

4. **DRIFT: Rate limit max is 60 requests / window** — PRD R11, ARCHITECTURE
   §10/§12, README, CONTEXT — **vs `rateLimit.max: 100`** at `src/config.ts:43`
   (window 60000 ms is correct).

5. **DRIFT: Idempotency TTL is 24 hours** — PRD R10 (lines 116-120),
   ARCHITECTURE §9/§12 ("`86400000` ms (24h)"), README, CONTEXT — **vs
   `ttlMs: 24 * 60 * 1000` = 1,440,000 ms = 24 *minutes*** at
   `src/config.ts:50`. The inline comment misstates the arithmetic as
   "86400000 ms = 24h"; the actual expression is 24 minutes.

6. **DRIFT: Idempotency replays on a matching body and 409s on a different
   body** — PRD R10, ARCHITECTURE §9, and `idempotency.ts`'s own contract
   comment (lines 6-9: "returns the STORED status+body … only if the request
   body hash matches. A replay with a different body is a 409 conflict") — **vs
   inverted code** at `src/middleware/idempotency.ts:52-57`: it throws
   `409 'reused with a different body'` when `existing.request_hash ===
   requestHash` (i.e. when the body is the *same*), and replays the stored
   response when the hashes *differ*. A legitimate retry gets a 409; a genuine
   body-mismatch silently replays the wrong response.

7. **DRIFT: POST /transfers requires scope `transfers:write`** — PRD R9 (lines
   109-114), ARCHITECTURE §4 scope table, README endpoints table, and the route
   file's own header comment (`transfers.ts:5`) — **vs
   `requireScope('transfers:read')`** at `src/routes/transfers.ts:38`. A
   read-only token can post transfers; this is a privilege-escalation drift.

8. **DRIFT: Default list page size is 25** — PRD R2 (lines 58-63), ARCHITECTURE
   §8/§12, README "Pagination", CONTEXT config table, plan Phase 3 — **vs
   `defaultLimit: 10`** at `src/config.ts:35` (used by both `accounts.ts`
   listing and `transfers.ts` GET). Max 100 is correct.

9. **DRIFT: Transfer listing is newest-first, `ORDER BY (created_at DESC, id
   DESC)`** — PRD R6 (lines 86-89), ARCHITECTURE §8, `cursor.ts` header comment
   — **vs `ORDER BY created_at ASC, id ASC`** at `src/routes/transfers.ts:103`.
   This is also internally broken: the cursor predicate on line 96 is
   `(created_at, id) < ($1, $2)` (a descending-scan predicate), so it is
   inconsistent with the ascending ORDER BY. `accounts.ts` (line 66) correctly
   uses DESC; only the transfers route drifted.

10. **DRIFT: Webhook backoff is `[1000, 2000, 4000]` (1s/2s/4s)** — PRD R7
    (lines 91-99), ARCHITECTURE §7/§12, README, CONTEXT, `webhook.ts` header
    comment, and `config.ts:55` comment — **vs `backoffMs: [1000, 3000, 9000]`
    (1s/3s/9s)** at `src/config.ts:58`.

11. **DRIFT (doc vs doc, and doc vs code): webhook per-attempt timeout** —
    ARCHITECTURE §12 table says `10000` ms — **vs 5s everywhere else**:
    ARCHITECTURE §7, PRD R7, README, CONTEXT, and the code
    (`timeoutMs: 5000` at `src/config.ts:59`). The §12 row is the single
    outlier; code is correct against the majority docs.

12. **DRIFT: all five audit actions are emitted (incl. `transfer.failed`)** —
    PRD R12 (lines 128-133), README "Audit log", plan Phase 6 acceptance — **vs
    code that never writes `transfer.failed`**. It exists only in the enum
    (`src/types.ts:21`); `grep` finds no `recordAudit('transfer.failed', …)`
    call anywhere. Only four actions can ever appear.

13. **DRIFT: `FEE_BPS` is a constant in `src/config.ts`** — IMPLEMENTATION_PLAN
    header (line 4) + Phase 4, ARCHITECTURE §12 ("constant `FEE_BPS`"), CONTEXT
    config quick-reference — **vs `FEE_BPS` actually living in
    `src/services/transfers.ts:31`**, not in `config.ts` at all. (`config.ts`
    has no fee field.)

14. **DRIFT: "Phase 7 — token-management endpoints (`POST /tokens`,
    `DELETE /tokens/:id`) … Done."** — CONTEXT.md:31-32 — **vs no such code**:
    there is no `src/routes/tokens.ts`, `index.ts:20-21` mounts only
    `/accounts` and `/transfers`, and the README endpoints table lists no
    `/tokens` routes. This also contradicts PRD §3 (tokens provisioned out of
    band), the plan's "Out of scope (v1) … a token-management API", **and
    CONTEXT's own** "What's next (not built): A token-management endpoint"
    (CONTEXT.md:67). The claim is false and self-contradictory.

15. **DRIFT: "All six build phases are complete"** — CONTEXT.md:18 — **vs the
    list immediately below it enumerating Phase 0 through Phase 7 (eight
    phases)** at CONTEXT.md:20-32. The plan itself defines only Phases 0–6.
    Both the count ("six") and the extra Phase 7 are wrong.

16. **Minor — DRIFT: transfer lifecycle starts `pending`** — `types.ts:10-13`
    comment ("created 'pending', becomes 'posted'") and `schema.sql:29` default
    `'pending'` — **vs `createTransfer` inserting `status = 'posted'` directly**
    (`src/services/transfers.ts:104`). `'pending'` is never a real runtime
    state. Defensible (the post is atomic), but the doc/schema imply a
    transition the code skips.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

This corpus reads as "all phases done and coherent" (CONTEXT.md:18) but the code
diverges from the specs on most checkable constants and on several behavioral
contracts — including correctness- and security-critical ones. Most important
first:

1. **Money math is wrong twice.** Fee is 190 bps instead of 290 (item 1) **and**
   rounding is HALF_UP instead of the specified HALF_EVEN (item 2). Every
   transfer mis-charges the fee and mis-credits the destination versus the
   documented behavior — and `money.ts` even fails its own documented example.
2. **Idempotency is inverted (item 6).** Honest retries are rejected with 409
   while different-body reuses replay a stale response — the opposite of R10.
   This breaks the headline "safe to retry" guarantee.
3. **Authorization hole on transfers (item 7).** `POST /transfers` checks
   `transfers:read`, so any read-scoped token can move money.
4. **Rate limiting doesn't do what it claims (items 3, 4).** Keyed by IP (not
   account/token) and capped at 100 (not 60) — the per-account guarantee of R11
   is not enforced.
5. **Idempotency TTL is 24 minutes, not 24 hours (item 5).**
6. **False / self-contradictory status (items 14, 15).** CONTEXT advertises
   shipped token-management endpoints that don't exist and miscounts the phases;
   `transfer.failed` audit events are promised but never emitted (item 12).
7. **Pagination drift (items 8, 9):** default page size 10 vs 25 everywhere, and
   the transfers list orders ASC while docs (and its own cursor predicate)
   require newest-first DESC.
8. **Doc-internal contradictions:** webhook backoff 1/3/9s vs documented 1/2/4s
   (item 10); ARCHITECTURE §12 webhook timeout 10000 ms vs 5s everywhere else
   (item 11); `FEE_BPS` documented as a `config.ts` constant but defined in
   `services/transfers.ts` (item 13).

Remediation is reporting-only here; no files were modified.
