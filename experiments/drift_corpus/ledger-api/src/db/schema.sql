-- Canonical DDL for ledger-api (PostgreSQL).
-- All ids are UUIDs. All money columns are BIGINT minor units (e.g. cents).

CREATE TABLE api_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,          -- sha256 hex of the bearer token
  scopes      TEXT[] NOT NULL,               -- e.g. {accounts:read,transfers:write}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ NULL
);

CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency    CHAR(3) NOT NULL,              -- ISO 4217 alphabetic code
  balance     BIGINT NOT NULL DEFAULT 0,     -- minor units; = SUM(credits)-SUM(debits)
  status      TEXT NOT NULL DEFAULT 'active' -- 'active' | 'closed'
                CHECK (status IN ('active','closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at   TIMESTAMPTZ NULL               -- set on soft-delete; row is retained
);

CREATE TABLE transfers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_account_id      UUID NOT NULL REFERENCES accounts(id),
  destination_account_id UUID NOT NULL REFERENCES accounts(id),
  amount                 BIGINT NOT NULL CHECK (amount > 0),  -- gross, minor units
  fee                    BIGINT NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency               CHAR(3) NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','posted','settled','failed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at             TIMESTAMPTZ NULL
);

-- Exactly two entries per posted transfer (one debit, one credit) plus, when a
-- fee applies, a third credit to the platform fee account. Entries are immutable.
CREATE TABLE entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES transfers(id),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  direction   TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount      BIGINT NOT NULL CHECK (amount > 0),  -- positive, minor units
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entries_account_created_idx
  ON entries (account_id, created_at DESC, id DESC);

CREATE INDEX transfers_created_idx
  ON transfers (created_at DESC, id DESC);

-- Idempotency keys. The same key replays the stored response for 24h; a key
-- reused with a different body is a 409 conflict.
CREATE TABLE idempotency_keys (
  key             TEXT PRIMARY KEY,
  request_hash    TEXT NOT NULL,             -- sha256 hex of the request body
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit log. One row per state change; never updated or deleted.
CREATE TABLE audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT NOT NULL,                 -- e.g. 'transfer.posted'
  entity_id   UUID NOT NULL,
  detail      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_entity_idx ON audit_events (entity_id, created_at DESC);
