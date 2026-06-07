# ledger-api — Architecture

## 1. Stack

- **Runtime:** Node.js (TypeScript, compiled with `tsc`).
- **HTTP framework:** Express.
- **Database:** PostgreSQL, accessed through the `pg` connection pool.
- **Auth:** Opaque bearer tokens looked up by SHA-256 hash in `api_tokens`,
  carrying a set of scopes.
- **Outbound signing:** HMAC-SHA256 of webhook bodies using
  `WEBHOOK_SIGNING_SECRET`.

There is **no** ORM, no Redis/cache layer, and no message queue. State lives in
Postgres; the rate limiter and idempotency wrapper are the only in-process
pieces of stateful behavior (the rate-limit counter is in memory; idempotency
records persist in Postgres).

## 2. Component map

```
src/
  index.ts                App bootstrap: builds Express app, mounts routers.
  config.ts               Central config — single source of truth for constants.
  types.ts                Shared domain types + enums.
  db/
    pool.ts               pg Pool + query() + withTransaction() helper.
    schema.sql            Canonical PostgreSQL DDL.
  auth/
    tokens.ts             hashToken(), requireScope() middleware factory.
  middleware/
    errorHandler.ts       HttpError + central error -> JSON mapper.
    rateLimit.ts          Per-account rolling-window limiter.
    idempotency.ts        Idempotency-Key capture/replay.
  routes/
    accounts.ts           /accounts CRUD + list.
    transfers.ts          /transfers post + read + list.
  services/
    accounts.ts           Account lifecycle incl. soft-delete.
    transfers.ts          Atomic double-entry engine + fee.
    webhook.ts            Settlement delivery with retry/backoff.
    audit.ts              Append-only audit writer.
  utils/
    money.ts              computeFee() HALF_EVEN; netToDestination().
    cursor.ts             Opaque (created_at,id) cursor encode/decode.
```

`index.ts` mounts `express.json()`, the unauthenticated `GET /health`, the
`/accounts` router, and the `/transfers` router, then the central error handler
last. There is no global auth guard — each route declares its own scope.

## 3. Data model (PostgreSQL)

All ids are UUIDs (`gen_random_uuid()`). All money columns are `BIGINT` minor
units. Canonical DDL is `src/db/schema.sql`.

### `api_tokens`

| column       | type          | notes                                   |
|--------------|---------------|-----------------------------------------|
| `id`         | UUID PK       |                                         |
| `token_hash` | TEXT UNIQUE   | SHA-256 hex of the presented bearer token|
| `scopes`     | TEXT[]        | e.g. `{accounts:read,transfers:write}`  |
| `created_at` | TIMESTAMPTZ   | default `now()`                         |
| `revoked_at` | TIMESTAMPTZ?  | non-null ⇒ token rejected (401)         |

### `accounts`

| column       | type         | notes                                       |
|--------------|--------------|---------------------------------------------|
| `id`         | UUID PK      |                                             |
| `currency`   | CHAR(3)      | ISO 4217 alphabetic                         |
| `balance`    | BIGINT       | minor units; = Σ credits − Σ debits         |
| `status`     | TEXT         | `active` \| `closed`; default `active`      |
| `created_at` | TIMESTAMPTZ  | default `now()`                             |
| `closed_at`  | TIMESTAMPTZ? | set on soft-delete; row retained            |

### `transfers`

| column                   | type        | notes                                |
|--------------------------|-------------|--------------------------------------|
| `id`                     | UUID PK     |                                      |
| `source_account_id`      | UUID FK     | → `accounts.id`                      |
| `destination_account_id` | UUID FK     | → `accounts.id`                      |
| `amount`                 | BIGINT      | gross, minor units, `> 0`            |
| `fee`                    | BIGINT      | withheld fee, minor units, `>= 0`    |
| `currency`               | CHAR(3)     |                                      |
| `status`                 | TEXT        | `pending`\|`posted`\|`settled`\|`failed` |
| `created_at`             | TIMESTAMPTZ | default `now()`                      |
| `settled_at`             | TIMESTAMPTZ?| set when settlement webhook succeeds  |

### `entries`

