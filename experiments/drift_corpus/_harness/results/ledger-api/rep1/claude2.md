# ledger-api — Independent Drift / Coherence Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: PASS
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

Fresh-eyes review of this workspace only. I read `CONTEXT.md`, `PRD.md`,
`ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, and all of `src/`.
The docs are internally well-aligned with each other and with the PRD; the
problem is the **code has silently drifted from the specs in many concrete,
behavior-changing ways**, and `CONTEXT.md` makes a "shipped" claim (Phase 7)
that nothing in the code or the other docs supports. Several config values even
contradict their own inline comments.

---

### 1. Source Brief -> Architecture

The architecture satisfies every PRD requirement at the design level. Walking R1–R13:

| Req | Addressed in ARCHITECTURE? | Notes |
|-----|----------------------------|-------|
| R1 Create/read accounts | Yes — §2 routes, §3 `accounts` table, balance default 0, status active | OK |
| R2 List accounts (cursor) | Yes — §8 pagination, envelope `{data,next_cursor}`, default 25/max 100 | OK at design level |
| R3 Soft-delete | Yes — §3 `closed_at`, §2 service; guards described | OK |
| R4 Atomic double-entry | Yes — §5 `withTransaction`, FOR UPDATE in id order | OK |
| R5 Balance invariant + 422 | Yes — §5 step 2/6 | OK |
| R6 Read transfers + history | Yes — §2/§8 | OK |
| R7 Webhook retry/backoff/HMAC | Yes — §7 | **§12 table self-contradicts §7 on timeout (10000 vs 5000)** |
| R8 Fee 290bps HALF_EVEN | Yes — §5/§6/§12 | OK at design level |
| R9 Token auth + scopes | Yes — §4 scope table, 401 vs 403 | OK |
| R10 Idempotent writes 24h | Yes — §9/§12 | OK at design level |
| R11 Per-account rate limit | Yes — §10 "by token id … not IP" | OK at design level |
| R12 Immutable audit log | Yes — §3/§11; lists all five actions | OK at design level |
| R13 Health check | Yes — §2/§4 | OK |

Nothing in the architecture is unsatisfied, overbuilt, or contradicted **by the
PRD**. The only architecture-internal defect is the webhook per-attempt timeout:
ARCHITECTURE §7 and the config-values table footnote say **5s/5000 ms**, but the
§12 "Key config values" table row says **10000 ms**. One of the two is wrong;
the rest of the corpus (PRD R7, README, CONTEXT, the code) all say 5s, so §12's
`10000` is the outlier.

### 2. Architecture -> Delivery Plan

The plan (`IMPLEMENTATION_PLAN.md`) builds the architecture coherently. Phases
0–6 map cleanly onto the component map and onto R1–R13, each with acceptance
criteria that trace to requirements. Sequencing is sound (data layer → auth →
accounts → transfer engine → routes/idempotency/rate-limit → webhook/audit).
The plan's "Out of scope (v1)" list (FX, scheduled transfers, **token-management
API**, cache/Redis, queue) is consistent with PRD §3 Non-goals.

One forward-looking incoherence, which is really a CONTEXT problem (see §3):
the plan defines **seven** phases (0–6) and explicitly puts a token-management
API **out of scope**, yet `CONTEXT.md` claims a "Phase 7 — token-management
endpoints … Done." The plan has no Phase 7. No plan task references a component
the architecture lacks; the drift is entirely status-vs-reality, covered below.

### 3. Delivery/Status -> Code

Every concrete inconsistency I found, as a checkable numbered list. "Docs" means
PRD/ARCHITECTURE/README/CONTEXT/PLAN as cited.

1. **DRIFT (fee rate):** All docs say the fee is **290 bps (2.9%)** —
   PRD R8, ARCHITECTURE §5/§6/§12, README "Money & fees", CONTEXT line 25 &
   config table, PLAN Phase 4 — **vs** `src/services/transfers.ts:31`
   `export const FEE_BPS = 190;` (1.9%). The comment immediately above it even
   says "2.9% = 290 bps", so the constant contradicts its own comment.

2. **DRIFT (fee rounding is not HALF_EVEN):** PRD R8 / ARCHITECTURE §6 / README /
   CONTEXT say exact halves round to the nearest **even** integer **vs**
   `src/utils/money.ts:29-37`, whose exact-half branch always does
   `return quotient + 1;` (round-half-**up**). This even contradicts the
   function's own docstring example `2, 2500 -> 0 (0.5 rounds to even 0)`:
   the code returns `1`, not `0`. Only the exact-half case is wrong; non-half
   cases are fine.

3. **DRIFT (wrong scope on POST /transfers):** ARCHITECTURE §4 table, README
   endpoints table, PRD R9, and the route file's own header comment
   (`POST /transfers -> transfers:write`) all say **`transfers:write`** **vs**
   `src/routes/transfers.ts:38` `requireScope('transfers:read')`. A read-only
   token can post transfers; a write-only token is rejected.

4. **DRIFT (rate limit keyed by IP, not account):** PRD R11 ("per authenticated
   account/token, NOT per client IP"), ARCHITECTURE §10 ("by token id (per
   account), not IP"), README ("per token, not per IP"), CONTEXT ("per
   account/token, not per IP"), and the file's own comment **vs**
   `src/middleware/rateLimit.ts:28` `const key = req.ip ?? 'unknown';`. The
   limiter buckets by IP, defeating the stated guarantee (rotating IPs evades it;
   `req.token` is loaded but unused for the key).

5. **DRIFT (rate-limit max):** Docs say **60 req / 60s** (PRD R11, ARCHITECTURE
   §10/§12, README, CONTEXT, PLAN) **vs** `src/config.ts:43` `max: 100`. The
   inline comment on line 40 even says "60 mutating requests per rolling 60s
   window" while the value is 100.

6. **DRIFT (default list limit):** Docs say default page size **25**
   (PRD R2, ARCHITECTURE §8/§12, README, CONTEXT, PLAN Phase 3) **vs**
   `src/config.ts:35` `defaultLimit: 10`. (Max 100 is correct.) Both list routes
   consume this (`src/routes/accounts.ts:44`, `src/routes/transfers.ts:85`), so
   the live default is 10.

7. **DRIFT (idempotency TTL is ~24 minutes, not 24h):** Docs say **24h /
   86400000 ms** (PRD R10, ARCHITECTURE §9/§12, README, CONTEXT) **vs**
   `src/config.ts:50` `ttlMs: 24 * 60 * 1000` = **1,440,000 ms = 24 minutes**.
   The trailing comment claims "86400000 ms = 24h", but the arithmetic gives 24
   min (missing a `* 60`). Replays expire ~60× sooner than documented.

8. **DRIFT (idempotency match/conflict logic inverted):** PRD R10 / ARCHITECTURE
   §9 / README / the middleware's own header say a repeat with the **same body**
   replays the stored response and a **different body** returns 409. The code
   does the opposite — `src/middleware/idempotency.ts:52-57`: when
   `existing.request_hash === requestHash` (same body) it `throw new
   HttpError(409, …)`, and when the hash differs it replays the stored response.
   Same-key/same-body retries (the normal idempotency case) get 409; same-key/
   different-body collisions get a wrong replay.

9. **DRIFT (webhook backoff schedule):** Docs say **1s/2s/4s = [1000,2000,4000]**
   (PRD R7, ARCHITECTURE §7/§12, README, CONTEXT, PLAN, and the config comment
   on line 55 and webhook.ts:6) **vs** `src/config.ts:58`
   `backoffMs: [1000, 3000, 9000]` (1s/3s/9s).

10. **DRIFT (transfers list ordered oldest-first):** Docs say lists are
    **newest-first / `(created_at DESC, id DESC)`** (PRD R6, ARCHITECTURE §8,
    README, CONTEXT) **vs** `src/routes/transfers.ts:103`
    `ORDER BY created_at ASC, id ASC` with predicate `(created_at, id) < ($1,$2)`
    (line 96). It returns oldest-first and the cursor direction is inconsistent
    with the sort. (`GET /accounts` in `src/services/accounts.ts:66` correctly
    uses `DESC`, which makes the transfers route the outlier.)

11. **DRIFT (`transfer.failed` audit action never emitted):** PRD R12, README,
    CONTEXT enumerate five audit actions including `transfer.failed`, the
    `AuditAction` type includes it (`src/types.ts:21`), and PLAN Phase 6
    acceptance says "All five audit actions appear." No code path ever calls
    `recordAudit('transfer.failed', …)` — only `account.created`,
    `account.closed`, `transfer.posted`, `transfer.settled` are written
    (`src/services/accounts.ts:22,96`, `src/services/transfers.ts:147`,
    `src/routes/transfers.ts:69`). Four of five appear.

12. **DRIFT (phantom shipped phase — token-management API):** `CONTEXT.md:31-32`
    lists "Phase 7 — token-management endpoints (`POST /tokens`,
    `DELETE /tokens/:id`) … Done." Nothing supports this: `src/index.ts:20-21`
    mounts only `/accounts` and `/transfers` (+ `/health`); there is no
    `routes/tokens.ts`; `Scope` has no `tokens:*` member (`src/types.ts:24-28`);
    PRD §3 calls token management a **non-goal**; PLAN lists "a token-management
    API" as **out of scope**; README's endpoint table has no `/tokens`. CONTEXT
    even **contradicts itself** — line 67 under "What's next (not built)" says
    "A token-management endpoint (tokens are seeded out of band today)."

13. **DRIFT (doc-internal, webhook timeout):** ARCHITECTURE §12 table row
    "Webhook per-attempt timeout `10000` ms" **vs** ARCHITECTURE §7 ("5s"),
    PRD R7 (5s), README (5s), CONTEXT (5s TO), and the code
    `src/config.ts:59` `timeoutMs: 5000`. The code is right; §12 is the outlier.

14. **DRIFT (FEE_BPS lives in the wrong module vs docs):** CONTEXT's "Config
    quick reference (`src/config.ts`)" and ARCHITECTURE §12 ("single source of
    truth: `src/config.ts`") present the fee/`FEE_BPS` as a `config.ts` constant.
    It is not in `config.ts` at all — it is a module-level constant in
    `src/services/transfers.ts:31`. (Compounds finding 1.)

15. **DRIFT (phase count / "coherent" claim):** `CONTEXT.md:18` says "All
    **six** build phases are complete and coherent with the docs," then lists
    **eight** phases (0–7). The PLAN defines **seven** (0–6) and has no Phase 7.
    The "coherent with the docs" claim is itself false given findings 1–14.

Secondary / lower-severity observations (not counted in the numbered list above):

- **Rate-limit window semantics.** PRD R11 says "rolling 60-second window";
  `src/middleware/rateLimit.ts:32-34` implements a **fixed** window (counter
  resets at `resetAt`), and its own comment calls it a "fixed rolling counter."
  Behavior differs from a true sliding window at window boundaries. Minor vs the
  IP-keying defect (finding 4).
- **Webhook attempt condition.** PRD R7 says the service attempts delivery after
  every post; `src/routes/transfers.ts:61-62` only attempts when `WEBHOOK_URL`
  is set. README documents the URL as optional, so this is README-vs-PRD nuance,
  not a code bug.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The doc set is coherent with the PRD, but the code has drifted from it in ~15
concrete, individually checkable ways — most behavior-changing and financially
or security relevant. Several config constants even contradict the comments
sitting next to them, which suggests values were edited without updating intent.

Most important issues, highest first:

1. **Wrong fee rate** — `FEE_BPS = 190` vs documented 290 (finding 1). Every
   transfer mis-charges the fee by a third.
2. **Idempotency logic inverted** — normal same-key/same-body retries get `409`
   and conflicting bodies get a wrong replay (finding 8). Breaks the core
   safe-retry guarantee.
3. **Rate limit keyed by IP, not account** — defeats the per-account abuse
   control the PRD/README/CONTEXT explicitly promise (finding 4).
4. **Wrong scope on POST /transfers** (`transfers:read`) — an authorization
   defect: read-only tokens can move money (finding 3).
5. **Idempotency TTL ~24 min instead of 24h** (finding 7) and **fee rounding is
   half-up, not HALF_EVEN** (finding 2) — both silent correctness drifts.
6. **Phantom "Phase 7 — token-management … Done"** in CONTEXT, contradicting the
   code, the PRD, the PLAN, and CONTEXT's own "not built" list (finding 12).
7. Remaining numeric/ordering drifts: default limit 10 vs 25, rate max 100 vs 60,
   webhook backoff 1/3/9s vs 1/2/4s, transfers list oldest-first, never-emitted
   `transfer.failed`, and the §12 doc-internal 10000 ms timeout
   (findings 5,6,9,10,11,13).

---

#### Open Questions
None blocking. Direction of remediation (fix code to match docs, vs amend docs
to match code) is a product call, but for findings 1–4, 7, 8 the docs are
self-consistent and the code is the outlier, so the code is almost certainly
what's wrong.

#### Verification Evidence
Static read-through only; I did not build or run the service (no DB/runtime in
this review sandbox, and the task is doc/code drift, not execution). Every
finding cites a file and line and the contradicting doc location so each can be
checked independently. Cross-checked all numeric constants in `src/config.ts`
and `src/services/transfers.ts` against the PRD acceptance table, ARCHITECTURE
§12, README tables, and the CONTEXT config quick reference.

#### Residual Risk
- I did not exhaustively trace the cursor SQL for the `<` vs `>` interaction with
  `ASC` ordering in `GET /transfers`; finding 10 reports the documented-ordering
  drift, but the route's pagination may also be functionally broken (the cursor
  moves the wrong way relative to the sort).
- No tests exist in the repo to corroborate or refute these findings at runtime;
  green tests were not available as evidence.

#### Gate Verdict
`VERDICT: FAIL` — the `Delivery/Status -> Code` dimension fails. Non-empty BLOCKING:

- `src/services/transfers.ts`: FEE_BPS=190, docs say 290 (fee mischarged).
- `src/middleware/idempotency.ts`: replay/409 branches inverted.
- `src/middleware/rateLimit.ts`: keyed by req.ip, not token/account.
- `src/routes/transfers.ts`: POST requires `transfers:read`, not `transfers:write`.
- `src/config.ts`: idempotency TTL 24min not 24h; default limit 10 not 25; rate max 100 not 60; webhook backoff [1000,3000,9000] not [1000,2000,4000].
- `src/utils/money.ts`: exact-half rounds up, not HALF_EVEN.
- `CONTEXT.md`: claims Phase 7 token-management shipped; no such code, contradicts PRD/PLAN and itself.
