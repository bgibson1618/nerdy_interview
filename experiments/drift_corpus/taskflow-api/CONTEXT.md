# taskflow-api — Context / Front Door

## What this is

A small REST API for task tracking: users → projects → tasks, with JWT auth and
a task-completion webhook. Node + TypeScript + Express + MySQL.

## Current state

**Shipped — all four phases complete (see `IMPLEMENTATION_PLAN.md`).**

- Phase 1 Foundation — config, DB pool, schema, types. ✅
- Phase 2 Auth — register/login, JWT, requireAuth, token refresh endpoint. ✅
- Phase 3 Tasks — full CRUD + filtered/paginated list. ✅
- Phase 4 Hardening — rate limit, webhook, health, error handler. ✅

The public surface is the 8 routes documented in `ARCHITECTURE.md` plus
`GET /health`.

## Key facts at a glance

- Listens on port **4000**.
- Access token TTL **15m**, refresh token TTL **7d**.
- List default page size **20**, max **100**.
- Rate limit **100 requests / 15 min** per IP.
- Webhook fires on transition to `done`, POST with a **3000 ms** timeout.
- Tables: `users`, `projects`, `tasks` (DDL in `src/schema.sql`).

## What's next

The build is feature-complete for v1; there is no outstanding implementation
work. Candidate follow-ups (not yet scheduled, out of v1 scope):

- A `POST /auth/refresh` endpoint that consumes the refresh token.
- Project CRUD endpoints (projects are currently seeded directly in the DB).
- Webhook delivery retries / signing.

## How to run

See `README.md`. In short: set env vars, `npm run build`, `npm start`.

