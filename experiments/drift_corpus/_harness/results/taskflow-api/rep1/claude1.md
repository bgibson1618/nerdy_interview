# Independent Sanity / Coherence Review — taskflow-api (r1-claude1)

Reviewer: verifier (fresh eyes, on-disk artifacts only)
Scope reviewed: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`,
`README.md`, all of `src/`, plus `package.json`.

```text
VERDICT: FAIL
DIMENSIONS:
  - Source brief -> Architecture: PASS (one internal contradiction in ARCHITECTURE)
  - Architecture -> Delivery plan: FAIL (plan invents a Redis cache component not in arch/code)
  - Delivery/Status -> Code: FAIL (14 concrete doc/code drifts; 3 are runtime-breaking)
BLOCKING:
  - src/schema.sql: tasks column is `details`; code inserts/reads `description` -> every task write 500s
  - src/routes/tasks.ts: completion webhook (R7) is never invoked; service is dead code
  - src/routes/tasks.ts: STATUSES omits `in_progress`, so a documented status is unusable
  - src/config.ts: refreshTTL/bcryptCost/defaultPageSize all silently disagree with every doc
RIGOR: tuned
```

---

### 1. Source Brief -> Architecture

Going requirement by requirement (PRD R1–R9 vs `ARCHITECTURE.md`). The architecture
*as written* satisfies the brief almost completely; the gaps below are mostly drift
that surfaces in §3, plus one internal contradiction inside ARCHITECTURE itself.

| Req | Addressed in architecture? | Notes |
|-----|----------------------------|-------|
| **R1** register/login + bcrypt | YES | Auth model + API surface both list `POST /auth/register`, `POST /auth/login`; bcrypt cost 12 specified. |
| **R2** JWT, access 15m / refresh 7d, refresh issued at login | YES | Auth model and config table both say access `15m`, refresh `7d`. Consistent with PRD. |
| **R3** `POST /tasks`, `GET /tasks/:id` | YES | Present in API surface table. |
| **R4** `GET /tasks` filter `status`/`project_id`, paginate, default 20 / max 100 | YES | Query-param section + config table (`20`/`100`) match PRD. Envelope specified as `{ data, page, page_size, total }`. |
| **R5** `PATCH`/`DELETE /tasks/:id` + ownership | YES | Present in API surface; ownership implied by "caller's tasks". |
| **R6** status `todo/in_progress/done` (def `todo`), priority `low/medium/high` (def `medium`) | YES | Data-model ENUMs match exactly. |
| **R7** completion webhook to `projects.webhook_url`, non-blocking | YES | Dedicated "Webhook flow" section + `services/webhook.ts` component + `projects.webhook_url` column. |
| **R8** rate-limit 100 / 15 min, `429` | **CONTRADICTED inside ARCHITECTURE** | Prose maps R8, but the "Key config values" table (line 119) lists **`250` requests / window / IP**, not the PRD-mandated **100**. ARCHITECTURE disagrees with the PRD *and with itself* (the R8 narrative). |
| **R9** unauth `GET /health` -> `{ "status": "ok" }` | YES | API surface + config notes specify `{ status: "ok" }`. |

Other observations:

- **Overview vs requirements mismatch (under-specified, not contradicted):** PRD Overview/Goals
  say users "group work into **projects**… and **manage projects**," but no numbered requirement
  mandates project CRUD, and ARCHITECTURE deliberately ships **no** project endpoints (projects are
  seeded in the DB — confirmed by CONTEXT line 35). This is internally consistent across the docs,
  but the word "manage projects" in the brief has no endpoint behind it. Worth a one-line scope note.
- Nothing is meaningfully **overbuilt** at the architecture level.

**Section 1 verdict:** Architecture satisfies the brief, with one real defect: the ARCHITECTURE
"Key config values" table contradicts PRD R8 (and its own R8 prose) on the rate-limit number.

---

### 2. Architecture -> Delivery Plan

The plan's four phases map cleanly onto the architecture's components and cite the right
requirement IDs. Three problems:

- **Invented component (Redis cache).** `IMPLEMENTATION_PLAN.md` Phase 4 acceptance criteria
  (lines 53–54) require: *"Task list responses are cached in Redis with a 60s TTL (cache-aside)
  to cut database load."* **Nothing in `ARCHITECTURE.md` mentions Redis or caching** — not the
  stack, not the components, not the config table. There is no Redis dependency in `package.json`
  and no cache code in `src/`. The plan asserts an acceptance criterion for a component the
  architecture never specified and the code never built, yet still marks Phase 4 **✅ DONE**. This
  is a stale/invented assumption and the plan's strongest internal incoherence.

- **Rate-limit number disagreement carried into the plan.** Plan Phase 1 (line 13) and Phase 4
  (line 51) both say rate limit **`100` / `15 min`**, matching the PRD — but **disagreeing with
  ARCHITECTURE's config table (250)**. So the plan is right vs the PRD and wrong vs the architecture
  it claims to "map directly onto." Whichever is canonical, the three docs do not agree.

- **Status claim overstates reality.** The plan's "Status summary" (lines 61–64) declares all four
  phases DONE and *"The API implements every requirement R1–R9."* In fact R7 (webhook) is not wired
  into any route and the Redis criterion was never built (see §3). The "implements every requirement"
  claim is false.

Sequencing itself is fine (foundation → auth → tasks → hardening); the acceptance criteria are
otherwise concrete and checkable.

**Section 2 verdict:** FAIL — the plan references a Redis caching component that neither the
architecture nor the code contains, and its "all R1–R9 implemented" status claim is untrue.

---

### 3. Delivery/Status -> Code  (explicit numbered drift list)

Each item is one concrete inconsistency. Items 1–3 are **runtime-breaking**; the rest are spec/value drift.

1. **DRIFT (runtime-breaking):** ARCHITECTURE tasks table (line 69) `description TEXT NULL`,
   `src/types.ts:26` `description`, and `src/routes/tasks.ts:85,87,139` INSERT/UPDATE a
   `description` column — **vs** `src/schema.sql:29` which defines the column as **`details`**.
   `INSERT INTO tasks (... description ...)` and `SELECT *` against this schema will error /
   return the wrong field. Schema and code/architecture use different column names.

2. **DRIFT (runtime-breaking):** PRD R7, ARCHITECTURE "Webhook flow" (lines 125–132), CONTEXT
   (line 26), and IMPLEMENTATION_PLAN Phase 4 (line 55) all claim a task transition to `done`
   POSTs a completion webhook — **vs** `src/routes/tasks.ts` PATCH handler (lines 118–148), which
   updates the row and **never calls `fireTaskCompleted`**. `src/services/webhook.ts` is never
   imported anywhere (grep-confirmed: the only reference in `tasks.ts` is the comment on line 117).
   R7 is dead code; the webhook never fires.

3. **DRIFT (runtime-breaking):** PRD R6, ARCHITECTURE data model (line 70), `src/types.ts:3`, and
   `src/schema.sql:30` all define status set `todo | in_progress | done` — **vs**
   `src/routes/tasks.ts:11` `const STATUSES: TaskStatus[] = ['todo', 'done']`, which **omits
   `in_progress`**. Consequence: `GET /tasks?status=in_progress` returns `400 invalid status filter`,
   and `POST`/`PATCH` with `status: "in_progress"` is silently coerced to `todo` (lines 79, 125).
   A documented, valid status value is unusable.

4. **DRIFT:** Refresh-token TTL is `7d` in PRD R2 (line 35), ARCHITECTURE auth model (line 85) and
   config table (line 114), CONTEXT (line 23), IMPLEMENTATION_PLAN Phase 2 (line 27), and README
   (line 47) — **vs** `src/config.ts:11` `refreshTokenTtl: '30d'`. Code issues 30-day refresh tokens.
   (Compounded by a stale comment: `src/auth/jwt.ts:27` says `// 7d` next to the 30d constant.)

