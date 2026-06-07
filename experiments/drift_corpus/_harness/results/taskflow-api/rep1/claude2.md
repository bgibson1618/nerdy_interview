# taskflow-api — Independent Drift Review (fresh eyes)

```text
VERDICT: FAIL
DIMENSIONS:
  - source-brief -> architecture: PASS (one internal contradiction)
  - architecture -> delivery-plan: FAIL
  - delivery/status -> code: FAIL
BLOCKING:
  - src/routes/tasks.ts: completion webhook (R7) is never wired in — fireTaskCompleted is never called, yet docs mark it shipped
  - src/schema.sql: tasks column is `details`, but all code uses `description` — runtime-breaking schema/code mismatch
  - src/routes/tasks.ts: STATUSES = ['todo','done'] drops `in_progress`, breaking R6
  - src/config.ts: refresh TTL (30d), bcrypt cost (8), default page size (50) silently diverge from the documented "single source of truth"
  - IMPLEMENTATION_PLAN.md: Phase 4 claims a Redis 60s cache that no architecture/dependency/code exists for
RIGOR: tuned
```

Scope reviewed: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, all of `src/**`, `package.json`. No tests exist in the repo, so behavior was verified by static cross-reading + targeted greps, not by running the service.

---

### 1. Source Brief -> Architecture

Each PRD requirement and whether the **architecture** (design-level) addresses it:

| Req | Addressed in ARCHITECTURE.md? | Note |
|-----|-------------------------------|------|
| **R1** register/login, bcrypt hashes | ✅ Yes | "Auth model" + API surface. (bcrypt **cost** value conflicts with code — see §3.) |
| **R2** JWT stateless, access 15m / refresh 7d, refresh issued but unused | ✅ Yes | Auth model + key-config table both state 15m / 7d. (Code disagrees — see §3.) |
| **R3** `POST /tasks`, `GET /tasks/:id`, task fields | ✅ Yes | API surface + data model. |
| **R4** `GET /tasks` filter `status`/`project_id`, paginate, default 20 / max 100 | ✅ Yes | API surface + query-param spec + key-config. |
| **R5** `PATCH`/`DELETE /tasks/:id`, ownership | ✅ Yes | API surface. |
| **R6** status `todo/in_progress/done` (def todo), priority `low/medium/high` (def medium) | ✅ Yes | Data model ENUMs. |
| **R7** completion webhook to `projects.webhook_url`, non-blocking | ✅ Yes | Dedicated "Webhook flow (R7)" section. |
| **R8** rate-limit 100 req / 15 min, return 429 | ⚠️ Partially / **contradicted** | Design present, but the key-config table states **`250` requests / window** (ARCHITECTURE.md §"Key config values", line 119), contradicting PRD R8's **100**. |
| **R9** unauthenticated `GET /health` returning `{ "status": "ok" }` | ✅ Yes | API surface + key-config. |

**Verdict for §1:** The architecture satisfies every PRD requirement at the design level. Nothing is overbuilt at the architecture layer (no Redis, no extra endpoints). The one defect is an **internal contradiction**: the rate-limit max in the architecture's key-config table (`250`) contradicts the rate-limit value it inherits from PRD R8 (`100`). Everything else (`100`) appears in PRD/README/CONTEXT/plan/code, so the architecture table value is the outlier.

---

### 2. Architecture -> Delivery Plan

The plan's four phases map cleanly onto the architecture's components, and acceptance criteria are mostly concrete and checkable. Problems:

1. **Invented component (Redis cache).** `IMPLEMENTATION_PLAN.md` Phase 4 acceptance: *"Task list responses are cached in Redis with a `60s` TTL (cache-aside) to cut database load."* The architecture has **no Redis** (stack lists only Node/Express/MySQL/JWT/express-rate-limit), `package.json` has **no redis/ioredis dependency**, and no code implements caching. The plan references a component that does not exist anywhere else.

