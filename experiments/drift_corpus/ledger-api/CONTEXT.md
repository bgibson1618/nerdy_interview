# ledger-api — Context

Working notes for engineers picking this up. The authoritative specs are
`PRD.md` and `ARCHITECTURE.md`; this file just orients you.

## What this is

A double-entry ledger / payments backend. Accounts hold a single-currency
balance in integer minor units. Money moves via **transfers**, each of which
writes balanced **entries** (a debit and a credit, plus a fee credit) atomically
in one Postgres transaction. Writes are idempotent, mutating traffic is rate
limited per account, account deletion is a soft-delete, and every state change
is appended to an immutable audit log. A signed settlement webhook notifies
downstream systems after a transfer posts.

## Current state

All six build phases are complete and coherent with the docs:

- Phase 0 — bootstrap + `GET /health` (`{status:"ok"}`) on port **8080**. Done.
- Phase 1 — `pg` pool (`max=10`), `withTransaction`, full `schema.sql`. Done.
- Phase 2 — bearer tokens by SHA-256 hash; `requireScope`; 401 vs 403. Done.
- Phase 3 — accounts CRUD; cursor pagination (default **25**, max **100**);
  soft-delete with guards. Done.
- Phase 4 — `computeFee` HALF_EVEN; atomic double-entry engine; `FEE_BPS=290`.
  Done.
- Phase 5 — idempotency (24h replay, body-mismatch 409); per-account rate limit
  (**60 / 60s**, 429). Done.
- Phase 6 — settlement webhook (4 attempts, 1s/2s/4s backoff, 5s timeout, HMAC
  `X-Ledger-Signature`); append-only audit log. Done.
- Phase 7 — token-management endpoints (`POST /tokens`, `DELETE /tokens/:id`) for
  issuing and revoking scoped bearer tokens at runtime. Done.

## Things that trip people up

- **Money is integer minor units.** The ONLY place a fraction can appear is the
  fee (`amount × 290 / 10000`), and that is rounded **HALF_EVEN** in
  `utils/money.ts`. Don't introduce floats elsewhere.
- **The fee is withheld from the destination, not added to the source.** Source
  is debited the full `amount`; destination is credited `amount − fee`; the fee
  account is credited `fee`. The three entries balance.
- **Atomicity is the whole point.** Everything in a transfer (transfer row,
  entries, balance updates, `transfer.posted` audit row) goes through the same
  transaction client. The settlement webhook is the one thing that runs *after*
  commit — by design, so it can't roll back a posted transfer.
- **Rate limiting is per account/token, not per IP.** A client cannot get more
  throughput by rotating IPs.
- **Pagination is cursor-only.** There is no `page` or `offset`. Lists return
  `{ data, next_cursor }`, newest-first.
- **Soft-delete.** A closed account keeps its row and entries; you can still
  read it and its history. You just can't transfer with it.

## Config quick reference (`src/config.ts`)

| Thing                | Value                       |
|----------------------|-----------------------------|
| Port                 | 8080                        |
| pg pool max          | 10                          |
| Fee                  | 290 bps (2.9%), HALF_EVEN   |
| List limit           | default 25 / max 100        |
| Rate limit           | 60 req / 60s / account      |
| Idempotency TTL      | 24h                         |
| Webhook              | 4 attempts, 1s/2s/4s, 5s TO |

## What's next (not built)

- A token-management endpoint (tokens are seeded out of band today).
- FX / multi-currency transfers.
- A settlement-retry sweeper for transfers stuck in `posted`.
