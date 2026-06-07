### 1. Source Brief -> Architecture

R1 — User registration and login: Addressed. PRD requires `POST /auth/register`, `POST /auth/login`, bcrypt password storage, and access/refresh token issuance (`PRD.md:26-30`); architecture specifies those routes, bcrypt hashing, and access/refresh JWTs (`ARCHITECTURE.md:79-85`, `ARCHITECTURE.md:93-97`).

R2 — JWT-based stateless auth: Addressed at the architecture level. PRD requires bearer auth for non-auth endpoints plus access `15m` and refresh `7d` TTLs (`PRD.md:32-36`); architecture specifies `requireAuth`, JWT payloads, and those TTLs (`ARCHITECTURE.md:81-89`, `ARCHITECTURE.md:113-114`). The health exception is consistent with R9.

R3 — Create and read tasks: Addressed. PRD requires `POST /tasks`, `GET /tasks/:id`, task fields, and project ownership (`PRD.md:38-41`); architecture includes those routes and a `tasks` table tied to `projects` and `users` (`ARCHITECTURE.md:61-74`, `ARCHITECTURE.md:98-100`).

R4 — List tasks with filters and pagination: Addressed. PRD requires `GET /tasks`, `status` and `project_id` filters, `page` / `page_size`, default `20`, max `100` (`PRD.md:43-47`); architecture specifies the same query parameters and response envelope (`ARCHITECTURE.md:98`, `ARCHITECTURE.md:104-106`, `ARCHITECTURE.md:116-117`).

R5 — Update and delete tasks: Addressed. PRD requires `PATCH /tasks/:id`, `DELETE /tasks/:id`, mutable fields, and owner rejection (`PRD.md:49-52`); architecture includes those routes and owner-denormalized task records to enforce ownership (`ARCHITECTURE.md:67`, `ARCHITECTURE.md:101-102`).

R6 — Task status lifecycle: Addressed. PRD requires statuses `todo|in_progress|done` and priorities `low|medium|high` with defaults (`PRD.md:54-57`); architecture specifies matching enums/defaults (`ARCHITECTURE.md:70-71`).

R7 — Completion webhook: Addressed. PRD requires posting to `projects.webhook_url` only when set and not failing the API response (`PRD.md:59-63`); architecture describes the `services/webhook.ts` flow, payload, timeout, and swallowed errors (`ARCHITECTURE.md:125-132`).

R8 — Rate limiting: Contradicted. PRD requires `100` requests per 15-minute window (`PRD.md:65-67`), but architecture's key config table says rate limit max is `250` requests / window / IP (`ARCHITECTURE.md:118-120`).

R9 — Health check: Addressed. PRD requires unauthenticated `GET /health` returning `{ "status": "ok" }` (`PRD.md:69-71`); architecture specifies that route and payload (`ARCHITECTURE.md:93-95`).

Non-numbered goal drift: the PRD goal says the API manages "tasks and projects" (`PRD.md:12`) and the overview says users group work into projects (`PRD.md:5-8`), while architecture has project storage but no project CRUD API (`ARCHITECTURE.md:91-102`). This is under-specified rather than a direct contradiction because no numbered PRD requirement defines project endpoints.

### 2. Architecture -> Delivery Plan

The delivery plan broadly follows the architecture's module layout and phase order: foundation/config/schema/types, auth/JWT/middleware, task routes, then hardening with rate limiting, webhook, health, and error handling (`IMPLEMENTATION_PLAN.md:6-59` vs `ARCHITECTURE.md:13-36`).

Missing or incoherent plan coverage:

- Rate-limit acceptance contradicts architecture. Plan Phase 1 and Phase 4 require `100` requests / `15 min` (`IMPLEMENTATION_PLAN.md:11-13`, `IMPLEMENTATION_PLAN.md:50-52`), while architecture's key config says `250` requests / window / IP (`ARCHITECTURE.md:118-120`).
- The Redis cache task is not in the architecture. Plan Phase 4 claims task list responses are cached in Redis with a `60s` TTL (`IMPLEMENTATION_PLAN.md:53-54`), but architecture lists only Node/Express/MySQL/JWT/bcrypt/express-rate-limit and no Redis/cache component (`ARCHITECTURE.md:3-12`, `ARCHITECTURE.md:13-32`).
- Phase 4 sequencing is risky because webhook acceptance requires behavior inside the task update path (`IMPLEMENTATION_PLAN.md:55-56`), but the architecture splits the service into `services/webhook.ts` and the route in `routes/tasks.ts` (`ARCHITECTURE.md:27-31`, `ARCHITECTURE.md:125-132`) without a delivery task that explicitly verifies route-to-service wiring.
- The plan's status summary says every requirement R1-R9 is implemented (`IMPLEMENTATION_PLAN.md:61-64`), but the plan has no acceptance evidence or verification log; that makes the completion claim stale unless checked against code.

