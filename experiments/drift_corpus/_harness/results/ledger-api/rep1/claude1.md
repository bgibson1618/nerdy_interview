# ledger-api — Independent Coherence / Drift Review

**Reviewer:** verifier (fresh eyes, on-disk only)
**Scope:** `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, all `src/**`
**Method:** Read docs as spec, read code as truth, checked every concrete, checkable fact in both directions.

---

### 1. Source Brief -> Architecture

The architecture is a faithful, well-structured response to the PRD. Walking each requirement:

| Req | PRD requirement | Architecture coverage | Verdict |
|-----|-----------------|-----------------------|---------|
| R1  | `POST /accounts`, `GET /accounts/:id`; currency, balance 0, status active | §2 routers, §3 `accounts` table (defaults `balance 0`, `status active`), §4 scope table | Addressed |
| R2  | `GET /accounts` cursor paging, `{data,next_cursor}`, default 25 / max 100 | §8 pagination (keyset, `limit+1`, opaque cursor), §12 limits 25/100 | Addressed |
| R3  | `DELETE /accounts/:id` soft-delete, guards (409), row retained | §3 `accounts.closed_at`, §4 scope table | Addressed |
| R4  | `POST /transfers` atomic single-transaction double-entry | §5 transfer engine (`withTransaction`, FOR UPDATE in id order, posted status) | Addressed |
| R5  | balance == credits − debits; insufficient funds → 422 | §5 step 6 ("update cached balances to match the entries exactly"), §5 step 2 (422) | Addressed (spec); **violated in code — see §3 #1** |
| R6  | `GET /transfers/:id`, `GET /transfers` cursor paging, newest-first | §8 pagination, §2 transfers router | Addressed (spec); **violated in code — see §3 #2** |
| R7  | webhook ≤4 attempts, 1s/2s/4s, 5s timeout, HMAC `X-Ledger-Signature`, after commit | §7 webhook; §12 config table | Addressed but **internally inconsistent**: §7 says timeout 5000 ms, §12 table says 10000 ms. |
| R8  | fee 290 bps, HALF_EVEN, net = amount − fee, source debited full | §5/§6/§12 (`FEE_BPS=290`, round-half-even algorithm) | Addressed (spec); **violated in code — see §3 #3, #4** |
| R9  | bearer token, per-endpoint scope, 401 vs 403 | §4 auth + scope table | Addressed (spec); **wrong scope on POST /transfers in code — see §3 #5** |
| R10 | Idempotency-Key required, 24h replay, body-mismatch 409 | §9 idempotency | Addressed (spec); **inverted in code — see §3 #6** |
| R11 | per-account (not IP) rate limit, 60/60s, 429, reads unlimited | §10 rate limiting ("keyed by token id, not IP") | Addressed (spec); **keyed by IP in code — see §3 #7** |
| R12 | append-only audit, 5 actions, posted-audit inside txn | §3 `audit_events`, §11 audit writer | Addressed (spec); **only 4 of 5 actions ever emitted — see §3 #8** |
| R13 | `GET /health` → `{status:"ok"}` unauthenticated | §2 bootstrap | Addressed |

**Architecture-level issues (independent of code):**

- **A1 — Architecture internally contradicts itself on webhook timeout.** §7 ("each attempt aborts after `config.webhook.timeoutMs = 5000` ms") vs §12 config table ("Webhook per-attempt timeout `10000` ms"). PRD R7 says 5s, so §12 is the wrong one.
- Nothing in the PRD is unsatisfied or overbuilt at the architecture layer. The data model in §3 matches `schema.sql` exactly (tables, columns, enums, constraints all line up — no schema drift found).

### 2. Architecture -> Delivery Plan

The plan (`IMPLEMENTATION_PLAN.md`) builds the architecture coherently. Phases 0–6 map cleanly onto the component map and to PRD requirements, each with acceptance criteria that trace to specific R-numbers. No missing tasks, no risky sequencing at the plan layer.

Notable: the plan is the **most accurate document in the set**. Its "Out of scope (v1)" explicitly lists "a token-management API" as *not built* — which is correct against the code, and directly contradicts `CONTEXT.md` (see §3 #9). The plan's acceptance criteria also restate the *correct* constant values (default 25 / max 100, 60/60s, HALF_EVEN, FEE_BPS 290, 1s/2s/4s, 5s) — all of which the code then violates. So the plan does not drift from the architecture; the **code drifted away from the plan**.

One stale claim to flag: Phase 6 acceptance says "All five audit actions appear" — the code only ever emits four (see §3 #8).

### 3. Delivery/Status -> Code — Concrete Inconsistencies

Each item is independently checkable. Form: `DRIFT: <doc claim + location> vs <code/doc fact + location>`.

1. **DRIFT: Destination cached balance does not match its entry (balance invariant R5 broken; money is created).**
   PRD R5 ("balance MUST equal Σcredits − Σdebits") + ARCHITECTURE §5 step 6 ("update cached balances to match the entries exactly… credits ⇒ balance +=") + CONTEXT ("destination is credited `amount − fee`") + README ("each account's cached `balance` always equals its credits minus its debits")
   **vs** `src/services/transfers.ts:117-121` writes the destination **credit entry of `net` (= amount − fee)** but `src/services/transfers.ts:136-139` updates the destination **balance by `+ amount`** (the full gross). Entry says `net`, balance bumps by `amount`. Net system effect per transfer: source −amount, dest +amount, fee +fee = **+fee created out of nothing**; destination's cached balance permanently exceeds Σ(its entries) by `fee`.

2. **DRIFT: `GET /transfers` is oldest-first, not newest-first.**
   PRD R6 + Acceptance row R6 ("cursor paginated, newest-first") + ARCHITECTURE §8 ("order by `(created_at DESC, id DESC)`")
   **vs** `src/routes/transfers.ts:103` `ORDER BY created_at ASC, id ASC`. (The accounts list at `src/services/accounts.ts:66` correctly uses `DESC`.) The ASC order is also internally inconsistent with the cursor predicate `WHERE (created_at, id) < ($1, $2)` on `src/routes/transfers.ts:96`, which assumes descending order — so forward paging is broken too.

3. **DRIFT: Fee rate is 190 bps (1.9%), not 290 bps (2.9%).**
   PRD R8 + CONTEXT ("`FEE_BPS=290`") + README ("**2.9% (290 bps)**") + ARCHITECTURE §5/§6/§12 ("`FEE_BPS = 290`")
   **vs** `src/services/transfers.ts:31` `export const FEE_BPS = 190;` — and the line-30 comment immediately above it still says "(2.9% = 290 bps)".

4. **DRIFT: Fee rounding is round-half-UP, not HALF_EVEN (banker's rounding).**
   PRD R8 ("HALF_EVEN… exact halves round to the nearest even integer") + ARCHITECTURE §6 + CONTEXT + README
   **vs** `src/utils/money.ts:35-37`: on an exact half it unconditionally `return quotient + 1` (always up). This also contradicts the function's own documented example at `src/utils/money.ts:14` (`2, 2500 -> 0`): the code returns `1` for `computeFee(2, 2500)` (numerator 5000, remainder 5000, twice == 10000 → quotient+1 = 1), not the documented even-rounded `0`.

5. **DRIFT: `POST /transfers` requires the wrong scope (`transfers:read`).**
   PRD R9 + ARCHITECTURE §4 scope table ("POST `/transfers` → `transfers:write`") + README endpoints table + the file's own header comment `src/routes/transfers.ts:5` ("POST /transfers -> transfers:write")
   **vs** `src/routes/transfers.ts:38` `requireScope('transfers:read')`. A read-only token can post transfers; a write-only token is rejected.

6. **DRIFT: Idempotency body-match logic is inverted (matching body → 409; different body → replay).**
   PRD R10 + ARCHITECTURE §9 ("a matching body replays the stored status+body; a different body is 409")
   **vs** `src/middleware/idempotency.ts:52-57`: `if (existing.request_hash === requestHash) { throw 409 }` then replays in the else path. A correct retry (same key, same body) gets a 409; a key reused with a *different* body silently replays the old response. Exactly backwards.

7. **DRIFT: Rate limiter is keyed per client IP, not per account/token.**
   PRD R11 ("per authenticated account/token, NOT per client IP") + ARCHITECTURE §10 ("keyed by **token id**… not IP") + CONTEXT ("per account/token, not per IP. A client cannot get more throughput by rotating IPs") + README + the file's own header comment `src/middleware/rateLimit.ts:3` ("keyed by the authenticated TOKEN id… NOT by client IP")
   **vs** `src/middleware/rateLimit.ts:28` `const key = req.ip ?? 'unknown';`. A client can in fact get more throughput by rotating IPs — the precise failure the docs promise against. (The header comment at line 27 even asserts "req.token is always set here," yet the token is never used for the key.)

8. **DRIFT: The `transfer.failed` audit action is never written; only 4 of the 5 claimed actions exist.**
   PRD R12 + README ("Every state change (`account.created`, `account.closed`, `transfer.posted`, `transfer.settled`, `transfer.failed`)…") + `src/types.ts:16-21` enum (lists all 5) + IMPLEMENTATION_PLAN Phase 6 acceptance ("All five audit actions appear")
   **vs** code emits only `account.created` (`services/accounts.ts:22`), `account.closed` (`services/accounts.ts:96`), `transfer.posted` (`services/transfers.ts:147`), `transfer.settled` (`routes/transfers.ts:69`). `transfer.failed` is declared in the type union but `recordAudit('transfer.failed', …)` is never called anywhere.

9. **DRIFT: CONTEXT claims a token-management API shipped ("Phase 7… Done"); it does not exist, and CONTEXT contradicts itself.**
   `CONTEXT.md:31-32` ("Phase 7 — token-management endpoints (`POST /tokens`, `DELETE /tokens/:id`)… Done.")
   **vs** no such routes exist: `src/index.ts:20-21` mounts only `/accounts` and `/transfers`; there is no `src/routes/tokens.ts`. Directly contradicted by `CONTEXT.md:67` ("What's next (not built): A token-management endpoint (tokens are seeded out of band today)"), by PRD §3 non-goals ("tokens are provisioned out of band"), and by IMPLEMENTATION_PLAN "Out of scope (v1)" ("a token-management API").

10. **DRIFT: Idempotency TTL is ~24 minutes, not 24 hours.**
    PRD R10 ("24-hour window") + CONTEXT ("Idempotency TTL 24h") + README ("24 hours") + ARCHITECTURE §9/§12 ("`86400000` ms (24h)")
    **vs** `src/config.ts:50` `ttlMs: 24 * 60 * 1000` = 1,440,000 ms = **24 minutes**. The inline comment on the same line even asserts "`86400000 ms = 24h`", but the arithmetic is missing a `* 60`.

11. **DRIFT: Rate-limit max is 100, not 60.**
    PRD R11 + CONTEXT ("60 / 60s") + README ("60 requests per 60 seconds") + ARCHITECTURE §10/§12 ("`max = 60`")
    **vs** `src/config.ts:43` `max: 100`. The comment on `src/config.ts:39-40` even says "60 mutating requests per rolling 60s window."

12. **DRIFT: Default list page size is 10, not 25.**
    PRD R2 ("default page size MUST be **25**") + CONTEXT + README + ARCHITECTURE §8/§12 + IMPLEMENTATION_PLAN Phase 3 ("default limit **25**")
    **vs** `src/config.ts:35` `defaultLimit: 10`. (Max limit 100 is correct.)

13. **DRIFT: Webhook backoff is 1s/3s/9s, not 1s/2s/4s.**
    PRD R7 + CONTEXT ("1s/2s/4s") + README ("1s / 2s / 4s") + ARCHITECTURE §7/§12 ("`[1000, 2000, 4000]`")
    **vs** `src/config.ts:58` `backoffMs: [1000, 3000, 9000]`. The comment on `src/config.ts:54-55` still says "1s, 2s, 4s." (Note: `services/webhook.ts:6` comment also restates the correct `[1000,2000,4000]`, so the service comment is right and the config value is wrong.)

14. **DRIFT (doc vs doc, internal to architecture): webhook per-attempt timeout 5000 vs 10000.**
    ARCHITECTURE §7 ("`config.webhook.timeoutMs = 5000`") and code `src/config.ts:59` (`timeoutMs: 5000`, matches PRD R7's 5s)
    **vs** ARCHITECTURE §12 config table ("Webhook per-attempt timeout `10000` ms"). The §12 row is the outlier; code and §7 and PRD agree on 5000.

15. **DRIFT (minor, doc self-count): CONTEXT says "All six build phases are complete."**
    `CONTEXT.md:18` ("All six build phases are complete")
    **vs** the same section then lists Phase 0 through Phase 7 — eight entries (and IMPLEMENTATION_PLAN defines Phase 0–6, i.e. seven). The count "six" matches neither, and Phase 7 is the non-existent token API from #9.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The docs (PRD, ARCHITECTURE, IMPLEMENTATION_PLAN) form a coherent, mutually consistent spec — the divergence is overwhelmingly **code that quietly violates its own spec**, plus one self-contradicting status doc (CONTEXT). Fifteen concrete drifts, several correctness- or security-critical. Most important first:

1. **#1 — Balance invariant broken; money is fabricated.** Destination cached balance is bumped by gross `amount` while its entry is `net`; every transfer with a fee leaves the ledger internally unbalanced by `fee`. This defeats the central guarantee of a double-entry ledger (R5) and is the single most serious finding.
2. **#5 — `POST /transfers` requires `transfers:read` instead of `transfers:write`.** An authorization hole: read-scoped tokens can move money; write-scoped tokens can't.
3. **#6 — Idempotency logic inverted.** Honest retries get 409; a different body silently replays a stale response — the opposite of R10, and dangerous for a payments API.
4. **#7 — Rate limit keyed by IP, not token.** Breaks R11 and the explicit "can't beat the limit by rotating IPs" promise.
5. **#3 / #4 — Wrong fee (190 vs 290 bps) and wrong rounding (half-up vs HALF_EVEN).** Direct financial drift; #4 even contradicts the function's own worked example.
6. **#10 / #11 / #12 / #13 — Config constants silently wrong** (TTL 24min vs 24h; rate max 100 vs 60; default page 10 vs 25; backoff 1/3/9 vs 1/2/4), each with an adjacent comment that still states the correct value — classic value-vs-comment drift in `src/config.ts`.
7. **#2 — `GET /transfers` returns oldest-first with a mismatched cursor predicate** (paging broken), vs the newest-first spec the accounts list correctly implements.
8. **#9 — CONTEXT claims a token-management API shipped** ("Phase 7… Done") that does not exist and that CONTEXT itself, the PRD, and the plan all say is not built.
9. **#8 — `transfer.failed` audit action never emitted** (4 of 5 claimed actions).
10. **#14 / #15 — Doc-internal inconsistencies** (architecture webhook timeout 5000 vs 10000; CONTEXT "six phases" miscount).

No schema drift, and the health endpoint, port, pool size, entry-balancing math, atomic-transaction structure, and FOR-UPDATE lock ordering all match the docs.

---

#### Gate Verdict

```text
VERDICT: FAIL
DIMENSIONS:
  - Brief -> Architecture: PASS
  - Architecture -> Plan: PASS
  - Status/Docs -> Code: FAIL
RIGOR: tuned
```

**BLOCKING:**
- `src/services/transfers.ts:136-139`: destination balance updated by gross `amount` while entry is `net` — breaks R5 balance invariant (money created).
- `src/routes/transfers.ts:38`: POST /transfers requires `transfers:read` instead of `transfers:write` — authz hole (R9).
- `src/middleware/idempotency.ts:52-57`: body-match logic inverted — violates R10.
- `src/middleware/rateLimit.ts:28`: limiter keyed by `req.ip`, not token id — violates R11.
- `src/services/transfers.ts:31`: `FEE_BPS = 190`, spec is 290 (R8).
- `src/utils/money.ts:35-37`: round-half-up, not HALF_EVEN (R8).
- `src/config.ts:35,43,50,58`: defaultLimit 10 (≠25), rate max 100 (≠60), idempotency TTL 24min (≠24h), backoff [1000,3000,9000] (≠[1000,2000,4000]).
- `src/routes/transfers.ts:103`: `GET /transfers` orders ASC (oldest-first), spec is newest-first (R6).
- `CONTEXT.md:31-32`: claims token-management API "Done"; not built and self-contradicted at `CONTEXT.md:67`.

---

#### Open Questions
- Is this fixture *intended* to contain seeded drift (it reads like a drift-detection corpus)? If so, the above is the catalog; if not, every BLOCKING item is a live defect.
- In `src/config.ts`, are the comments or the values meant to be authoritative? They disagree on four constants (TTL, rate max, page size, backoff).

#### Verification Evidence
- Read all five docs and all 17 source files on disk. No tests present to run (no `test` script in `package.json`, no test files under `src/`), so findings are by static cross-reading of doc claims against code — stated as such rather than asserted as proven by execution.
- Schema (`src/db/schema.sql`) cross-checked column-by-column against ARCHITECTURE §3: consistent (no schema drift).

#### Residual Risk
- `transfer.failed` is never emitted, so failure auditing (R12) remains unverifiable even after the balance bug is fixed.
- `GET /transfers` ASC + `<` cursor likely returns wrong/empty pages rather than erroring, masking the bug from smoke tests.
- The idempotency wrapper persists `res.statusCode` at `res.json` time — correct for current handlers but fragile if a future handler sets status after calling `json`.
