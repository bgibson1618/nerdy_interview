# taskflow-api — Fresh-Eyes Coherence / Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - source-brief -> architecture: PASS (one internal contradiction)
  - architecture -> delivery-plan: FAIL
  - delivery/status -> code: FAIL
BLOCKING:
  - src/routes/tasks.ts: completion webhook (R7) is never invoked — fireTaskCompleted() is dead code, yet all docs mark R7 "shipped".
  - src/schema.sql: tasks column is `details`, but code INSERT/UPDATE and types use `description` — task create/update fail at runtime.
  - src/routes/tasks.ts: STATUSES omits `in_progress`, so R6's documented status lifecycle is only partially implemented.
  - src/config.ts: refresh TTL (30d vs 7d), default page size (50 vs 20), bcrypt cost (8 vs 12) all violate the documented values (R2/R4).
  - src/index.ts: GET /health returns `{status:"healthy"}`, not the `{status:"ok"}` required by R9.
  - IMPLEMENTATION_PLAN.md Phase 4: claims Redis 60s cache that exists in no doc, dependency, or code.
RIGOR: tuned
```

Scope: independent, fresh-eyes review of `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, and all code under `src/`. No prior context used.
I did not modify any project file. Findings below cite file paths and line numbers.

---

### 1. Source Brief -> Architecture

The architecture covers every PRD requirement at the design level. Coverage table:

| Req | Requirement (PRD) | Architecture coverage | Verdict |
|-----|-------------------|-----------------------|---------|
| R1 | `POST /auth/register` + `POST /auth/login`, bcrypt hashing | API surface table + "Auth model" (bcrypt cost 12, register 201, login two JWTs) | Addressed |
| R2 | Stateless JWT; access 15m, refresh 7d; refresh issued not consumed | "Auth model" + config table (15m / 7d) | Addressed |
| R3 | `POST /tasks`, `GET /tasks/:id`; title/description/status/priority/project | API surface + data model | Addressed |
| R4 | `GET /tasks` filter status/project_id, paginate page/page_size, default 20 / max 100 | API surface ("query parameters" note) + config table (20/100) | Addressed |
| R5 | `PATCH`/`DELETE /tasks/:id` with ownership | API surface table | Addressed |
| R6 | status ∈ {todo,in_progress,done} default todo; priority ∈ {low,medium,high} default medium | `tasks` table ENUMs | Addressed |
| R7 | Completion webhook to `projects.webhook_url`, non-blocking | "Webhook flow (R7)" section | Addressed |
| R8 | Rate limit 100 req / 15 min per IP, return 429 | config table — **but value listed is 250, not 100** | Addressed but contradicted (see below) |
| R9 | Unauthenticated `GET /health` → `{status:"ok"}` | API surface table (`{status:"ok"}`) | Addressed |

Issues at the architecture level:

- **R8 internal contradiction in ARCHITECTURE.md.** The "Key config values" table
  (`ARCHITECTURE.md:119`) lists **`Rate limit max = 250` requests / window / IP**, while
  the PRD (R8), CONTEXT, README, and the embedded config comment all say **100**. The
  architecture document contradicts the brief it is supposed to satisfy.
- No architecture-level overbuild relative to the PRD. (The Redis cache overbuild appears
  only in the delivery plan — see §2.)

Net: architecture is faithful to the PRD except the 250-vs-100 rate-limit value.

---

### 2. Architecture -> Delivery Plan

The plan's four phases map cleanly onto the architecture's components and carry acceptance
criteria. Most Phase 1–3 criteria restate PRD/architecture values correctly (port 4000,
15m/7d, page 20/100, bcrypt 12, status/priority enums). Problems:

- **Phantom component — Redis cache.** `IMPLEMENTATION_PLAN.md:53-54` (Phase 4 acceptance)
  states: *"Task list responses are cached in Redis with a 60s TTL (cache-aside)."* Redis
  appears **nowhere** in the architecture, in `package.json` dependencies, or in any source
  file (`grep` for redis/cache → none). This is a plan acceptance criterion referencing a
  component that does not exist anywhere else in the project — a stale/overbuilt assumption.
- **Plan asserts values the architecture itself contradicts.** Phase 4 acceptance says the
  limiter caps each IP at `100` per `15 min`; the architecture config table says `250`. The
  plan silently disagrees with the architecture (and the plan happens to match the PRD).