### 3. Delivery/Status -> Code

1. DRIFT: `CONTEXT.md` claims "Phase 2 Auth — register/login, JWT, requireAuth, token refresh endpoint" is shipped (`CONTEXT.md:12-14`) vs PRD says refreshing is out of scope for v1 (`PRD.md:34-36`), `CONTEXT.md` later lists `POST /auth/refresh` as a future follow-up (`CONTEXT.md:34`), and code defines only `/auth/register` and `/auth/login` (`src/routes/auth.ts:13`, `src/routes/auth.ts:41`).

2. DRIFT: `CONTEXT.md` claims the public surface is "the 8 routes documented in `ARCHITECTURE.md` plus `GET /health`" (`CONTEXT.md:17-18`) vs architecture's 8-route table already includes `GET /health` (`ARCHITECTURE.md:93-102`) and code exposes 8 total routes: health, two auth routes, and five task routes (`src/index.ts:18`, `src/routes/auth.ts:13`, `src/routes/auth.ts:41`, `src/routes/tasks.ts:15`, `src/routes/tasks.ts:63`, `src/routes/tasks.ts:108`, `src/routes/tasks.ts:118`, `src/routes/tasks.ts:151`).

3. DRIFT: `ARCHITECTURE.md` claims rate limit max is `250` requests / window / IP (`ARCHITECTURE.md:118-120`) vs PRD, plan, context, README, and code use `100` requests per 15 minutes (`PRD.md:65-67`, `IMPLEMENTATION_PLAN.md:50-52`, `CONTEXT.md:25`, `README.md:112-115`, `src/config.ts:28-31`, `src/middleware/rateLimit.ts:6-11`).

4. DRIFT: `README.md` claims the access token expires after **30 minutes** (`README.md:45-47`) vs PRD, architecture, and code use `15m` (`PRD.md:32-35`, `ARCHITECTURE.md:81-84`, `src/config.ts:8-11`, `src/auth/jwt.ts:15-20`).

5. DRIFT: PRD, architecture, context, plan, and README claim refresh token TTL is **7 days** (`PRD.md:32-36`, `ARCHITECTURE.md:83-85`, `CONTEXT.md:23`, `IMPLEMENTATION_PLAN.md:11-13`, `README.md:45-47`) vs code sets `refreshTokenTtl: '30d'` and signs refresh tokens with that config (`src/config.ts:8-12`, `src/auth/jwt.ts:23-28`).

6. DRIFT: `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md` claim bcrypt cost factor is `12` (`ARCHITECTURE.md:47-49`, `ARCHITECTURE.md:79-80`, `ARCHITECTURE.md:115`, `IMPLEMENTATION_PLAN.md:11-13`, `IMPLEMENTATION_PLAN.md:24-25`) vs code sets `bcryptCost: 8` and registration hashes with that config (`src/config.ts:8-12`, `src/routes/auth.ts:28`).

7. DRIFT: PRD, architecture, context, plan, and README claim default task list page size is `20` (`PRD.md:43-47`, `ARCHITECTURE.md:104-106`, `ARCHITECTURE.md:116`, `CONTEXT.md:24`, `IMPLEMENTATION_PLAN.md:39-41`, `README.md:76-82`) vs code sets `defaultPageSize: 50` and `GET /tasks` uses that config when `page_size` is absent (`src/config.ts:24-26`, `src/routes/tasks.ts:36-41`).

8. DRIFT: PRD, architecture, and plan claim unauthenticated `GET /health` returns `{ "status": "ok" }` (`PRD.md:69-71`, `ARCHITECTURE.md:93-95`, `IMPLEMENTATION_PLAN.md:55-57`) vs code returns `{ status: 'healthy' }` (`src/index.ts:17-20`).

9. DRIFT: PRD, architecture, plan, and README claim task description is the mutable optional field/column (`PRD.md:38-41`, `PRD.md:49-52`, `ARCHITECTURE.md:68-75`, `IMPLEMENTATION_PLAN.md:14-16`, `README.md:98-100`) vs canonical schema creates `tasks.details` instead of `tasks.description` (`src/schema.sql:24-40`), while task create/update SQL writes the nonexistent `description` column (`src/routes/tasks.ts:84-87`, `src/routes/tasks.ts:138-141`).

10. DRIFT: `IMPLEMENTATION_PLAN.md` claims `src/schema.sql` creates `users`, `projects`, and `tasks` exactly as in the architecture data model (`IMPLEMENTATION_PLAN.md:14-16`) vs architecture's `tasks.description` column (`ARCHITECTURE.md:68-75`) conflicts with schema's `tasks.details` column (`src/schema.sql:24-40`).

