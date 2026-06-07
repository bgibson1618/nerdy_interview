VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: FAIL
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/config.ts: Spec-critical constants drift from docs: default pagination, rate-limit max, idempotency TTL, and webhook backoff are wrong.
  - src/routes/transfers.ts: POST /transfers requires transfers:read instead of transfers:write.
  - src/middleware/idempotency.ts: idempotency replay/conflict behavior is reversed.
  - src/services/transfers.ts: fee bps and cached balance updates violate the documented transfer invariant.
RIGOR: tuned

### 1. Source Brief -> Architecture

R1 - Create and read accounts: Addressed. ARCHITECTURE.md defines accounts schema, routes, and account lifecycle for POST /accounts and GET /accounts/:id.

R2 - List accounts: Addressed in architecture, including cursor/keyset pagination, newest-first ordering, default 25, max 100, and `{ data, next_cursor }` envelope.

R3 - Soft-delete accounts: Addressed. Architecture specifies `status='closed'`, `closed_at`, row retention, non-zero/already-closed guards, and active-account validation for transfers.

R4 - Post a transfer: Addressed at the architecture level. The transfer engine is specified as a single `withTransaction` flow that inserts transfer, entries, balance updates, and posted audit row atomically.

R5 - Balance invariant: Addressed in architecture. Cached balance is defined as credits minus debits, and transfer validation includes sufficient funds.

R6 - Read transfers and history: Addressed. Architecture includes GET /transfers/:id and GET /transfers with the same cursor envelope.

R7 - Settlement webhook: Addressed, but ARCHITECTURE.md is internally contradictory on timeout: Section 7 says 5000 ms while the key config table says 10000 ms.

R8 - Fees and rounding: Addressed. Architecture specifies 290 bps, HALF_EVEN, destination net, source gross debit, and fee account credit.

R9 - Token auth with scopes: Addressed. Architecture lists all required scopes and 401 vs 403 behavior.

R10 - Idempotent writes: Addressed. Architecture specifies Idempotency-Key requirement, 24h replay, body mismatch 409, and persisted response storage.

R11 - Per-account rate limiting: Addressed at the architecture level. It specifies token-id keying, 60 requests per 60000 ms, 429, and POST-only mounting.

R12 - Immutable audit log: Partially addressed. Architecture covers append-only insertion and transaction-aware `transfer.posted`, but it does not specify when `transfer.failed` is emitted even though PRD.md requires an audit row for that action.

R13 - Health check: Addressed. Architecture includes unauthenticated GET /health returning `{ status: "ok" }`.

### 2. Architecture -> Delivery Plan

The plan mostly follows the architecture through phases 0-6, but it has coherence gaps:

- Phase 6 acceptance says "All five audit actions appear" (IMPLEMENTATION_PLAN.md:96-98), while the phase deliverables only add `deliverSettlement`, `recordAudit`, and settlement success handling (IMPLEMENTATION_PLAN.md:89-94). There is no planned path for `transfer.failed`, matching the architecture's under-specification of when that state change occurs.
- The architecture's key config table says webhook timeout is 10000 ms (ARCHITECTURE.md:244), while the architecture narrative and Phase 6 plan both say 5000 ms (ARCHITECTURE.md:189-190; IMPLEMENTATION_PLAN.md:89-91).
- The delivery plan keeps token management out of scope (IMPLEMENTATION_PLAN.md:100-103), which is coherent with PRD.md's "tokens are provisioned out of band" non-goal (PRD.md:43-45), but it conflicts with CONTEXT.md's later Phase 7 shipped-status claim.
- The plan relies on `src/config.ts` as the place where all cited constants live (IMPLEMENTATION_PLAN.md:3-4, 12). That is coherent as a plan, but it makes config drift especially high-risk because the docs repeatedly treat those values as source-of-truth constants.

### 3. Delivery/Status -> Code