5. **DRIFT:** README "Auth" section (line 46) says *"The access token expires after **30 minutes**"*
   — **vs** PRD R2 / ARCHITECTURE / CONTEXT / IMPLEMENTATION_PLAN and `src/config.ts:10`
   (`accessTokenTtl: '15m'`), all of which say **15 minutes**. README contradicts every other source
   *and* the code on access-token lifetime.

6. **DRIFT:** bcrypt cost is `12` in ARCHITECTURE (lines 48, 80, config table line 115) and
   IMPLEMENTATION_PLAN Phase 1/2 (lines 12, 25) — **vs** `src/config.ts:12` `bcryptCost: 8`.
   (Compounded by a stale comment: `src/routes/auth.ts:28` says `// cost 12` next to the call that
   passes the value `8`.)

7. **DRIFT:** Default page size is `20` in PRD R4 (line 47), ARCHITECTURE (lines 105, 116), CONTEXT
   (line 24), IMPLEMENTATION_PLAN (lines 12, 40), and README (lines 81, 86) — **vs**
   `src/config.ts:25` `defaultPageSize: 50`. Listing with no `page_size` returns 50 items, not 20.

8. **DRIFT:** Rate-limit max is `100` in PRD R8 (line 67), CONTEXT (line 25), IMPLEMENTATION_PLAN
   (line 51), README (line 114), and `src/config.ts:31` (`max: 100`) — **vs** ARCHITECTURE "Key
   config values" table (line 119) which says **`250` requests / window / IP**. The code is correct;
   ARCHITECTURE is the outlier (and contradicts its own R8 prose).