| column        | type        | notes                                       |
|---------------|-------------|---------------------------------------------|
| `id`          | UUID PK     |                                             |
| `transfer_id` | UUID FK     | → `transfers.id`                            |
| `account_id`  | UUID FK     | → `accounts.id`                             |
| `direction`   | TEXT        | `debit` \| `credit`                         |
| `amount`      | BIGINT      | positive minor units                        |
| `created_at`  | TIMESTAMPTZ | default `now()`                             |

A posted transfer writes a `debit` to the source for the full gross `amount`, a
`credit` to the destination for `amount − fee`, and (only when `fee > 0`) a
`credit` to the fee account for `fee`. Entries are immutable.

### `idempotency_keys`

| column            | type        | notes                                  |
|-------------------|-------------|----------------------------------------|
| `key`             | TEXT PK     | the client-supplied Idempotency-Key    |
| `request_hash`    | TEXT        | SHA-256 of the request body            |
| `response_status` | INTEGER     | status to replay                       |
| `response_body`   | TEXT        | JSON body to replay                    |
| `created_at`      | TIMESTAMPTZ | TTL anchor (24h)                       |

### `audit_events`

| column       | type        | notes                                    |
|--------------|-------------|------------------------------------------|
| `id`         | UUID PK     |                                          |
| `action`     | TEXT        | e.g. `transfer.posted`                   |
| `entity_id`  | UUID        | account id or transfer id                |
| `detail`     | JSONB       | serialized snapshot                      |
| `created_at` | TIMESTAMPTZ | default `now()`                          |

## 4. Auth & scopes (R9)

`requireScope(scope)` is a middleware factory. It reads
`Authorization: Bearer <token>`, hashes the token with SHA-256, looks it up in
`api_tokens`, and rejects missing/garbage/revoked tokens with **401**. If the
token is valid but its `scopes` array does not include the required scope, it
returns **403**. On success it attaches the token to `req.token`.

Scope per endpoint:

| Method | Path             | Required scope     | Rate-limited | Idempotent |
|--------|------------------|--------------------|--------------|------------|
| GET    | `/health`        | (none)             | no           | no         |
| POST   | `/accounts`      | `accounts:write`   | yes          | yes        |
| GET    | `/accounts`      | `accounts:read`    | no           | no         |
| GET    | `/accounts/:id`  | `accounts:read`    | no           | no         |
| DELETE | `/accounts/:id`  | `accounts:write`   | no           | no         |
| POST   | `/transfers`     | `transfers:write`  | yes          | yes        |
| GET    | `/transfers`     | `transfers:read`   | no           | no         |
| GET    | `/transfers/:id` | `transfers:read`   | no           | no         |

The middleware order on the two POSTs is: `requireScope` → `rateLimitPerAccount`
→ `idempotency` → handler. So authentication happens first, the limiter keys off
the now-known token, and idempotency wraps the handler's response.

## 5. Transfer engine — atomicity & invariants (R4, R5, R8)

`services/transfers.ts#createTransfer` runs entirely inside
`db/pool.ts#withTransaction`, which is a `BEGIN`/`COMMIT` block on one dedicated
pooled connection with `ROLLBACK` on any thrown error. Within the transaction:

1. Both accounts (plus the fee account) are locked with `SELECT … FOR UPDATE`
   in a **deterministic id order** to avoid deadlocks between concurrent
   transfers touching the same pair.
2. Validate: both endpoints `active`; identical currency; source `balance ≥
   amount` (else `422` insufficient funds).
3. Compute `fee = computeFee(amount, FEE_BPS)` with `FEE_BPS = 290` (R8).
4. Insert the `transfers` row (`status = 'posted'`).
5. Insert the entries: debit source `amount`, credit destination `amount − fee`,
   and (if `fee > 0`) credit fee account `fee`.
6. Update cached balances to match the entries exactly (debit ⇒ `balance -=
   amount`; credits ⇒ `balance +=`). This preserves the balance invariant (R5).
7. Append the `transfer.posted` audit row on the **same client** (R12), so it
   commits or rolls back with everything else.

Because every write uses the transaction's client, a failure anywhere causes a
full `ROLLBACK`: no transfer, no entries, no balance change, no audit row.

## 6. Fees & rounding (R8)

