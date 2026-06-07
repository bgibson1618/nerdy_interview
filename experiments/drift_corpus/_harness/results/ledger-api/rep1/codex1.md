### 1. Source Brief -> Architecture

- R1 — Create and read accounts: Addressed. PRD requires `POST /accounts`, `GET /accounts/:id`, `currency`, zero `balance`, and `active` status (PRD.md:52-56); architecture defines the accounts table and `/accounts` routes (ARCHITECTURE.md:66-75, 134-145).
- R2 — List accounts: Addressed architecturally. PRD requires cursor pagination, newest-first, `{ data, next_cursor }`, default 25/max 100 (PRD.md:58-63); architecture specifies keyset pagination with those limits (ARCHITECTURE.md:196-203).
- R3 — Soft-delete accounts: Addressed. PRD requires `DELETE /accounts/:id`, `status='closed'`, `closed_at`, retained rows, and 409 guards (PRD.md:65-70); architecture covers the schema and soft-delete route (ARCHITECTURE.md:66-75, 136-145).
- R4 — Post a transfer: Addressed architecturally. PRD requires `POST /transfers`, active same-currency accounts, balanced entries, cached balance updates, and one transaction (PRD.md:72-78); architecture describes `withTransaction`, account locks, entries, balance updates, and posted audit row in one transaction (ARCHITECTURE.md:151-172).
- R5 — Balance invariant: Addressed architecturally. PRD requires cached balance to equal credits minus debits and insufficient funds to return 422 (PRD.md:80-84); architecture describes the invariant and 422 check (ARCHITECTURE.md:160-168).
- R6 — Read transfers and history: Partially addressed / under-specified. PRD names `GET /transfers/:id` and `GET /transfers` and says clients can reconstruct account history from immutable entries (PRD.md:86-89); architecture provides transfer list/read routes (ARCHITECTURE.md:134-145) but does not define an entries API, account-specific history API, or response shape that exposes immutable entry rows.
- R7 — Settlement webhook: Partially addressed, with an internal architecture contradiction. PRD requires 4 attempts, 1s/2s/4s backoff, 5s timeout, HMAC signature, post-commit delivery, `settled` on success and `posted` otherwise (PRD.md:91-99); architecture section 7 matches that (ARCHITECTURE.md:184-194), but architecture key config later says webhook timeout is `10000` ms (ARCHITECTURE.md:242-245), contradicting the PRD's 5s.
- R8 — Fees and rounding: Addressed architecturally. PRD requires 290 bps, HALF_EVEN, source debited gross, destination credited net, fee account credited fee (PRD.md:101-107); architecture states the same (ARCHITECTURE.md:174-182).
- R9 — Token auth with scopes: Addressed architecturally. PRD requires bearer auth on non-health endpoints, 401 vs 403, and four scopes (PRD.md:109-114); architecture maps scopes per endpoint and describes `requireScope` (ARCHITECTURE.md:126-149).
- R10 — Idempotent writes: Addressed architecturally. PRD requires `Idempotency-Key` on `POST /accounts` and `POST /transfers`, 24h replay, and body mismatch 409 (PRD.md:116-120); architecture describes that middleware contract (ARCHITECTURE.md:205-212).
- R11 — Per-account rate limiting: Partially addressed / under-specified. PRD requires 60 writes per rolling 60s per authenticated account/token, not IP (PRD.md:122-126); architecture says the limiter is keyed by token id but labels this "per account" (ARCHITECTURE.md:214-219), while the `api_tokens` schema has no account association (ARCHITECTURE.md:56-64).
- R12 — Immutable audit log: Partially addressed / under-specified. PRD requires audit actions including `transfer.failed` and immutable append-only rows (PRD.md:128-133); architecture has `audit_events` and `recordAudit` (ARCHITECTURE.md:116-124, 221-227), but it defines no failed-transfer transition even though R7 says webhook failure leaves the transfer `posted` (PRD.md:97-99).
- R13 — Health check: Addressed. PRD requires unauthenticated `GET /health` returning `{ "status": "ok" }` (PRD.md:135-137); architecture includes that route (ARCHITECTURE.md:47-49, 136-145).

### 2. Architecture -> Delivery Plan

The implementation plan mostly follows the architecture's component map in a coherent order: skeleton, data layer, auth, accounts, transfer engine, idempotency/rate limiting, webhook, and audit (IMPLEMENTATION_PLAN.md:6-99 vs ARCHITECTURE.md:18-45).

Gaps and risky plan assumptions:

