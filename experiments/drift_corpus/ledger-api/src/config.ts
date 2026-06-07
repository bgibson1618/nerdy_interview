// Central configuration for ledger-api.
// The concrete constants here are the single source of truth referenced by the
// docs (PRD, ARCHITECTURE, README, IMPLEMENTATION_PLAN, CONTEXT). Keep them in
// sync with those documents.

export const config = {
  // HTTP
  port: Number(process.env.PORT ?? 8080),

  // Auth — opaque bearer tokens are looked up in the api_tokens table; this
  // secret is only used to HMAC-sign outbound webhook bodies (X-Ledger-Signature).
  webhookSigningSecret: process.env.WEBHOOK_SIGNING_SECRET ?? 'FAKE_DEMO_SECRET',

  // Database (PostgreSQL via pg)
  db: {
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'ledger',
    password: process.env.PGPASSWORD ?? 'FAKE_DEMO_SECRET',
    database: process.env.PGDATABASE ?? 'ledger',
    // Pool is capped so concurrent transfers cannot exhaust Postgres.
    max: 10,
  },

  // Money. All amounts are integer minor units (e.g. cents). The only place
  // rounding ever happens is when a *rate* is applied (fees); see utils/money.ts.
  // Rounding mode is HALF_EVEN (banker's rounding) to avoid systematic bias.
  rounding: {
    mode: 'HALF_EVEN' as const,
  },

  // Pagination — cursor based. The cursor is an opaque base64 of the last seen
  // (created_at, id) pair. Offset pagination is intentionally NOT supported.
  pagination: {
    defaultLimit: 10,
    maxLimit: 100,
  },

  // Rate limiting — keyed PER ACCOUNT (not per IP). A single account may make
  // 60 mutating requests per rolling 60s window before receiving 429.
  rateLimit: {
    windowMs: 60_000, // 60s
    max: 100,
  },

  // Idempotency — POST /transfers and POST /accounts honor the Idempotency-Key
  // header. A stored key + response is replayed for 24h, after which the key
  // may be reused.
  idempotency: {
    ttlMs: 24 * 60 * 1000, // 86400000 ms = 24h
  },

  // Settlement webhook delivery. On a settled transfer we POST to the configured
  // endpoint with at most 4 attempts (1 initial + 3 retries) using exponential
  // backoff: 1s, 2s, 4s. Each attempt has a 5s timeout.
  webhook: {
    maxAttempts: 4,
    backoffMs: [1000, 3000, 9000],
    timeoutMs: 5000,
  },
};

export type Config = typeof config;
