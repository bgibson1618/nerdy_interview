# ledger-api — Fresh-Eyes Drift Review

Independent coherence review. Read on disk: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, and all of `src/`. No prior context. Report only —
nothing was changed.

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> Architecture: PASS (one internal inconsistency)
  - Architecture -> Delivery Plan: PASS (status claims stale)
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

---

### 1. Source Brief -> Architecture

`ARCHITECTURE.md` is a faithful realization of the PRD at the **design** level — almost every
requirement is addressed in the architecture doc. The drift is overwhelmingly between the
**docs and the code**, not between the PRD and the architecture. Requirement-by-requirement:

| Req | Addressed in ARCHITECTURE? | Note |
|-----|----------------------------|------|
| R1 create/read accounts | Yes (§2 routes, §3 `accounts`, §4 table) | OK |
| R2 list + cursor paging, default 25/max 100 | Yes (§8, §12) | OK in doc |
| R3 soft-delete + guards | Yes (§3 `accounts.closed_at`) | OK |
| R4 atomic double-entry | Yes (§5) | OK |
| R5 balance invariant, 422 on insufficient | Yes (§5 step 2/6) | OK |
| R6 read transfers + history | Yes (§4 table, §8) | OK |
| R7 webhook 4 attempts / 1s,2s,4s / 5s / HMAC | Yes (§7) — **but §12 table contradicts §7** | see below |
| R8 fee 290 bps HALF_EVEN | Yes (§6, §12) | OK in doc |
| R9 token auth + per-endpoint scopes, 401 vs 403 | Yes (§4) | OK in doc (POST /transfers = `transfers:write`) |
| R10 idempotent writes, 24h, body-mismatch 409 | Yes (§9) | OK in doc |
| R11 per-account rate limit 60/60s | Yes (§10, §12) | OK in doc |
| R12 immutable audit, posted-row in txn | Yes (§11) | OK in doc |
| R13 health | Yes (§1/§2) | OK |

Flags in this layer:

- **ARCHITECTURE internal contradiction (R7 timeout).** §7 (line 190) states the per-attempt
  timeout is `config.webhook.timeoutMs = 5000` ms (5 s), matching PRD R8/R7 ("5s") and the
  README. But the §12 config table (`ARCHITECTURE.md:244`) lists **Webhook per-attempt timeout
  = `10000` ms**. The PRD says 5 s; the code says 5000 (`config.ts:59`). The §12 table value is
  wrong.
- **Under-specified (not a contradiction).** The PRD never assigns a status code to "account
  not active" or "currency mismatch." The code chooses `409` and `422` respectively
  (`services/transfers.ts:84,90`); the architecture doesn't pin these. Worth nailing down but
  not drift.
- Architecture correctly **omits** any token-management API, consistent with PRD §3 non-goals.
  (CONTEXT does not — see §3 item 11.)

### 2. Architecture -> Delivery Plan

`IMPLEMENTATION_PLAN.md` (Phases 0–6 + "Out of scope") tracks the architecture coherently:
component-by-component deliverables, acceptance criteria mapped to R-numbers, and the same
constants. Sequencing is sound (skeleton → data → auth → accounts → transfer engine → routes/
idempotency/rate-limit → webhook/audit). Issues:

- **Plan's acceptance criteria now fail against the code/config.** The plan cites the canonical
  numbers (default **25** / max 100 at line 52; **60 req / 60s** at line 85; **1s/2s/4s**,
  **5s** at line 91; **HALF_EVEN** + **FEE_BPS = 290** at lines 58–64; **24h** replay at line
  77). The shipped `config.ts` / `services/transfers.ts` do not match any of those (§3 items
  1–6). So the plan is internally coherent but the build does not satisfy its own acceptance
  bullets.
- **Plan Phase 6 over-claims audit coverage.** Acceptance (line 98): "All five audit actions
  appear." The code never emits `transfer.failed` and never sets a transfer `status='failed'`
  anywhere; only `account.created`, `account.closed`, `transfer.posted`, `transfer.settled` are
  ever written (§3 item 13). The fifth action is declared (`types.ts:21`, PRD R12) but
  unreachable.
- **Plan explicitly lists "a token-management API" as Out of scope (v1)** (line 102–103). This
  is consistent with the PRD and architecture, and directly contradicts CONTEXT's "Phase 7 …
  Done" claim (§3 item 11). The plan has no Phase 7.

### 3. Delivery/Status -> Code

Each item is an independently checkable contradiction between a doc claim and the code (or
between two docs).

1. **DRIFT:** Default list page size — docs say **25** (`PRD.md:63` R2; `ARCHITECTURE.md:203,238`;
   `README.md:72`; `CONTEXT.md:59`; `IMPLEMENTATION_PLAN.md:52`) vs code
   `pagination.defaultLimit: 10` (`src/config.ts:35`). Runtime default page size is 10, not 25.

