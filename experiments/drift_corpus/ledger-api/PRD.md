# ledger-api — Product Requirements

## 1. Overview

ledger-api is a backend service for moving money between accounts using
**double-entry bookkeeping**. Every movement of value is recorded as a balanced
set of ledger **entries** (debits and credits that sum to zero), grouped into a
**transfer**. The service exposes a small JSON-over-HTTP API for creating
accounts, posting transfers, reading balances and history, and receiving
settlement notifications via webhook.

The service is backend-only. Any client (web, CLI, partner integration) consumes
it over HTTP using a bearer token scoped to specific operations.

### 1.1 Money representation

All monetary amounts are **integer minor units** (e.g. cents for USD). The API
never accepts or returns fractional amounts. Fractions can only arise when a
*rate* is applied (the per-transfer fee); the single rounding rule for that case
is defined in R8.

### 1.2 Glossary

| Term       | Meaning                                                            |
|------------|-------------------------------------------------------------------|
| Account    | A balance in exactly one currency. Soft-deletable ("closed").     |
| Entry      | One immutable debit or credit against one account.                |
| Transfer   | A balanced group of entries moving value between accounts.        |
| Fee        | Basis-point cut withheld from the destination of a transfer.      |
| Settlement | Confirmation that downstream systems accepted a posted transfer.  |
| Scope      | A capability a bearer token grants (e.g. `transfers:write`).      |

## 2. Goals

- Guarantee that the ledger is always internally consistent (balanced).
- Make transfers **atomic** — they fully happen or not at all.
- Make writes **idempotent** so clients can safely retry.
- Provide a complete, immutable **audit trail** of every state change.
- Keep the API surface small, predictable, and cursor-paginated.

## 3. Non-goals

- No currency conversion / FX. A transfer is single-currency end to end.
- No user/identity management; tokens are provisioned out of band.
- No partial / scheduled / recurring transfers in v1.
- No UI.

## 4. Requirements

Each requirement is numbered and independently checkable.

**R1 — Create and read accounts.**
The API MUST expose `POST /accounts` to create an account and
`GET /accounts/:id` to read one. A new account is created with a single ISO 4217
alphabetic `currency` (three uppercase letters), an initial `balance` of `0`
minor units, and `status` `active`.

**R2 — List accounts (cursor pagination).**
The API MUST expose `GET /accounts` returning accounts ordered newest-first.
Pagination MUST be **cursor based** (keyset), never offset/page. The response
envelope MUST be `{ data: Account[], next_cursor: string | null }`, where
`next_cursor` is `null` on the last page. The default page size MUST be **25**
and the maximum **100**.

**R3 — Soft-delete (close) accounts.**
The API MUST expose `DELETE /accounts/:id`, which **soft-deletes**: it sets
`status` to `closed` and records `closed_at`, but RETAINS the row and all its
entries. Closing MUST be rejected (`409`) if the account is already closed or
its `balance` is non-zero. Closed accounts MUST NOT be usable as a transfer
source or destination.

**R4 — Post a transfer (double-entry, atomic).**
The API MUST expose `POST /transfers` accepting `source_account_id`,
`destination_account_id`, and an integer `amount` in minor units. Posting MUST
record balanced ledger entries and update cached balances **atomically in a
single database transaction**: either all rows (transfer, entries, balance
updates, audit row) commit, or none do. A transfer MUST move value only between
two **active** accounts of the **same currency**.

**R5 — Balance invariant.**
For every account, the cached `balance` MUST always equal
`SUM(credit entries) − SUM(debit entries)` for that account. A debit lowers a
balance; a credit raises it. A transfer MUST NOT be posted if the source's
balance is less than the transfer `amount` (insufficient funds → `422`).

**R6 — Read transfers and history.**
The API MUST expose `GET /transfers/:id` and `GET /transfers` (cursor
paginated, newest-first, same envelope as R2). These let clients reconstruct
account history from the immutable entries.

**R7 — Settlement webhook with retry + backoff.**
After a transfer is posted, the service MUST attempt to deliver a
`transfer.settled` notification to the configured webhook endpoint. Delivery
MUST use at most **4 attempts** (1 initial + 3 retries) with **exponential
backoff of 1s, 2s, 4s** between attempts, each attempt timing out after **5s**.
The body MUST be signed with HMAC-SHA256 and sent in the `X-Ledger-Signature`
header. The webhook MUST run **after** the post transaction commits, so a
delivery failure never rolls back a posted transfer. On success the transfer
becomes `settled`; otherwise it remains `posted`.

**R8 — Fees and rounding.**
Every transfer withholds a platform fee of **290 basis points (2.9%)** of the
`amount`, computed as `amount × bps / 10000` and rounded to the nearest whole
minor unit using **HALF_EVEN (banker's rounding)** — exact halves round to the
nearest even integer. The destination is credited `amount − fee`; the fee is
credited to the platform fee account. The source is always debited the full
`amount`.

**R9 — Token auth with per-endpoint scopes.**
Every non-health endpoint MUST require a valid bearer token (`Authorization:
Bearer <token>`). A missing or revoked token yields `401`. Each endpoint
declares the single scope it requires; a valid token lacking that scope yields
`403`. The scopes are `accounts:read`, `accounts:write`, `transfers:read`, and
`transfers:write`.

**R10 — Idempotent writes.**
`POST /accounts` and `POST /transfers` MUST require an `Idempotency-Key` header
(`400` if absent). A repeated key within a **24-hour** window MUST replay the
original stored response without re-executing. A key reused with a *different*
request body MUST return `409`. After 24 hours the key may be reused.

**R11 — Per-account rate limiting.**
Mutating endpoints (the two `POST`s) MUST be rate limited **per authenticated
account/token**, NOT per client IP, at **60 requests per rolling 60-second
window**. The request that exceeds the limit MUST return `429`. Read endpoints
are NOT rate limited.

**R12 — Immutable audit log.**
Every state change MUST append exactly one immutable row to an audit log:
`account.created`, `account.closed`, `transfer.posted`, `transfer.settled`,
`transfer.failed`. Audit rows MUST NEVER be updated or deleted. For a transfer,
the `transfer.posted` audit row MUST be written inside the same transaction as
the transfer (R4), so it shares the transfer's atomicity.

**R13 — Health check.**
The API MUST expose an unauthenticated `GET /health` returning
`{ "status": "ok" }` for liveness probes.

## 5. Acceptance summary

| Req | Surface / behavior verified                                          |
|-----|---------------------------------------------------------------------|
| R1  | `POST /accounts`, `GET /accounts/:id`; balance starts at 0          |
| R2  | `GET /accounts` cursor paging; default 25 / max 100; `next_cursor`  |
| R3  | `DELETE /accounts/:id` soft-delete; row retained; guards            |
| R4  | `POST /transfers` atomic single-transaction double-entry            |
| R5  | balance == credits − debits; insufficient funds → 422               |
| R6  | `GET /transfers/:id`, `GET /transfers` cursor paging                |
| R7  | webhook 4 attempts, 1s/2s/4s backoff, 5s timeout, HMAC sig          |
| R8  | fee 290 bps, HALF_EVEN rounding; net = amount − fee                 |
| R9  | bearer token; per-endpoint scopes; 401 vs 403                       |
| R10 | Idempotency-Key required; 24h replay; body-mismatch → 409           |
| R11 | per-account rate limit 60 / 60s; 429; reads unlimited               |
| R12 | append-only audit log; posted-audit inside the transfer txn         |
| R13 | `GET /health` → `{status:"ok"}`                                     |