- The plan excludes a token-management API as v1 out of scope (IMPLEMENTATION_PLAN.md:100-103), matching PRD non-goals (PRD.md:41-45) and the architecture's lack of `/tokens`; this conflicts with CONTEXT's later "Phase 7" shipped claim.
- Phase 6 acceptance says "All five audit actions appear" (IMPLEMENTATION_PLAN.md:96-98), but the architecture has no task or transition that would produce `transfer.failed`; R7 says failed webhook delivery leaves the transfer `posted` (PRD.md:97-99).
- The plan says every referenced constant lives in `src/config.ts` (IMPLEMENTATION_PLAN.md:3-4), but it has no acceptance task that checks config values against PRD/architecture constants; this allowed core constants to drift in code.
- The plan repeats webhook 5s timeout (IMPLEMENTATION_PLAN.md:89-94), but architecture's key-config table says `10000` ms (ARCHITECTURE.md:242-245). The plan does not resolve that architecture contradiction.
- Phase 5 acceptance checks idempotency replay and rate limiting only at a high level (IMPLEMENTATION_PLAN.md:83-85); it does not explicitly require testing same-body vs different-body idempotency branches or verifying the limiter key is token/account rather than IP.
- Phase 5 delivery says `GET /transfers` is cursor-paged (IMPLEMENTATION_PLAN.md:80-81), but the acceptance criteria do not restate newest-first ordering from R6, leaving a gap for the code's ascending-order implementation.

### 3. Delivery/Status -> Code

