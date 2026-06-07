# ledger-api — Implementation Plan

Phased build. Each phase lists deliverables and acceptance criteria that map to
PRD requirements. All constants cited here live in `src/config.ts`.

## Phase 0 — Project skeleton

**Deliverables**
- `package.json` (Express + `pg`; `ts-node`/`typescript` dev deps), `tsconfig.json`.
- `src/index.ts` bootstrap with `express.json()` and the central error handler.
- `GET /health` → `{ status: "ok" }` (R13).
- `src/config.ts` holding every constant the docs reference.

**Acceptance**
- `npm run build` compiles; `GET /health` returns `{ "status": "ok" }`.

## Phase 1 — Data layer

**Deliverables**
- `src/db/pool.ts`: `pg` Pool (`max = 10`), `query()`, and `withTransaction()`.
- `src/db/schema.sql`: `api_tokens`, `accounts`, `transfers`, `entries`,
  `idempotency_keys`, `audit_events` (UUID PKs, BIGINT money columns).
- `src/types.ts`: domain types + enums (`AccountStatus`, `TransferStatus`,
  `EntryDirection`, `Scope`, `AuditAction`).

**Acceptance**
- Schema applies cleanly. `withTransaction` rolls back on a thrown error.

## Phase 2 — Auth & scopes (R9)

**Deliverables**
- `src/auth/tokens.ts`: `hashToken()` (SHA-256) and `requireScope(scope)`.
- Bearer parsing; 401 for missing/garbage/revoked; 403 for valid-but-unscoped.

**Acceptance**
- Each protected route requires exactly its declared scope (see ARCHITECTURE §4).
- A token missing the scope gets 403, not 401.

## Phase 3 — Accounts (R1, R2, R3)

**Deliverables**
- `src/services/accounts.ts`: `createAccount` (balance starts 0, currency
  validated as 3 uppercase letters), `getAccount`, `listAccounts`,
  `closeAccount`.
- `src/utils/cursor.ts`: opaque `(created_at, id)` cursor.
- `src/routes/accounts.ts`: `POST/GET/GET :id/DELETE`.
- Soft-delete: `DELETE /accounts/:id` sets `status='closed'` + `closed_at`,
  retains the row, rejects already-closed or non-zero-balance with 409.

**Acceptance**
- `GET /accounts` is cursor-paginated, newest-first, envelope
  `{ data, next_cursor }`, default limit **25**, max **100** (R2).
- Closing a non-empty account → 409; closed row still readable (R3).

## Phase 4 — Money & the transfer engine (R4, R5, R8)

**Deliverables**
- `src/utils/money.ts`: `computeFee(amount, bps)` using **HALF_EVEN** rounding;
  `netToDestination`.
- `src/services/transfers.ts`: `createTransfer` running inside
  `withTransaction`; locks accounts `FOR UPDATE` in id order; validates active +
  same-currency + sufficient funds; writes the `transfers` row, the
  debit/credit entries, balance updates, and the `transfer.posted` audit row —
  all atomically. `FEE_BPS = 290`.

**Acceptance**
- A transfer of `amount` debits the source `amount`, credits the destination
  `amount − fee`, and credits the fee account `fee` (R8).
- Forcing an error mid-transaction leaves the DB unchanged (R4).
- After any transfer, `balance == Σ credits − Σ debits` per account (R5).
- Source with `balance < amount` → 422 (R5).

## Phase 5 — Transfer routes, idempotency & rate limiting (R10, R11)

**Deliverables**
- `src/middleware/idempotency.ts`: require `Idempotency-Key` on both POSTs;
  24h replay; body-mismatch → 409.
- `src/middleware/rateLimit.ts`: per-**account/token** rolling window, **60 req
  / 60s**, 429 on exceed; mounted only on the POSTs.
- `src/routes/transfers.ts`: `POST /transfers`, `GET /transfers/:id`,
  `GET /transfers` (cursor paged).

**Acceptance**
- Replaying a POST with the same key returns the stored response, no re-exec.
- 61st mutating request from one account inside 60s → 429; reads unaffected.

## Phase 6 — Settlement webhook & audit (R7, R12)

**Deliverables**
- `src/services/webhook.ts`: `deliverSettlement` — up to **4 attempts**, backoff
  **1s/2s/4s**, **5s** per-attempt timeout, HMAC-SHA256 `X-Ledger-Signature`.
- `src/services/audit.ts`: append-only `recordAudit`, transaction-aware.
- Transfers route: after the post commits, attempt settlement; on success mark
  `settled` + write `transfer.settled` audit row.

**Acceptance**
- Webhook fires only after the transfer is committed (R7).
- All five audit actions appear; no audit row is ever updated/deleted (R12).

## Out of scope (v1)

- FX / currency conversion, scheduled/recurring transfers, a token-management
  API, any cache/Redis layer, any message queue.
