# ledger-api

A small double-entry ledger / payments backend. Create accounts, post transfers
that move money atomically with balanced debit/credit entries, withhold a fee,
get notified by a signed settlement webhook, and read an immutable audit trail.

- **Stack:** Node + TypeScript + Express + PostgreSQL (`pg`).
- **Money:** integer minor units only (e.g. cents).
- **Auth:** opaque bearer tokens with per-endpoint scopes.

## Quick start

```bash
npm install
# Apply the schema to your database:
psql "$DATABASE_URL" -f src/db/schema.sql
npm run build
npm start          # listens on :8080 (PORT)
```

Environment:

| Var                      | Purpose                                   | Default            |
|--------------------------|-------------------------------------------|--------------------|
| `PORT`                   | HTTP port                                 | `8080`             |
| `PGHOST`/`PGPORT`/…      | Postgres connection                       | localhost:5432     |
| `WEBHOOK_SIGNING_SECRET` | HMAC key for `X-Ledger-Signature`         | `FAKE_DEMO_SECRET` |
| `WEBHOOK_URL`            | Settlement webhook target (optional)      | (unset ⇒ no webhook)|
| `FEE_ACCOUNT_ID`         | Account credited the platform fee         | (required for transfers)|

## Endpoints

| Method | Path             | Scope             | Notes                              |
|--------|------------------|-------------------|------------------------------------|
| GET    | `/health`        | (none)            | `{ "status": "ok" }`               |
| POST   | `/accounts`      | `accounts:write`  | Idempotency-Key required           |
| GET    | `/accounts`      | `accounts:read`   | cursor paginated                   |
| GET    | `/accounts/:id`  | `accounts:read`   |                                    |
| DELETE | `/accounts/:id`  | `accounts:write`  | soft-delete (close)                |
| POST   | `/transfers`     | `transfers:write` | Idempotency-Key required           |
| GET    | `/transfers`     | `transfers:read`  | cursor paginated                   |
| GET    | `/transfers/:id` | `transfers:read`  |                                    |

All non-health endpoints need `Authorization: Bearer <token>`. A missing/revoked
token → `401`; a valid token lacking the endpoint's scope → `403`.

## Money & fees

Amounts are integer minor units. Every transfer withholds a **2.9% (290 bps)**
fee, computed as `amount × 290 / 10000` and rounded **HALF_EVEN** (banker's
rounding). The source is debited the full `amount`; the destination is credited
`amount − fee`; the fee account is credited `fee`. The three entries balance,
and each account's cached `balance` always equals its credits minus its debits.

```bash
curl -XPOST localhost:8080/transfers \
  -H 'authorization: Bearer <token>' \
  -H 'idempotency-key: 0f9c…' \
  -H 'content-type: application/json' \
  -d '{"source_account_id":"…","destination_account_id":"…","amount":10000}'
```

## Pagination

Listing endpoints are **cursor-based** (no page/offset). They return:

```json
{ "data": [ /* newest first */ ], "next_cursor": "eyJ…" }
```

Pass `?cursor=<next_cursor>` to get the following page; `next_cursor` is `null`
on the last page. `?limit=` defaults to **25** and is capped at **100**.

## Idempotency

`POST /accounts` and `POST /transfers` require an `Idempotency-Key` header. The
same key replays the original response for **24 hours**; reusing a key with a
different body returns `409`.

## Rate limiting

Mutating endpoints are limited **per account** (per token, not per IP) to **60
requests per 60 seconds**; the next request returns `429`. Read endpoints are
not rate limited.

## Settlement webhook

After a transfer posts, the service POSTs `transfer.settled` to `WEBHOOK_URL`
(if set) with up to **4 attempts** and **1s / 2s / 4s** backoff, each attempt
timing out after **5s**. The body is signed with HMAC-SHA256 in the
`X-Ledger-Signature` header. The webhook runs after the post commits, so a
delivery failure never undoes a posted transfer.

## Audit log

Every state change (`account.created`, `account.closed`, `transfer.posted`,
`transfer.settled`, `transfer.failed`) appends one immutable row to
`audit_events`. Rows are never updated or deleted.

See `PRD.md` and `ARCHITECTURE.md` for the full specification.