1. DRIFT: PRD.md:62-63, ARCHITECTURE.md:202-203, IMPLEMENTATION_PLAN.md:50-52, CONTEXT.md:23-24/60, and README.md:71-72 claim list default limit is 25 vs src/config.ts:34-36 sets `pagination.defaultLimit` to 10.
2. DRIFT: PRD.md:122-125, ARCHITECTURE.md:216-218, IMPLEMENTATION_PLAN.md:78-85, CONTEXT.md:27-28/61, and README.md:82-83 claim rate limit is 60 requests per 60s vs src/config.ts:41-44 sets `rateLimit.max` to 100.
3. DRIFT: PRD.md:122-125, ARCHITECTURE.md:216-217, CONTEXT.md:46-47, and README.md:82-83 claim rate limiting is per account/token and not IP vs src/middleware/rateLimit.ts:27-30 keys the limiter by `req.ip`.
4. DRIFT: PRD.md:116-120, ARCHITECTURE.md:207-211/241, IMPLEMENTATION_PLAN.md:76-77, CONTEXT.md:27/62, and README.md:76-78 claim idempotency replay lasts 24 hours vs src/config.ts:49-50 sets `ttlMs` to `24 * 60 * 1000`, which is 24 minutes.
5. DRIFT: src/config.ts:46-50 comments claim the idempotency TTL is 24h / 86400000 ms vs the code expression at src/config.ts:50 evaluates to 1440000 ms.
6. DRIFT: PRD.md:116-120, ARCHITECTURE.md:207-211, IMPLEMENTATION_PLAN.md:83-85, and README.md:76-78 claim a repeated key with the same body replays the stored response vs src/middleware/idempotency.ts:49-57 throws 409 when `existing.request_hash === requestHash`.
7. DRIFT: PRD.md:116-120, ARCHITECTURE.md:209-210, IMPLEMENTATION_PLAN.md:76-77, and README.md:76-78 claim a reused key with a different body returns 409 vs src/middleware/idempotency.ts:52-57 replays the stored response when the hash does not match.
8. DRIFT: PRD.md:109-114, ARCHITECTURE.md:136-145, IMPLEMENTATION_PLAN.md:35-37, and README.md:33-42 claim POST /transfers requires `transfers:write` vs src/routes/transfers.ts:36-40 mounts `requireScope('transfers:read')`.
9. DRIFT: PRD.md:101-107, ARCHITECTURE.md:162/180/236, IMPLEMENTATION_PLAN.md:60-64, CONTEXT.md:25-26/59, and README.md:49-53 claim fee is 290 bps vs src/services/transfers.ts:30-31 sets `FEE_BPS = 190`.
10. DRIFT: PRD.md:101-105, ARCHITECTURE.md:176-180, IMPLEMENTATION_PLAN.md:57-59, CONTEXT.md:36-38, and README.md:49-51 claim HALF_EVEN exact halves round to nearest even vs src/utils/money.ts:35-36 always returns `quotient + 1` on an exact half.
11. DRIFT: PRD.md:80-84, ARCHITECTURE.md:164-167, IMPLEMENTATION_PLAN.md:66-70, CONTEXT.md:39-41, and README.md:49-53 claim destination balance/credit is `amount - fee` and cached balances match entries vs src/services/transfers.ts:117-120 records destination entry as `net` but src/services/transfers.ts:136-139 updates destination balance by full `amount`.
12. DRIFT: PRD.md:86-89, ARCHITECTURE.md:198-203, CONTEXT.md:48-49, and README.md:65-72 claim GET /transfers is newest-first vs src/routes/transfers.ts:101-104 orders transfers by `created_at ASC, id ASC`.
13. DRIFT: PRD.md:91-99, ARCHITECTURE.md:186-190/243, IMPLEMENTATION_PLAN.md:89-91, CONTEXT.md:29-30/63, and README.md:88-90 claim webhook backoff is 1s/2s/4s or `[1000, 2000, 4000]` vs src/config.ts:56-59 sets `[1000, 3000, 9000]`.
14. DRIFT: ARCHITECTURE.md:184-190 says webhook timeout is 5000 ms vs ARCHITECTURE.md:229-245 key config table says webhook per-attempt timeout is 10000 ms.
15. DRIFT: PRD.md:128-133, IMPLEMENTATION_PLAN.md:96-98, and README.md:94-98 claim every state change includes a `transfer.failed` audit event vs `rg -n "recordAudit\\(" src` shows writes only for `account.created`, `account.closed`, `transfer.posted`, and `transfer.settled` (src/services/accounts.ts:22/96; src/services/transfers.ts:147-152; src/routes/transfers.ts:65-70).
16. DRIFT: CONTEXT.md:31-32 claims Phase 7 token-management endpoints `POST /tokens` and `DELETE /tokens/:id` are done vs src/index.ts:20-21 mounts only `/accounts` and `/transfers`, `rg -n "POST /tokens|DELETE /tokens|tokensRouter|/tokens" src` finds no token routes, and CONTEXT.md:65-68 plus IMPLEMENTATION_PLAN.md:100-103 say token-management is not built/out of scope.
17. DRIFT: CONTEXT.md:18 claims all six build phases are complete and coherent with the docs vs Phase 3/4/5/6 shipped claims conflict with code in the concrete ways listed above: pagination default, fee bps, HALF_EVEN, balance invariant, idempotency, rate limiting, transfer scope, webhook backoff, and audit coverage.

### 4. Verdict

SIGNIFICANT DRIFT

Most important issues:

1. Transfer correctness is not coherent with the requirements: code uses 190 bps instead of 290, exact-half rounding is wrong, and cached destination balances are updated by gross amount instead of net amount.
2. Security/API contract drift is material: POST /transfers requires `transfers:read`, not `transfers:write`.
3. Retry safety and throttling are materially different from docs: idempotency replay/conflict behavior is reversed, TTL is 24 minutes rather than 24 hours, rate limit is IP-keyed, and the cap is 100 rather than 60.
4. Listing and webhook behavior violate checkable API promises: transfers list oldest-first, and webhook backoff is 1s/3s/9s instead of 1s/2s/4s.
5. Status docs overclaim shipped work: Phase 7 token endpoints do not exist, and `transfer.failed` audit emission is claimed but not implemented.

Verification evidence: read CONTEXT.md, PRD.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, README.md, package.json, tsconfig.json, and all files under src/. Used `rg` for route/audit/token references. I did not run `npm run build` because it would write `dist/` outside the allowed verifier run directory.