2. **DRIFT:** Rate-limit max — docs say **60 req / 60s** (`PRD.md:125` R11;
   `ARCHITECTURE.md:218,240`; `README.md:82-83`; `CONTEXT.md:61`) vs code `rateLimit.max: 100`
   (`src/config.ts:43`). (`windowMs` 60 s is correct.)

3. **DRIFT:** Idempotency TTL — docs say **24h / 86,400,000 ms** (`PRD.md:119` R10;
   `ARCHITECTURE.md:241`; `README.md:77`; `CONTEXT.md:62`) vs code
   `idempotency.ttlMs: 24 * 60 * 1000` = **1,440,000 ms = 24 minutes** (`src/config.ts:50`). The
   replay window is 60× too short. The inline comment is self-contradictory: it annotates the
   value as "`86400000 ms = 24h`" while the expression evaluates to 24 minutes.

4. **DRIFT:** Webhook backoff schedule — docs say **[1000, 2000, 4000] (1s/2s/4s)** (`PRD.md:95`
   R7; `ARCHITECTURE.md:189,243`; `README.md:89`; `CONTEXT.md:63`; and the code's own comments
   at `src/config.ts:55` and `src/services/webhook.ts:6`) vs the actual value
   `webhook.backoffMs: [1000, 3000, 9000]` (`src/config.ts:58`). Runtime waits are 1s/3s/9s.

5. **DRIFT:** Fee rate — docs say **290 bps (2.9%)** (`PRD.md:102` R8; `ARCHITECTURE.md:180,236`;
   `README.md:49`; `CONTEXT.md:25,59`; `IMPLEMENTATION_PLAN.md:64`) vs code `FEE_BPS = 190`
   (`src/services/transfers.ts:31`). The constant is 1.9%, and the comment one line above it
   (`transfers.ts:30`) literally says "2.9% = 290 bps." All fees are under-charged.

6. **DRIFT:** Rounding mode — docs say the fee rounds **HALF_EVEN / banker's rounding**
   (`PRD.md:104-106` R8; `ARCHITECTURE.md:176-181`; `README.md:50-51`; `CONTEXT.md:38`;
   `config.ts:29`) vs code `computeFee` which on an exact half returns `quotient + 1`
   **unconditionally** (`src/utils/money.ts:36`). That is round-half-**up**, not round-half-even.
   The function's own example comment (`money.ts:14`) claims `2, 2500 -> 0` ("0.5 rounds to even
   0"), but the code returns **1** for that input. Even-quotient half-cases are mis-rounded.