1. DRIFT: CONTEXT says "All six build phases are complete" (CONTEXT.md:16-18) vs the same list contains Phase 0 through Phase 7, and IMPLEMENTATION_PLAN only defines Phase 0 through Phase 6 (CONTEXT.md:20-32; IMPLEMENTATION_PLAN.md:6-99).
2. DRIFT: CONTEXT claims Phase 7 token-management endpoints `POST /tokens` and `DELETE /tokens/:id` are done (CONTEXT.md:31-32) vs PRD says tokens are provisioned out of band, the plan says token-management API is out of scope, and `index.ts` mounts only `/health`, `/accounts`, and `/transfers` (PRD.md:43-45; IMPLEMENTATION_PLAN.md:100-103; src/index.ts:14-21).
3. DRIFT: CONTEXT says token-management endpoints are done (CONTEXT.md:31-32) vs the same CONTEXT says "A token-management endpoint" is "not built" and tokens are seeded out of band today (CONTEXT.md:65-68).
4. DRIFT: PRD, CONTEXT, README, architecture, and plan claim list default page size is 25 (PRD.md:58-63; CONTEXT.md:23-24; README.md:71-72; ARCHITECTURE.md:196-203; IMPLEMENTATION_PLAN.md:50-52) vs `src/config.ts` sets `pagination.defaultLimit` to 10 (src/config.ts:34-36).
5. DRIFT: PRD, CONTEXT, README, architecture, and plan claim rate limiting is 60 requests per 60 seconds (PRD.md:122-126; CONTEXT.md:27-28; README.md:80-84; ARCHITECTURE.md:214-219; IMPLEMENTATION_PLAN.md:75-85) vs `src/config.ts` sets `rateLimit.max` to 100 (src/config.ts:41-44).
6. DRIFT: PRD, CONTEXT, README, architecture, and plan claim idempotency TTL is 24h (PRD.md:116-120; CONTEXT.md:27-28; README.md:74-78; ARCHITECTURE.md:205-212; IMPLEMENTATION_PLAN.md:75-85) vs `src/config.ts` sets `ttlMs` to `24 * 60 * 1000`, which is 24 minutes, despite the stale inline comment saying 24h (src/config.ts:46-51).
7. DRIFT: PRD, CONTEXT, README, architecture, and plan claim webhook backoff is 1s/2s/4s (PRD.md:91-95; CONTEXT.md:29-30; README.md:86-92; ARCHITECTURE.md:184-190; IMPLEMENTATION_PLAN.md:87-94) vs `src/config.ts` sets `[1000, 3000, 9000]` ms (src/config.ts:53-59).
8. DRIFT: Architecture key-config table claims webhook per-attempt timeout is `10000` ms (ARCHITECTURE.md:242-245) vs PRD, README, implementation plan, architecture section 7, and code use 5s/5000ms (PRD.md:91-95; README.md:86-92; IMPLEMENTATION_PLAN.md:87-94; ARCHITECTURE.md:184-190; src/config.ts:59).
9. DRIFT: PRD, CONTEXT, architecture, README, and plan claim the fee is 290 bps / 2.9% (PRD.md:101-107; CONTEXT.md:25-26; ARCHITECTURE.md:160-182; README.md:47-53; IMPLEMENTATION_PLAN.md:55-68) vs `src/services/transfers.ts` sets `FEE_BPS = 190` (src/services/transfers.ts:30-31).
10. DRIFT: PRD and architecture claim HALF_EVEN rounding where exact halves round to the nearest even integer (PRD.md:101-105; ARCHITECTURE.md:174-180) vs `computeFee` returns `quotient + 1` for every exact half, including cases where the quotient is already even (src/utils/money.ts:23-37).
11. DRIFT: PRD, CONTEXT, README, architecture, and plan claim destination is credited `amount - fee` and cached balances match entries (PRD.md:80-84, 101-107; CONTEXT.md:39-41; README.md:47-53; ARCHITECTURE.md:162-168; IMPLEMENTATION_PLAN.md:66-70) vs transfer code inserts a net destination entry but updates the destination account balance by the full gross `amount` (src/services/transfers.ts:116-120, 136-139).
12. DRIFT: PRD, README, architecture, and route comments claim `POST /transfers` requires `transfers:write` (PRD.md:109-114; README.md:31-42; ARCHITECTURE.md:136-145; src/routes/transfers.ts:3-8) vs the actual route middleware requires `transfers:read` (src/routes/transfers.ts:36-40).
13. DRIFT: PRD, README, architecture, and plan claim an idempotency replay with the same body returns the stored response and a different body returns 409 (PRD.md:116-120; README.md:74-78; ARCHITECTURE.md:205-212; IMPLEMENTATION_PLAN.md:75-85) vs `idempotency.ts` throws 409 when `existing.request_hash === requestHash` and replays the stored response when the body hash differs (src/middleware/idempotency.ts:49-57).
14. DRIFT: PRD, CONTEXT, README, architecture, and plan claim mutating rate limits are per account/token, not per IP (PRD.md:122-126; CONTEXT.md:46-47; README.md:80-84; ARCHITECTURE.md:214-219; IMPLEMENTATION_PLAN.md:75-85) vs `rateLimitPerAccount` keys buckets by `req.ip` (src/middleware/rateLimit.ts:22-30).
15. DRIFT: PRD and architecture require `GET /transfers` to be cursor-paginated newest-first (PRD.md:86-89; ARCHITECTURE.md:196-203) vs the transfer list query orders by `created_at ASC, id ASC` (src/routes/transfers.ts:101-105).
16. DRIFT: IMPLEMENTATION_PLAN Phase 6 acceptance says all five audit actions appear, including `transfer.failed` (IMPLEMENTATION_PLAN.md:96-98), and PRD lists `transfer.failed` as an audit action (PRD.md:128-133) vs code only records `account.created`, `account.closed`, `transfer.posted`, and `transfer.settled`; no code path records `transfer.failed` (src/services/accounts.ts:21-23, 91-97; src/services/transfers.ts:147-152; src/routes/transfers.ts:63-72; src/services/audit.ts:14-27).
17. DRIFT: README claims clients can "read an immutable audit trail" (README.md:3-5) vs the endpoint table and Express app expose no audit-read endpoint, only `/health`, `/accounts`, and `/transfers` (README.md:31-42; src/index.ts:14-21).
18. DRIFT: PRD says transfer read/list endpoints let clients reconstruct account history from immutable entries (PRD.md:86-89) vs code exposes transfer rows only and has no entries route or account-history route (src/routes/transfers.ts:82-133; src/index.ts:20-21).

### 4. Verdict

SIGNIFICANT DRIFT.

VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: FAIL
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/config.ts: core documented constants for pagination, rate limiting, idempotency TTL, and webhook backoff diverge from the docs.
  - src/services/transfers.ts: fee basis points and cached balance updates violate the documented fee and balance-invariant behavior.
  - src/middleware/idempotency.ts: replay/conflict behavior is inverted relative to the PRD, README, architecture, and plan.
  - src/routes/transfers.ts: `POST /transfers` is protected by `transfers:read` instead of the documented `transfers:write`.
  - CONTEXT.md: shipped-status claims invent token-management endpoints and contradict both the source brief and the same file's "not built" list.
RIGOR: tuned

Most important issues, in order: transfer correctness is not aligned with the money requirements; write safety controls are materially wrong (idempotency, rate limit key, rate limit max, TTL); the shipped-status docs are stale around token management; and list/history surfaces overclaim what the code exposes. I did not run build/tests because this review was scoped as a static, no-project-writes drift review and `tsconfig.json` emits to `dist/` by default (tsconfig.json:6-14).