- **Refresh-TTL drift latent in the plan-vs-architecture chain.** Phase 2 acceptance says
  refresh token expires in `7d`, consistent with the architecture; the divergence is in the
  code (§3, item 4).
- **"All four phases DONE / every requirement R1–R9 implemented"** (`IMPLEMENTATION_PLAN.md:62-64`)
  is not supportable: R7 (webhook) is not wired up, R9 returns the wrong body, and R6 is
  only partially implemented (see §3). The done-claim is the central drift between status
  docs and code.

---

### 3. Delivery/Status -> Code

Every concrete doc-vs-code (or doc-vs-doc) inconsistency, as a checkable numbered list:

1. **DRIFT: Completion webhook never fires.** `PRD.md` R7, `ARCHITECTURE.md:125-132`
   ("Webhook flow"), `CONTEXT.md:26`, `IMPLEMENTATION_PLAN.md:55-56`, and `README.md:102-110`
   all say a transition to `done` POSTs to the project webhook. In code,
   `src/services/webhook.ts` (`fireTaskCompleted`) is **never imported or called** — the
   PATCH handler `src/routes/tasks.ts:117-148` updates the row and returns with no webhook
   call (the line 117 comment "fire webhook on -> done" is aspirational). `grep` confirms no
   reference to `fireTaskCompleted`/`services/webhook` outside the dead module itself. R7 is
   unimplemented despite being marked shipped.

2. **DRIFT: tasks schema column name.** `src/schema.sql:29` defines the column **`details`**,
   but `ARCHITECTURE.md:69` (`description` TEXT NULL), `src/types.ts:25` (`description`), and
   the code's INSERT/UPDATE (`src/routes/tasks.ts:85` and `:139`, both `description`) use
   **`description`**. Running the documented DDL makes `POST /tasks` and `PATCH /tasks/:id`
   fail with "Unknown column 'description'", and `SELECT *` would return `details`, leaving
   `Task.description` undefined. Code and schema cannot both be right.

3. **DRIFT: status enum missing `in_progress` in code.** `PRD.md` R6, `ARCHITECTURE.md:70`,
   `src/types.ts:3`, `src/schema.sql:30`, `IMPLEMENTATION_PLAN.md:43`, and `README.md:78,99`
   all list **`todo | in_progress | done`**. But `src/routes/tasks.ts:11` declares
   `const STATUSES: TaskStatus[] = ['todo', 'done']`. Effect: `?status=in_progress` filtering
   returns `400 invalid status filter` (`:23`), creating with `in_progress` silently coerces
   to `todo` (`:79`), and `PATCH` to `in_progress` returns `400 invalid status` (`:125`).
   The middle lifecycle state is unusable.

4. **DRIFT: refresh token TTL.** `PRD.md` R2 (7 days), `ARCHITECTURE.md:85,114`,
   `CONTEXT.md:23`, `IMPLEMENTATION_PLAN.md:27`, and `README.md:47` all say **7d**. Code
   `src/config.ts:11` sets `refreshTokenTtl: '30d'`. The comment at `src/auth/jwt.ts:27`
   still says `// 7d`, so even the code's own comment is stale.

5. **DRIFT: default page size.** `PRD.md` R4 ("default page size MUST be 20"),
   `ARCHITECTURE.md:106,116`, `CONTEXT.md:24`, `IMPLEMENTATION_PLAN.md:40`, and `README.md:81,86`
   all say **20**. Code `src/config.ts:25` sets `defaultPageSize: 50`. (Max page size 100
   matches — no drift there.)

6. **DRIFT: bcrypt cost factor.** `ARCHITECTURE.md:48,80,115` and `IMPLEMENTATION_PLAN.md:12,25`
   say cost **12**. Code `src/config.ts:12` sets `bcryptCost: 8`. The comment at
   `src/routes/auth.ts:28` still says `// cost 12`, contradicting the value it passes.

7. **DRIFT: health-check response body.** `PRD.md` R9, `ARCHITECTURE.md:95`, and
   `IMPLEMENTATION_PLAN.md:57` require `{ "status": "ok" }`. Code `src/index.ts:19` returns
   `res.json({ status: 'healthy' })`. Liveness probes asserting `"ok"` would fail.

8. **DRIFT: list-response envelope key.** `ARCHITECTURE.md:106` and `:98`, `IMPLEMENTATION_PLAN.md:41`,
   and `README.md:86` document the list envelope as `{ data, page, page_size, total }`. Code
   `src/routes/tasks.ts:56` returns `{ items: data, page, page_size, total }` — the array
   key is **`items`**, not `data`. Any client reading `response.data` gets `undefined`.