7. **DRIFT:** Rate-limit key — docs (and the file's own header comment) say the limiter keys
   **per authenticated account/token, NOT per IP** (`PRD.md:122-124` R11; `ARCHITECTURE.md:216`;
   `README.md:82`; `CONTEXT.md:46-47`; `src/middleware/rateLimit.ts:1-9`) vs code
   `const key = req.ip ?? 'unknown'` (`src/middleware/rateLimit.ts:28`). It throttles by client
   IP — exactly the behavior the docs say it must not have (a client can rotate IPs to evade it;
   clients behind one NAT are wrongly aggregated). `req.token` is loaded but never used as the key.

8. **DRIFT:** Idempotency replay logic is **inverted** — spec says same key + **same** body →
   replay stored response; same key + **different** body → 409 (`PRD.md:119-120` R10;
   `ARCHITECTURE.md:206-212`; `README.md:76-78`; and the file's own docstring
   `src/middleware/idempotency.ts:6-9`). The code does the opposite (`idempotency.ts:52-57`):
   when `request_hash === requestHash` (same body) it throws **409 "reused with a different
   body"**, and when the body differs it **replays** the stored response. Legitimate retries get
   409; genuinely conflicting bodies silently get the wrong cached response.

9. **DRIFT:** `POST /transfers` required scope — docs say **`transfers:write`** (`PRD.md:113` R9;
   `ARCHITECTURE.md:143`; `README.md:40`; and the route file's own header `routes/transfers.ts:4`)
   vs code `requireScope('transfers:read')` (`src/routes/transfers.ts:38`). A read-only token can
   post money; a write-only token cannot. (`POST /accounts` correctly uses `accounts:write`.)

10. **DRIFT:** `GET /transfers` ordering — docs say lists are **newest-first**, `(created_at DESC,
    id DESC)` (`PRD.md:59,86-88` R2/R6; `ARCHITECTURE.md:198-203`; `README.md:68`; `CONTEXT.md:49`)
    vs code `ORDER BY created_at ASC, id ASC` (`src/routes/transfers.ts:103`). Transfers list
    oldest-first. Worse, the cursor predicate is still `(created_at, id) < ($1, $2)`
    (`transfers.ts:96`), which is the keyset for DESC order — combined with ASC ordering, cursor
    paging is **broken**, not merely reversed. (`GET /accounts` correctly uses DESC,
    `services/accounts.ts:66`.)

11. **DRIFT:** CONTEXT claims a shipped token-management API that does not exist and that every
    other doc excludes. `CONTEXT.md:31-32` lists "Phase 7 — token-management endpoints
    (`POST /tokens`, `DELETE /tokens/:id`) … Done." There is **no** `routes/tokens.ts`, no
    `/tokens` mount (`src/index.ts:20-21` mounts only `/accounts` and `/transfers`), and no such
    routes anywhere in `src/`. It is absent from `ARCHITECTURE.md` §4, the `README.md` endpoint
    table, and the PRD requirement list; `IMPLEMENTATION_PLAN.md:102-103` lists "a
    token-management API" as **Out of scope (v1)**. CONTEXT even **contradicts itself**: line 67
    lists "A token-management endpoint (tokens are seeded out of band today)" under
    "What's next (not built)."

12. **DRIFT (doc vs doc):** Webhook per-attempt timeout — `ARCHITECTURE.md:244` (§12 table) says
    `10000` ms, but `ARCHITECTURE.md:190` (§7 prose), `PRD.md:95` (R7, "5s"), `README.md:90`, and
    the code `webhook.timeoutMs: 5000` (`src/config.ts:59`) all say 5 s. The §12 table value is
    stale/wrong.

13. **DRIFT:** Audit action `transfer.failed` and transfer `status='failed'` are declared but
    never produced. `types.ts:13,21` define them; `PRD.md:130` (R12) and `IMPLEMENTATION_PLAN.md:98`
    ("All five audit actions appear") require them. No code path sets a transfer to `failed` or
    calls `recordAudit('transfer.failed', …)` — only four actions are ever emitted
    (`services/accounts.ts:22,96`, `services/transfers.ts:147`, `routes/transfers.ts:69`). The
    fifth audit action is unreachable.

14. **DRIFT (doc vs doc + count):** `CONTEXT.md:18` says "All six build phases are complete" but
    then enumerates Phase 0 through Phase 7 — **eight** bullets — and asserts they are "coherent
    with the docs." `IMPLEMENTATION_PLAN.md` defines Phases 0–6 (seven phases, no Phase 7). The
    "six" count is wrong, and the "coherent with the docs" claim is false given items 1–13.

15. **DRIFT (status truthfulness):** CONTEXT's "Config quick reference" table (`CONTEXT.md:55-63`)
    asserts List limit "default 25 / max 100", Rate limit "60 / 60s", Idempotency TTL "24h",
    Webhook "1s/2s/4s, 5s TO", Fee "290 bps" — every one of which contradicts the actual
    `src/config.ts` / `FEE_BPS` it claims to mirror (items 1–5). The table presents drifted
    values as the shipped source of truth.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The documentation set (PRD → ARCHITECTURE → PLAN) is mutually coherent and well-formed; the
problem is that the **code and the CONTEXT status doc have diverged sharply from the specs**,
including several changes that invert documented, safety-critical behavior. A reader trusting
the docs would be wrong about money, auth, and idempotency.

Most important first:

1. **Idempotency logic is inverted** (item 8) — retries are rejected with 409 and conflicting
   bodies are served the wrong cached response. Directly defeats R10's purpose (safe retries).
2. **`POST /transfers` is gated by `transfers:read`, not `transfers:write`** (item 9) — a
   read-only token can move money; an authorization-boundary violation of R9.
3. **Rate limiter keys on IP, not account/token** (item 7) — explicitly the behavior R11 forbids;
   trivially evaded by IP rotation.
4. **Fee is 190 bps and rounds half-up** (items 5, 6) — every transfer under-charges (1.9% vs
   2.9%) and mis-rounds exact halves, breaking R8's money correctness.
5. **Idempotency TTL is 24 minutes, not 24 hours** (item 3) — 60× shorter replay window than R10.
6. **`GET /transfers` is oldest-first with a mismatched cursor predicate** (item 10) — wrong order
   and broken keyset pagination, violating R6/R2.
7. **CONTEXT advertises a shipped, self-contradictory "Phase 7" token-management API** (items 11,
   14) that no code, architecture, README, PRD, or plan supports.
8. Config-vs-doc number drift on page size, rate-limit max, and webhook backoff (items 1, 2, 4);
   a stale webhook-timeout value inside ARCHITECTURE §12 (item 12); and an unreachable
   `transfer.failed` audit action the plan claims is exercised (item 13).

No tests were present to run, so all findings are from static reading of the specs and `src/`;
each item above cites a file and line so it can be checked individually.

---

**Findings:** 15 concrete drifts (§3), 8 of which alter documented runtime behavior; 1
intra-architecture inconsistency (§1); plan acceptance criteria no longer met by the build (§2).

**Open Questions:** none blocking — see `questions.md`.

**Verification Evidence:** static review of all five docs and all 17 `src/` files; line-cited
above. No build/test executed (no test suite shipped; `package.json` defines only
`build`/`start`/`dev`).

**Residual Risk:** without a test suite, additional silent behavioral drift may exist in paths
not exercised by reading (e.g. concurrent-transfer locking order, audit JSONB shape). The
items above are the high-confidence, individually checkable ones.

**Gate Verdict:** FAIL — blocking items 1–6 and 11 above must be reconciled (code corrected or
docs amended to match) before this can be called "done / coherent with the docs."