`utils/money.ts#computeFee(amount, bps)` returns
`round_half_even(amount × bps / 10000)`. The implementation avoids floats: it
takes the integer quotient and remainder of `amount × bps` over `10000`,
compares `remainder × 2` to `10000`, and on an exact half rounds to the nearest
**even** quotient. `FEE_BPS = 290` (2.9%). The destination net is
`amount − fee`; the source is always debited the full `amount`; the fee is
credited to the platform fee account (configured via `FEE_ACCOUNT_ID`).

## 7. Settlement webhook (R7)

`services/webhook.ts#deliverSettlement` POSTs
`{ event: "transfer.settled", transfer_id, settled_at }` to `WEBHOOK_URL`. It
makes at most **4 attempts** (1 + 3 retries). The waits **between** attempts are
`config.webhook.backoffMs = [1000, 2000, 4000]` ms (1s, 2s, 4s); each attempt
aborts after `config.webhook.timeoutMs = 5000` ms. The body is signed
HMAC-SHA256 and sent in `X-Ledger-Signature`. Only a `2xx` counts as success.
The call happens in the transfers route **after** the post transaction commits;
on success the transfer is moved to `settled` (+ a `transfer.settled` audit
row), otherwise it stays `posted`.

## 8. Pagination (R2, R6)

Listing is **cursor/keyset** only — there is no `page`/`offset` parameter. Lists
order by `(created_at DESC, id DESC)`. A page fetches `limit + 1` rows; if the
extra row exists, it is dropped and `next_cursor` is set to the opaque
base64url-encoded `(created_at, id)` of the last returned row. The envelope is
`{ data, next_cursor }` with `next_cursor: null` on the final page. Default
`limit` is **25**, max **100**.

## 9. Idempotency (R10)

`middleware/idempotency.ts` requires the `Idempotency-Key` header on the two
POSTs (`400` if absent). It hashes the request body (SHA-256). If a stored key
exists and is within the **24h** TTL: a matching body replays the stored
status+body without re-running the handler; a different body is `409`. Expired
keys are deleted and the request proceeds fresh. On the first execution it wraps
`res.json` to persist `(key, request_hash, status, body)`.

## 10. Rate limiting (R11)

`middleware/rateLimit.ts` keys an in-memory rolling counter by **token id**
(per account), not IP. Up to `config.rateLimit.max = 60` requests per
`config.rateLimit.windowMs = 60000` ms are allowed; the next one returns `429`.
Mounted only on the two mutating POSTs; reads are never limited.

## 11. Audit log (R12)

`services/audit.ts#recordAudit(action, entityId, detail, client?)` inserts one
immutable `audit_events` row. When a `client` (transaction) is passed the row is
written through it (used for `transfer.posted`); otherwise it goes through the
shared pool (account lifecycle, `transfer.settled`). Nothing ever updates or
deletes audit rows.

## 12. Key config values (single source of truth: `src/config.ts`)

| Key                       | Value                         | Source env var          |
|---------------------------|-------------------------------|-------------------------|
| HTTP port                 | `8080`                        | `PORT`                  |
| pg pool max               | `10`                          | (constant)              |
| Rounding mode             | `HALF_EVEN`                   | (constant)              |
| Fee                       | `290` bps (2.9%)              | (constant `FEE_BPS`)    |
| Default list limit        | `25`                          | (constant)              |
| Max list limit            | `100`                         | (constant)              |
| Rate-limit window         | `60000` ms (60s)              | (constant)              |
| Rate-limit max            | `60` req / window / account   | (constant)              |
| Idempotency TTL           | `86400000` ms (24h)           | (constant)              |
| Webhook max attempts      | `4` (1 + 3 retries)           | (constant)              |
| Webhook backoff           | `[1000, 2000, 4000]` ms       | (constant)              |
| Webhook per-attempt timeout | `10000` ms                  | (constant)              |
| Webhook signing secret    | `FAKE_DEMO_SECRET` (default)  | `WEBHOOK_SIGNING_SECRET`|

These map onto requirements: R2/R6 (limits), R7 (webhook), R8 (fee/rounding),
R10 (idempotency TTL), R11 (rate limit), R13 (health on the configured port).