9. **DRIFT: Redis list cache claimed but absent.** `IMPLEMENTATION_PLAN.md:53-54` says task
   list responses are cached in Redis (60s TTL, cache-aside). No Redis dependency in
   `package.json`, no cache code in `src/routes/tasks.ts`, and no mention in ARCHITECTURE,
   CONTEXT, or README. The plan claims a component that does not exist.

10. **DRIFT: rate-limit max, doc-vs-doc.** `ARCHITECTURE.md:119` lists rate limit max **250**;
    `PRD.md` R8, `CONTEXT.md:25`, `README.md:114`, `IMPLEMENTATION_PLAN.md:51`, and code
    `src/config.ts:31` (`max: 100`) all say **100**. The architecture config table is the
    lone outlier. (Code matches the PRD here, so the bug is in ARCHITECTURE.)

11. **DRIFT: README access-token TTL.** `README.md:46-47` says the access token "expires
    after **30 minutes**." `PRD.md` R2, `ARCHITECTURE.md:83,113`, `CONTEXT.md:23`, and code
    `src/config.ts:10` (`accessTokenTtl: '15m'`) all say **15 minutes**. README is the
    outlier (and note this is a *different* number from the code's refresh-TTL bug in item 4).

12. **DRIFT: CONTEXT claims a refresh endpoint shipped.** `CONTEXT.md:13` lists Phase 2 as
    including a "token refresh endpoint. ✅". No such endpoint exists: `ARCHITECTURE.md`'s API
    surface (`:93-102`) has none, `src/routes/auth.ts` defines only `/register` and `/login`,
    and `index.ts` mounts nothing else under `/auth`. `CONTEXT.md:34` even lists
    `POST /auth/refresh` as a *future, unscheduled* follow-up — so CONTEXT contradicts itself
    and the code. (PRD R2 correctly scopes refresh out of v1; the code is right, CONTEXT line 13
    is wrong.)

13. **DRIFT (minor): route-count statement.** `CONTEXT.md:17` says the public surface is "the
    8 routes documented in `ARCHITECTURE.md` plus `GET /health`." The architecture's API table
    (`:93-102`) has 8 rows *including* `/health` (7 non-health routes + health). "8 routes plus
    health" double-counts and implies 9; the true total is 8.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

Status docs uniformly claim "all four phases DONE / every requirement R1–R9 implemented"
(`IMPLEMENTATION_PLAN.md:62-64`, `CONTEXT.md:10`), but the code does not back that up. The
drift is not cosmetic — multiple requirements are broken or unbuilt, and one defect makes the
core task flow fail at runtime against the shipped schema.

Most important issues, first:

1. **Task create/update is broken against the documented schema (item 2).** Schema column
   `details` vs code/`types`/architecture `description` — `POST`/`PATCH /tasks` would throw
   "Unknown column 'description'." This is a runtime-breaking, ship-blocking mismatch.
2. **R7 webhook is entirely unwired (item 1).** `fireTaskCompleted` is dead code; the feature
   the PRD, architecture, plan, CONTEXT, and README all describe as shipped does nothing.
3. **R6 status lifecycle is half-implemented (item 3).** `in_progress` cannot be set or
   filtered; it silently downgrades to `todo` on create — a data-integrity hazard.
4. **R9 health body wrong (item 7)** and **R2/R4 config values wrong** (refresh 30d not 7d
   item 4; default page size 50 not 20 item 5; bcrypt cost 8 not 12 item 6) — direct
   requirement violations, all in `src/config.ts`/`src/index.ts`.
5. **Documented client contract broken (item 8):** list envelope returns `items`, not `data`.
6. **Doc-only defects:** Redis cache claimed but absent (item 9); ARCHITECTURE rate-limit 250
   vs PRD 100 (item 10); README access token 30m vs 15m (item 11); CONTEXT claims a refresh
   endpoint that doesn't exist and contradicts itself (item 12); route miscount (item 13).

Recommendation: do not treat this build as done. The "DONE/shipped" claims in
`IMPLEMENTATION_PLAN.md`, `CONTEXT.md`, and `README.md` are stale relative to the code, and
several config/schema values must be reconciled to a single source of truth before any
release or demo.

---

*Report only — no files were changed. No open questions; the divergences above are
self-evident from the artifacts on disk.*
