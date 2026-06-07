# Fresh-Eyes Coherence / Drift Review — taskflow-api (r2)

Reviewer: verifier (independent, no prior context). Scope read on disk:
`CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`,
all of `src/`, plus `package.json` / `tsconfig.json` for build-claim verification.

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> architecture: PASS
  - Architecture -> delivery plan: FAIL
  - Delivery/status -> code: FAIL
BLOCKING:
  - src/routes/tasks.ts: completion webhook (R7) is never invoked — feature claimed "shipped" is absent
  - src/schema.sql: task body column is `details`, but all code/docs use `description` — INSERT/UPDATE break at runtime
  - src/routes/tasks.ts: status enum `in_progress` is rejected at runtime (STATUSES omits it) — violates R6
  - src/config.ts: refresh TTL (30d), bcrypt cost (8), default page size (50) all contradict every doc (7d / 12 / 20)
  - src/index.ts: /health returns {status:"healthy"}; PRD R9/architecture/plan require {status:"ok"}
RIGOR: tuned
```

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement at the design level. Walking R1–R9:

| Req | PRD demand | Architecture coverage | Status |
|-----|------------|------------------------|--------|
| R1 | `POST /auth/register` + `POST /auth/login`, bcrypt hashes | API surface table + Auth model (cost-12 hash, 201 on register, tokens on login) | Addressed |
| R2 | JWT bearer on non-auth routes; access 15m, refresh 7d; refresh issued not consumed | Auth model + config table (15m / 7d); `/tasks` guarded by `requireAuth` | Addressed |
| R3 | `POST /tasks`, `GET /tasks/:id`; title/description/status/priority; one owned project | API surface + data model | Addressed |
| R4 | `GET /tasks` own tasks, filter status + project_id, page/page_size, default 20 max 100 | API surface query-param notes + config table | Addressed |
| R5 | `PATCH /tasks/:id`, `DELETE /tasks/:id`, ownership enforced | API surface | Addressed |
| R6 | status ∈ {todo,in_progress,done} default todo; priority ∈ {low,medium,high} default medium | tasks table ENUM columns | Addressed |
| R7 | Webhook to `projects.webhook_url` on →done, non-blocking | Webhook flow section + `services/webhook.ts` component | Addressed |
| R8 | 100 req / 15 min per IP, 429 over limit | Rate-limit component | Addressed **but** the architecture's own config table says **250** (see §3 #10) |
| R9 | Unauthenticated `GET /health` → `{status:"ok"}` | API surface table → `{status:"ok"}` | Addressed |

No requirement is unsatisfied or contradicted *by the architecture prose*, and nothing is
meaningfully overbuilt. **One internal architecture defect:** the "Key config values" table
(`ARCHITECTURE.md:119`) lists **Rate limit max = 250**, contradicting its own R8 mapping and
PRD R8 (100). That is a self-contradiction inside the architecture document.

### 2. Architecture -> Delivery Plan

The plan's phase structure maps cleanly onto the architecture components, and acceptance
criteria mostly restate the architecture's numbers. Problems:

- **Fabricated component (Redis):** `IMPLEMENTATION_PLAN.md` Phase 4 acceptance criterion
  (line 53) states *"Task list responses are cached in Redis with a 60s TTL (cache-aside)."*
  Redis appears **nowhere** in the architecture (no cache layer in Stack or Components),
  **nowhere** in `package.json` dependencies, and **nowhere** in code. The plan asserts an
  acceptance criterion for a component that was never designed or built.
- **Plan echoes the same wrong numbers it marks done:** Phase-1 criteria (default page size
  20, refresh TTL 7d, bcrypt cost 12) and the Phase-4 rate-limit (100) are all stated as
  *done*, yet shipped `config.ts` disagrees on three of them (see §3 #4–#6). The plan's
  Status summary (line 63) claims *"implements every requirement R1–R9 … No phases are
  outstanding"* — false given the missing webhook wiring (R7) and broken status enum (R6).
- **No acceptance criterion catches the webhook wiring gap.** Phase 4 says the transition
  fires the POST, but nothing verifies the PATCH route actually calls the service — and it
  does not. The webhook *service* was built (Phase 4) but never integrated into the *route*
  (Phase 3 surface), and the plan never reconciles the two.

### 3. Delivery/Status -> Code

Every concrete inconsistency, most severe first. Each is independently checkable.

1. **DRIFT (runtime-breaking): task body column name.** `src/schema.sql:29` defines the
   column `details TEXT NULL`, but `ARCHITECTURE.md:69`, `src/types.ts:26` (`description`),
   `src/routes/tasks.ts:85` (`INSERT INTO tasks (… , description, …)`), and
   `src/routes/tasks.ts:139` (`UPDATE tasks SET … description = ? …`) all use `description`.
   Against the shipped schema, `POST /tasks` and `PATCH /tasks/:id` raise *"Unknown column
   'description'"* — core CRUD does not work as documented.

2. **DRIFT (functional): completion webhook never fires.** `PRD.md` R7, `ARCHITECTURE.md`
   "Webhook flow" (lines 125–132), `IMPLEMENTATION_PLAN.md:55`, and `CONTEXT.md:26` all say
   a transition to `done` POSTs to `projects.webhook_url`. The service exists
   (`src/services/webhook.ts`, `fireTaskCompleted`) but `src/routes/tasks.ts` never imports
   or calls it — the PATCH handler (lines 118–148) updates the row and returns, despite its
   own line-117 comment *"fire webhook on -> done."* R7 is documented as shipped but absent.

3. **DRIFT (functional): `in_progress` status is unusable.** `src/routes/tasks.ts:11`
   declares `const STATUSES: TaskStatus[] = ['todo', 'done'];` — it omits `in_progress`.
   Consequently `GET /tasks?status=in_progress` returns `400 invalid status filter`
   (line 23), `POST /tasks` with `status:"in_progress"` silently falls back to `todo`
   (line 79), and `PATCH` to `in_progress` returns `400 invalid status` (line 125). This
   contradicts `PRD.md` R6, `src/types.ts:3` (`'todo' | 'in_progress' | 'done'`),
   `src/schema.sql:30` (`ENUM('todo','in_progress','done')`), `ARCHITECTURE.md:70`,
   `IMPLEMENTATION_PLAN.md:43`, and `README.md:78,99`.

4. **DRIFT: refresh-token TTL.** `src/config.ts:11` sets `refreshTokenTtl: '30d'`, but
   `PRD.md` R2 (line 35), `ARCHITECTURE.md:84` & config table line 114,
   `IMPLEMENTATION_PLAN.md:27`, `CONTEXT.md:23`, and `README.md:47` all say **7d / 7 days**.
   (`src/auth/jwt.ts:27` even carries a stale `// 7d` comment over the 30d value.)

