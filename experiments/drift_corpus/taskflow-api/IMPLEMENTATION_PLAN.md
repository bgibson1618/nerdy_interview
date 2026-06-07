# taskflow-api — Implementation Plan

Phased delivery. Each phase lists acceptance criteria and a completion marker.
Phases map directly onto the components in `ARCHITECTURE.md`.

## Phase 1 — Foundation  ✅ DONE

Scope: project skeleton, config, DB pool, schema, shared types.

Acceptance criteria:
- `src/config.ts` exports concrete constants: port `4000`, access TTL `15m`,
  refresh TTL `7d`, default page size `20`, max page size `100`, rate limit
  `100` / `15 min`, webhook timeout `3000 ms`, bcrypt cost `12`.
- `src/db.ts` exposes a `mysql2` promise pool.
- `src/schema.sql` creates `users`, `projects`, `tasks` exactly as in the
  architecture data model.
- `src/types.ts` defines `User`, `Project`, `Task`, `TaskStatus`,
  `TaskPriority`.

## Phase 2 — Auth  ✅ DONE

Scope: registration, login, JWT sign/verify, requireAuth middleware. (R1, R2)

Acceptance criteria:
- `POST /auth/register` hashes with bcrypt cost `12` and returns `201`.
- `POST /auth/login` returns `{ access_token, refresh_token }`.
- Access token expires in `15m`, refresh token in `7d`.
- `requireAuth` rejects missing/invalid tokens with `401` and sets
  `req.userId` on success.

## Phase 3 — Tasks CRUD + listing  ✅ DONE

Scope: create, read, update, delete, and filtered/paginated list. (R3, R4, R5,
R6)

Acceptance criteria:
- `POST /tasks`, `GET /tasks/:id`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
  enforce ownership.
- `GET /tasks` filters by `status` and `project_id` and paginates with `page`
  / `page_size` (default `20`, max `100`), returning
  `{ data, page, page_size, total }`.
- Status is constrained to `todo|in_progress|done` (default `todo`); priority to
  `low|medium|high` (default `medium`).

## Phase 4 — Hardening: rate limit, webhook, health  ✅ DONE

Scope: per-IP rate limiting, completion webhook, health probe, error handler.
(R7, R8, R9)

Acceptance criteria:
- Global rate limiter caps each IP at `100` requests per `15 min`, returning
  `429` past the limit.
- Task list responses are cached in Redis with a `60s` TTL (cache-aside) to cut
  database load.
- Transition to `done` fires a fire-and-forget POST to
  `projects.webhook_url` with a `3000 ms` timeout when a URL is set.
- `GET /health` returns `{ status: "ok" }` without auth.
- Central error handler maps thrown errors to JSON `{ error }` with the right
  status code.

## Status summary

All four phases are **DONE**. The API implements every requirement R1–R9. No
phases are outstanding.