11. DRIFT: PRD, architecture, plan, README, schema, and shared type definitions claim valid statuses include `in_progress` (`PRD.md:54-57`, `ARCHITECTURE.md:70`, `IMPLEMENTATION_PLAN.md:42-43`, `README.md:76-80`, `README.md:98-100`, `src/schema.sql:30`, `src/types.ts:3`) vs task route validation only allows `['todo', 'done']`, so `in_progress` filters/patches are rejected and creates silently fall back to `todo` (`src/routes/tasks.ts:11`, `src/routes/tasks.ts:21-27`, `src/routes/tasks.ts:79`, `src/routes/tasks.ts:124-127`).

12. DRIFT: Architecture, plan, and README claim `GET /tasks` returns `{ data, page, page_size, total }` (`ARCHITECTURE.md:104-106`, `IMPLEMENTATION_PLAN.md:39-41`, `README.md:83-87`) vs code returns `{ items, page, page_size, total }` (`src/routes/tasks.ts:51-56`).

13. DRIFT: PRD, architecture, context, plan, and README claim a completion webhook fires when a task transitions to `done` (`PRD.md:59-63`, `ARCHITECTURE.md:125-132`, `CONTEXT.md:25-27`, `IMPLEMENTATION_PLAN.md:45-57`, `README.md:102-110`) vs `PATCH /tasks/:id` updates the row and returns without importing or calling `fireTaskCompleted` (`src/routes/tasks.ts:117-148`), while the service is only defined in `src/services/webhook.ts` (`src/services/webhook.ts:9-39`).

14. DRIFT: `IMPLEMENTATION_PLAN.md` claims task list responses are cached in Redis with a `60s` TTL (`IMPLEMENTATION_PLAN.md:53-54`) vs architecture has no Redis/cache component (`ARCHITECTURE.md:3-12`, `ARCHITECTURE.md:13-32`), package dependencies have no Redis client (`package.json:11-17`), and `GET /tasks` always queries MySQL directly (`src/routes/tasks.ts:45-54`).

15. DRIFT: `CONTEXT.md` and `IMPLEMENTATION_PLAN.md` claim all four phases are complete and every R1-R9 requirement is implemented (`CONTEXT.md:8-15`, `IMPLEMENTATION_PLAN.md:61-64`) vs code contradicts multiple shipped acceptance criteria: refresh TTL is `30d` not `7d` (`src/config.ts:11`), bcrypt cost is `8` not `12` (`src/config.ts:12`), default page size is `50` not `20` (`src/config.ts:25`), health returns `healthy` not `ok` (`src/index.ts:18-20`), `in_progress` is not accepted by route validation (`src/routes/tasks.ts:11`), and webhook firing is not wired into PATCH (`src/routes/tasks.ts:117-148`).

16. DRIFT: `src/config.ts` says its concrete constants are "the single source of truth referenced by the docs" (`src/config.ts:1-2`) vs the docs reference different concrete values for refresh TTL, bcrypt cost, and default page size (`CONTEXT.md:23-24`, `ARCHITECTURE.md:113-117`, `IMPLEMENTATION_PLAN.md:11-13`, `README.md:45-47`, `README.md:76-82`) than the config actually exports (`src/config.ts:10-12`, `src/config.ts:24-26`).

17. DRIFT: `src/auth/jwt.ts` inline comment says refresh-token expiry is `7d` (`src/auth/jwt.ts:23-28`) vs the referenced config value is `30d` (`src/config.ts:11`).

18. DRIFT: `src/routes/auth.ts` inline comment says registration hashes with cost `12` (`src/routes/auth.ts:28`) vs the referenced config value is `8` (`src/config.ts:12`).

### 4. Verdict

SIGNIFICANT DRIFT

Most important issues:

1. The "all phases DONE / every R1-R9 implemented" status is not credible because multiple checkable requirements are contradicted by code: refresh TTL, bcrypt cost, default page size, health payload, `in_progress` support, and webhook firing.
2. Task persistence is internally inconsistent: docs/types/routes use `description`, but the schema creates `details`, so task create/update paths target a nonexistent column.
3. The webhook requirement is documented as shipped across the project, but the PATCH route never calls the webhook service.
4. API contract drift affects clients directly: `GET /health` returns the wrong liveness payload, `GET /tasks` uses `items` instead of `data`, and default pagination is `50` instead of `20`.
5. Delivery planning includes a Redis cache acceptance criterion that neither the architecture nor codebase contains.

Verification note: I reviewed the requested docs and all files under `src/`. I did not run a normal build because it would write `dist/` outside the allowed run directory. A no-emit compile using the available global TypeScript 6.0.3 first failed on the `moduleResolution=node10` deprecation; rerunning with `--ignoreDeprecations 6.0` surfaced `src/auth/jwt.ts` payload typing plus missing dependency modules because local `node_modules` is not installed.