5. **DRIFT: bcrypt cost factor.** `src/config.ts:12` sets `bcryptCost: 8`, but
   `ARCHITECTURE.md:48,80` & config table line 115, and `IMPLEMENTATION_PLAN.md:12,25` all
   say cost **12**. (`src/routes/auth.ts:28` carries a stale `// cost 12` comment over the
   cost-8 value.)

6. **DRIFT: default page size.** `src/config.ts:25` sets `defaultPageSize: 50`, but
   `PRD.md` R4 (line 47), `ARCHITECTURE.md:105` & config table line 116,
   `IMPLEMENTATION_PLAN.md:13,40`, `CONTEXT.md:24`, and `README.md:81,86` all say **20**.

7. **DRIFT: health-check response body.** `src/index.ts:19` returns `{ status: 'healthy' }`,
   but `PRD.md` R9 (line 71), `ARCHITECTURE.md:95`, and `IMPLEMENTATION_PLAN.md:57` require
   `{ status: "ok" }`.

8. **DRIFT: task-list response envelope key.** `src/routes/tasks.ts:56` returns
   `{ items: data, page, page_size, total }`, but `ARCHITECTURE.md:106`,
   `IMPLEMENTATION_PLAN.md:41`, and `README.md:86` all document the key as `data`
   (`{ data: Task[], page, page_size, total }`). A client reading `data` gets `undefined`.