9. **DRIFT:** Health-check body is `{ "status": "ok" }` in PRD R9 (line 71), ARCHITECTURE (line 95),
   and IMPLEMENTATION_PLAN Phase 4 (line 57) — **vs** `src/index.ts:19`
   `res.json({ status: 'healthy' })`. The endpoint returns `healthy`, not `ok`.

10. **DRIFT:** List-response envelope is `{ data, page, page_size, total }` in ARCHITECTURE (line 106),
    IMPLEMENTATION_PLAN (line 41), and README (lines 84–87) — **vs** `src/routes/tasks.ts:56`
    `res.json({ items: data, page, page_size: pageSize, total })`. The payload key is **`items`**, not
    `data`; any client coded to the documented envelope reads `undefined`.

11. **DRIFT:** IMPLEMENTATION_PLAN Phase 4 (lines 53–54) claims *"Task list responses are cached in
    Redis with a 60s TTL (cache-aside)"* as DONE acceptance — **vs** the code/deps: no Redis import,
    no cache logic in `src/` (grep-confirmed), and no `redis` entry in `package.json`. The claimed
    component does not exist.

12. **DRIFT:** CONTEXT line 13 lists Phase 2 as including a *"token refresh endpoint. ✅"* (shipped) —
    **vs** `src/routes/auth.ts`, which exposes only `POST /auth/register` and `POST /auth/login` (no
    refresh route), the ARCHITECTURE API-surface table (no refresh route), PRD R2 ("Refreshing is out
    of scope for v1 endpoints"), and CONTEXT's own "What's next" (line 34), which lists
    `POST /auth/refresh` as a *future, not-yet-built* follow-up. CONTEXT contradicts itself and the code.

13. **DRIFT (doc/status overstatement):** IMPLEMENTATION_PLAN "Status summary" (lines 62–64) and CONTEXT
    (line 10) declare the build feature-complete and *"implements every requirement R1–R9."* Given items
    1–3 and 11, R7 (webhook) is not wired, the Redis criterion was never built, and `in_progress` is
    unusable — the "all shipped / every requirement implemented" status claim is not true.

14. **DRIFT (minor, count):** CONTEXT line 17 says *"the public surface is the 8 routes documented in
    `ARCHITECTURE.md` **plus** `GET /health`"* — **vs** the ARCHITECTURE API-surface table (lines 93–102),
    which is **8 rows total *including* `/health`** (7 task/auth routes + health). CONTEXT double-counts
    health, implying 9.

Stale in-code comments worth flagging alongside the above (code-vs-code): `src/auth/jwt.ts:27`
(`// 7d` over a `30d` value, item 4), `src/routes/auth.ts:28` (`// cost 12` over cost `8`, item 6),
and `src/index.ts:23` (`// R3-R7 (auth-guarded)` while R7 is never invoked, item 2).

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

This project's docs uniformly claim "all four phases complete, every requirement R1–R9 implemented,"
but the code diverges from that claim in 14 concrete places, three of which break at runtime. Most
important first:

1. **Schema column `details` vs code `description` (item 1)** — task create/read/update target a
   column the schema does not define. Core CRUD (R3/R5) cannot work against the shipped `schema.sql`.
2. **Completion webhook never fires (item 2)** — R7 is documented as shipped in four places, but the
   PATCH route never calls the webhook service. The feature does not exist at runtime despite the
   service file existing.
3. **`in_progress` status unusable (item 3)** — a documented enum member is rejected on filter and
   silently downgraded on write, violating R6 and the schema/types.
4. **Config values silently disagree with every doc (items 4, 6, 7)** — refresh TTL (30d vs 7d),
   bcrypt cost (8 vs 12), default page size (50 vs 20). `config.ts`'s own header calls itself "the
   single source of truth referenced by the docs," yet it matches none of them.
5. **Contract-shape drift (items 9, 10)** — health returns `healthy` not `ok`; list envelope key is
   `items` not `data`. Both will silently break conforming clients.
6. **Doc-vs-doc contradictions (items 5, 8, 11, 12, 14)** — README access-TTL (30 min), ARCHITECTURE
   rate-limit (250), the plan's phantom Redis cache, CONTEXT's "refresh endpoint shipped" vs its own
   "what's next," and the route-count miscount. The documents disagree with each other independent
   of the code.

Recommendation: do not treat this build as "done." Reconcile `config.ts` and `schema.sql` to the
documented values, wire `fireTaskCompleted` into the PATCH→`done` transition, restore `in_progress`
to the runtime `STATUSES`, fix the `health`/`items` response shapes, and resolve the three doc-vs-doc
contradictions (README access TTL, ARCHITECTURE rate-limit, plan's Redis criterion) before any
milestone or "shipped" call.