2. **Phase 1 acceptance is falsified by the schema it points at.** Plan Phase 1: *"`src/schema.sql` creates `users`, `projects`, `tasks` **exactly as in the architecture data model**."* It does not — the `tasks` table column is `details`, while the architecture data model (and types/code) call it `description` (see §3 #8).

3. **No explicit task to *wire* the webhook into the route.** Phase 4 describes the webhook firing on transition to `done`, but there is no acceptance line for "PATCH calls the webhook service." The service was built (`services/webhook.ts`) and then never connected (see §3 #10). The plan's structure let a built-but-unwired feature be marked DONE.

4. **Cross-doc rate-limit disagreement.** The plan (Phase 4, `100`) agrees with PRD/code but **disagrees with ARCHITECTURE.md's key-config table (`250`)**. So the plan is coherent with the brief but not with the architecture doc it claims to build from.

5. **Premature "all DONE" status.** The "Status summary" asserts *"All four phases are DONE. The API implements every requirement R1–R9."* This is contradicted by §3 (#7, #8, #10, #11): R6 is broken, R7 is unimplemented, and R3/R5 would fail at runtime against the shipped schema.

---

### 3. Delivery/Status -> Code

Every concrete inconsistency found, as a checkable list. "(SSOT)" marks the config block that `src/config.ts` line 2 explicitly claims is *"the single source of truth referenced by the docs."*

1. **DRIFT:** Refresh-token TTL documented as **`7d`** (PRD R2 line 35; CONTEXT.md "Key facts" line 23; ARCHITECTURE.md auth model line 85 + key-config line 114; IMPLEMENTATION_PLAN Phase 2 line 27) **vs** code `refreshTokenTtl: '30d'` (`src/config.ts:11`, SSOT). The stale inline comment `// 7d` at `src/auth/jwt.ts:27` also disagrees with the `30d` constant it actually uses.

2. **DRIFT:** bcrypt cost factor documented as **`12`** (ARCHITECTURE.md auth model line 80 + users-table note line 48 + key-config line 115; IMPLEMENTATION_PLAN Phase 1 line 12 + Phase 2 line 25) **vs** code `bcryptCost: 8` (`src/config.ts:12`, SSOT). The stale comment `// cost 12` at `src/routes/auth.ts:28` also disagrees with the value it passes.

3. **DRIFT:** Default page size documented as **`20`** (PRD R4 line 47; CONTEXT.md line 24; ARCHITECTURE.md line 106 + line 116; IMPLEMENTATION_PLAN Phase 1 line 13 + Phase 3 line 41; README.md line 81) **vs** code `defaultPageSize: 50` (`src/config.ts:25`, SSOT).

4. **DRIFT:** Access-token TTL documented as **`30 minutes`** in README.md ("Auth" section, line 46) **vs** `15m` everywhere else (PRD R2 line 34; ARCHITECTURE.md lines 83/114; CONTEXT.md line 23; IMPLEMENTATION_PLAN line 27) and in code `accessTokenTtl: '15m'` (`src/config.ts:10`). README is the outlier.

5. **DRIFT:** Rate-limit max documented as **`250` requests / window** in ARCHITECTURE.md key-config table (line 119) **vs** `100` in PRD R8 (line 66), README.md (line 114), CONTEXT.md (line 25), IMPLEMENTATION_PLAN Phase 4 (line 51), and code `rateLimit.max: 100` (`src/config.ts:31`). The architecture table is the outlier.

6. **DRIFT:** Health-check body specified as **`{ "status": "ok" }`** (PRD R9 line 71; ARCHITECTURE.md line 95; IMPLEMENTATION_PLAN Phase 4 line 57) **vs** code returning `{ status: 'healthy' }` (`src/index.ts:19`).

7. **DRIFT:** Task status enum is **`todo | in_progress | done`** (PRD R6 line 56; ARCHITECTURE.md data model line 70; README.md lines 78/99; IMPLEMENTATION_PLAN Phase 3 line 42; `src/types.ts:3`; `src/schema.sql:30`) **vs** the validation list `const STATUSES: TaskStatus[] = ['todo', 'done']` in `src/routes/tasks.ts:11`, which omits `in_progress`. Effect: `GET /tasks?status=in_progress` and `PATCH` with `status:"in_progress"` are rejected with `400` (lines 23, 125), and `POST` with `status:"in_progress"` silently downgrades to `todo` (line 79). R6 is not satisfied by the code.

8. **DRIFT:** Tasks description column is named **`description`** in ARCHITECTURE.md data model (line 69), `src/types.ts:26`, and all SQL in `src/routes/tasks.ts` (INSERT line 85, UPDATE line 139, `SELECT *`) **vs** `src/schema.sql:29` which defines the column as **`details TEXT NULL`**. There is no `description` column in the shipped schema, so `POST /tasks` and `PATCH /tasks/:id` (R3/R5) would fail at runtime with an unknown-column error against this schema. Also contradicts IMPLEMENTATION_PLAN Phase 1's "schema matches architecture exactly" (line 15).

9. **DRIFT:** `GET /tasks` response envelope documented as **`{ data: Task[], page, page_size, total }`** (ARCHITECTURE.md line 106; IMPLEMENTATION_PLAN Phase 3 line 41; README.md line 86) **vs** code returning **`{ items: data, page, page_size, total }`** (`src/routes/tasks.ts:56`) — the array key is `items`, not `data`.

10. **DRIFT:** Completion webhook (R7) documented as firing on transition to `done` — "the tasks route calls `services/webhook.ts`" (ARCHITECTURE.md "Webhook flow" lines 127–132), PRD R7 (lines 59–63), CONTEXT.md line 26, README.md lines 102–110, and IMPLEMENTATION_PLAN Phase 4 marked DONE (line 55) — **vs** code where `fireTaskCompleted` (`src/services/webhook.ts:9`) is **never imported or called**. The `PATCH` handler (`src/routes/tasks.ts:118–148`) updates the row and returns; the only mention of the webhook is the comment on line 117. R7 is unimplemented despite being marked shipped. (Sub-note: the architecture also specifies the "was not `done` before" transition guard; the service contains no such guard and the route passes it no prior status — moot only because it is never invoked.)

11. **DRIFT:** IMPLEMENTATION_PLAN Phase 4 acceptance claims **"Task list responses are cached in Redis with a `60s` TTL (cache-aside)"** (line 53) **vs** reality: no Redis in ARCHITECTURE.md stack, no `redis`/`ioredis` in `package.json`, and no caching anywhere in `src/routes/tasks.ts`. The claimed component does not exist.

12. **DRIFT (internal, CONTEXT self-contradiction + code):** CONTEXT.md line 13 lists Phase 2 as shipping a **"token refresh endpoint ✅"**, but (a) CONTEXT.md line 34 itself lists *"A `POST /auth/refresh` endpoint"* as a not-yet-scheduled future candidate, (b) PRD R2 says "Refreshing is out of scope for v1 endpoints," (c) ARCHITECTURE.md's API surface has no `/auth/refresh`, and (d) `src/routes/auth.ts` defines only `/register` and `/login`. No refresh endpoint exists.

13. **DRIFT:** CONTEXT.md line 17 states *"The public surface is the **8 routes** documented in `ARCHITECTURE.md` **plus** `GET /health`"* (implying 9 endpoints) **vs** ARCHITECTURE.md's API-surface table (lines 93–102), whose 8 rows **already include** `GET /health`, leaving only **7** non-health routes. The "8 + health" count is off by one in either reading; code (`src/index.ts` + routers) exposes 7 non-health routes + health = 8 total.

14. **DRIFT:** CONTEXT.md line 10 ("**Shipped — all four phases complete**") and IMPLEMENTATION_PLAN status summary (lines 63–64, "implements every requirement R1–R9") **vs** code: R6 broken (#7), R7 absent (#10), R3/R5 runtime-broken against the shipped schema (#8), and the Phase-4 Redis cache never built (#11). The blanket "shipped / R1–R9 complete" claim is overstated.

**Facts that are consistent (no drift), for completeness:** HTTP port `4000` (all docs + `src/config.ts:6`); max page size `100` (all docs + `src/config.ts:26`); webhook timeout `3000 ms` (all docs + `src/config.ts:35`); rate-limit window `15 min` / `900000 ms`; webhook payload shape `{ event:"task.completed", task_id, project_id, completed_at }` (ARCHITECTURE/README match `src/services/webhook.ts:27–33`, though never sent); all 8 endpoint paths + HTTP methods match between ARCHITECTURE.md, README.md, and the actual routers; the `users`/`projects` table columns match the architecture; priority enum `low|medium|high` (default `medium`) matches across docs, types, schema, and `tasks.ts`.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

The docs uniformly describe a feature-complete, "all phases shipped, R1–R9 implemented" v1, but the code diverges in ways that range from runtime-breaking to silently-wrong, and two docs reference components that do not exist. Most important issues, in priority order:

1. **R7 webhook is built but never wired (§3 #10).** The headline automation feature is marked DONE across CONTEXT, README, plan, and architecture, yet `fireTaskCompleted` is never called. As shipped, no task completion ever emits a webhook.

2. **Schema/code column mismatch — `details` vs `description` (§3 #8).** Against the checked-in `schema.sql`, `POST /tasks` and `PATCH /tasks/:id` reference a nonexistent `description` column and would fail at runtime. This breaks core CRUD (R3/R5), not just a doc claim.

3. **`in_progress` status dropped in code (§3 #7).** The validator allows only `['todo','done']`, so a documented, schema-supported status is unusable via the API — R6 is violated.

4. **Invented Redis cache in the plan (§3 #11).** Phase 4 asserts a 60s Redis cache with no architecture, dependency, or code behind it — a stale/aspirational acceptance criterion presented as done.

5. **The "single source of truth" config silently disagrees with every doc (§3 #1–#3).** `src/config.ts` ships refresh TTL `30d` (docs: 7d), bcrypt cost `8` (docs: 12), and default page size `50` (docs: 20) — and even its own neighboring inline comments (`// 7d`, `// cost 12`) are stale. The file that the docs are supposed to mirror has quietly drifted from them.

6. **Lower-severity but checkable:** health body `healthy` vs `ok` (#6); list envelope `items` vs `data` (#9); README access TTL `30m` vs `15m` (#4); ARCHITECTURE rate-limit `250` vs `100` (#5); CONTEXT's self-contradicting "token refresh endpoint shipped" (#12); CONTEXT's route miscount (#13); and the overstated "R1–R9 complete" status (#14).

The architecture is the cleanest artifact (one internal rate-limit contradiction); the plan and the status/front-door claims (CONTEXT, README, plan "DONE" markers) are the least trustworthy, and `config.ts` + `schema.sql` are where the code most materially departs from its own documentation.

---

*No files were modified. This is a report only.*