9. **DRIFT: access-token TTL stated in README.** `README.md:46-47` says *"The access token
   expires after **30 minutes**,"* but `src/config.ts:10` (`accessTokenTtl: '15m'`),
   `PRD.md` R2, `ARCHITECTURE.md:83`, `IMPLEMENTATION_PLAN.md:27`, and `CONTEXT.md:23` all
   say **15m**. README is the outlier (inverse of #4 — the "30" landed on the wrong token).

10. **DRIFT: rate-limit max in architecture config table.** `ARCHITECTURE.md:119` lists
    *"Rate limit max = 250 requests / window / IP,"* contradicting `PRD.md` R8 (100),
    `src/config.ts:31` (`max: 100`), `CONTEXT.md:25`, `README.md:114`, and
    `IMPLEMENTATION_PLAN.md:52` (all 100). Code is correct; the architecture table is wrong.

11. **DRIFT: Redis cache claimed shipped, never built.** `IMPLEMENTATION_PLAN.md:53-54`
    asserts task-list responses are cached in Redis (60s TTL, cache-aside) as a *done*
    Phase-4 criterion. No Redis dependency in `package.json`, no cache code, and the
    architecture defines no cache layer. The criterion describes a nonexistent component.

12. **DRIFT: CONTEXT claims a refresh endpoint shipped.** `CONTEXT.md:13` lists Phase 2 as
    *"register/login, JWT, requireAuth, **token refresh endpoint**. ✅"* — but no refresh
    endpoint exists in `src/routes/auth.ts` (only `/register`, `/login`),
    `IMPLEMENTATION_PLAN.md` Phase 2 never lists one, and `CONTEXT.md:34` itself lists
    *"A POST /auth/refresh endpoint"* under future "What's next." CONTEXT both contradicts
    itself and over-claims shipped scope.

13. **DRIFT: "all R1–R9 implemented / all phases DONE" is false.** `IMPLEMENTATION_PLAN.md:63`
    (*"implements every requirement R1–R9"*) and `CONTEXT.md:10` (*"Shipped — all four
    phases complete"*) are contradicted by #1 (R3/R5 break at runtime), #2 (R7 absent), and
    #3 (R6 partially unimplemented).

14. **DRIFT (minor): route count in CONTEXT.** `CONTEXT.md:17` says *"the 8 routes documented
    in `ARCHITECTURE.md` plus `GET /health`."* The architecture's API-surface table
    (`ARCHITECTURE.md:93-102`) already **includes** `/health` among its 8 rows (7 non-health
    + health). The phrasing double-counts health, implying 9 routes.

15. **DRIFT (minor, secondary to #4/#5): stale inline comments.** `src/auth/jwt.ts:27`
    (`// 7d`) and `src/routes/auth.ts:28` (`// cost 12`) describe the documented values, not
    the actual config values (30d, 8). The comments are themselves drift markers.

### 4. Verdict

**SIGNIFICANT DRIFT.**

This build is documented as "feature-complete, all phases DONE, every requirement R1–R9
implemented," but the code does not support that claim. In order of importance:

1. **Core task CRUD is broken against the shipped schema** (#1): the `details` vs
   `description` column mismatch makes `POST`/`PATCH /tasks` fail at runtime — yet R3/R5 are
   marked done.
2. **R7 webhook is entirely unwired** (#2): the service exists but no route calls it, so the
   single headline automation feature never runs despite four documents asserting it does.
3. **R6 is only partially implemented** (#3): `in_progress`, a first-class status in the
   type, schema, and every doc, is rejected by the route's validation array.
4. **Three config constants silently disagree with 100% of the docs** (#4 refresh 30d vs 7d,
   #5 bcrypt 8 vs 12, #6 page size 50 vs 20) — and these are exactly the "single source of
   truth" values `config.ts:2` claims to anchor.
5. **Documented response contracts are wrong** (#7 health body, #8 envelope key) — each will
   break a client written to the README/architecture.
6. **Internal doc contradictions and phantom components** (#10 rate-limit 250, #11 Redis,
   #12 refresh endpoint, #13 the global "done" claim) mean the docs cannot be trusted as a
   description of the running system without code verification.

Items #4–#10 are mechanical and low-risk to reconcile (pick the source of truth, align the
other side). #1, #2, and #3 are functional defects that would fail acceptance testing and
must be fixed in code, not just docs. The "all phases DONE / all R1–R9 shipped" status
claims should be retracted until at least #1–#3 are resolved.

---

**Open Questions** — none blocking; the drift directions are unambiguous from the artifacts.
The one judgment call for the owner: for #4–#6 and #9–#10, is the *doc* value or the *code*
value the intended one? (For #1–#3 the code is simply wrong against unanimous docs.)

**Verification Evidence** — all line cites above were read directly from disk this run:
`src/config.ts`, `src/index.ts`, `src/routes/tasks.ts`, `src/routes/auth.ts`,
`src/auth/jwt.ts`, `src/schema.sql`, `src/types.ts`, `src/services/webhook.ts`,
`package.json` (no `redis` dep; `grep -ri redis` over `src` returns nothing), and the five
docs. Tests were not run (no test suite exists in the repo); findings are by static
cross-reference, which is sufficient for the column-name, unwired-webhook, and enum defects.

**Residual Risk** — review covered the named artifacts plus `package.json`. `tsconfig.json`
contents and `dist/` build output were not deeply inspected; a `tsc` compile would surface
nothing new for these findings (they are runtime/semantic, not type errors — the bad SQL
column and the unwired webhook both type-check cleanly).

*Report only — no files were modified outside this run directory.*
