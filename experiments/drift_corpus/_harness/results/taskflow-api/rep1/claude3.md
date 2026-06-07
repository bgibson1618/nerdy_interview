# taskflow-api — Independent Coherence / Drift Review

**Reviewer:** verifier (fresh eyes, on-disk only)
**Scope:** CONTEXT.md, PRD.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, README.md, all of `src/`
**Method:** Cross-checked every checkable fact (endpoints, methods, config numbers, enums, schema field names, response envelopes, TTLs, feature/“shipped” claims) doc-vs-doc and doc-vs-code.

---

### 1. Source Brief -> Architecture

The architecture broadly mirrors the PRD’s shape (same endpoints, same data model, same auth model), but the **ARCHITECTURE “Key config values” table contradicts the PRD on a hard number**, and it carries the same latent drift the code does.

| PRD requirement | Addressed in ARCHITECTURE? | Note |
|---|---|---|
| **R1** register/login, bcrypt hashing | Yes | Auth model §, API surface § both present. |
| **R2** JWT stateless; access **15m**, refresh **7d**; refresh issued not consumed | Partially | Access 15m ✅. Refresh **7d** is stated in prose (line 114) — but see §3: code is 30d. Architecture itself is internally consistent here; code drifts from it. |
| **R3** `POST /tasks`, `GET /tasks/:id`; title/description/status/priority; one project | Yes | API surface + data model present. |
| **R4** `GET /tasks` filter status/project_id; page/page_size; default **20**, max **100** | **Contradicted in part** | Architecture says default 20 / max 100 (line 116-117) ✅ vs PRD — but the *response envelope* it specifies (`{ data, … }`, line 106) is not what the code emits (see §3). Architecture matches PRD; code is the violator. |
| **R5** `PATCH`/`DELETE /tasks/:id`, ownership enforced | Yes | API surface present. |
| **R6** status `todo|in_progress|done` default `todo`; priority `low|medium|high` default `medium` | Yes | Data-model ENUMs correct. |
| **R7** completion webhook on →`done`, only if `webhook_url` set, non-blocking | Yes (spec) | Webhook flow § is well-specified. **Overbuilt vs reality:** the architecture describes a flow the code never wires up (see §3 #11). |
| **R8** rate-limit **100 req / 15 min** per IP, return `429` | **Contradicted** | Architecture “Key config values” table (line 119) says **`250` requests / window / IP** — directly contradicts PRD R8 (100). This is an architecture-vs-PRD conflict, not just doc-vs-code. |
| **R9** unauth `GET /health` → `{ "status": "ok" }` | Yes (spec) | Architecture line 95 says `{ status: "ok" }`. Code emits `healthy` (see §3 #4). |

**Unsatisfied / under-specified at the architecture layer:**
- Rate-limit max is self-contradictory across the set: PRD/CONTEXT/README/PLAN all say 100; the ARCHITECTURE config table says **250**. Architecture is the outlier.
- Architecture does **not** mention Redis or any cache anywhere — yet the delivery plan claims a Redis cache as shipped (see §2 / §3 #10). The plan references a component the architecture never introduced.

---

### 2. Architecture -> Delivery Plan

The plan’s phase structure maps cleanly onto the architecture components, and acceptance criteria are mostly concrete and checkable. Three real problems:

- **Stale / invented component (Redis).** Phase 4 acceptance criterion (IMPLEMENTATION_PLAN line 53-54): *“Task list responses are cached in Redis with a `60s` TTL (cache-aside) to cut database load.”* Neither ARCHITECTURE (no Redis in the Stack §, no cache in Components) nor the code contains any Redis/cache. The plan asserts an acceptance criterion for a component the architecture never specified and the code never built — yet marks Phase 4 **✅ DONE**.
- **Plan acceptance criteria silently diverge from the code they certify.** Phase 1 fixes the config constants (refresh `7d`, default page size `20`, bcrypt cost `12`, rate limit `100`); Phase 2/3/4 restate them. Every one of those is marked DONE, but the shipped `config.ts` violates three of them (see §3 #1–#3). The plan’s “All four phases DONE / implements every requirement R1–R9” status summary (line 63) is therefore not supported by the code.
- **Sequencing is otherwise fine** — no risky ordering; phases are independent and additive.

---

### 3. Delivery/Status -> Code  (numbered drift list)

Each item is an independently checkable conflict between a doc claim and the code (or between two docs).

1. **DRIFT: refresh-token TTL.** PRD R2 / ARCHITECTURE line 114 / CONTEXT line 23 / README line 47 / IMPLEMENTATION_PLAN lines 12,27 all say refresh TTL **`7d`** — vs `src/config.ts:11` `refreshTokenTtl: '30d'` (and `src/auth/jwt.ts:27` comment still says `// 7d`). Code issues 30-day refresh tokens.

2. **DRIFT: bcrypt cost factor.** ARCHITECTURE lines 48,80,115 / IMPLEMENTATION_PLAN lines 13,25 / `src/routes/auth.ts:28` comment all say cost **`12`** — vs `src/config.ts:12` `bcryptCost: 8`. Code hashes at cost 8 (a security regression).

3. **DRIFT: default page size.** PRD R4 / ARCHITECTURE lines 105,116 / CONTEXT line 24 / README lines 81,86 / IMPLEMENTATION_PLAN lines 12,40 all say default **`20`** — vs `src/config.ts:25` `defaultPageSize: 50`. Code defaults to 50 items/page.

4. **DRIFT: health-check response body.** PRD R9 `{ "status": "ok" }` / ARCHITECTURE line 95 `{ status: "ok" }` / IMPLEMENTATION_PLAN line 57 `{ status: "ok" }` — vs `src/index.ts:19` `res.json({ status: 'healthy' })`. Code returns `healthy`, not `ok`.

5. **DRIFT: task `status` enum is missing `in_progress` in code.** PRD R6 / ARCHITECTURE schema line 70 / `src/types.ts:3` / `src/schema.sql:30` / README lines 78,99 all define status `todo | in_progress | done` — vs `src/routes/tasks.ts:11` `const STATUSES: TaskStatus[] = ['todo', 'done']`. Consequences: `GET /tasks?status=in_progress` returns `400 invalid status filter` (line 23); `PATCH` to `in_progress` returns `400 invalid status` (line 125); `POST` with `status:"in_progress"` is **silently downgraded to `todo`** (line 79). `in_progress` is effectively unsupported despite being a documented, schema-level enum value.

6. **DRIFT: tasks description column name (schema vs code/type/arch).** ARCHITECTURE data model line 69 / `src/types.ts:26` / README all use **`description`**; the SQL in `src/routes/tasks.ts:85,139` inserts/updates a **`description`** column — but `src/schema.sql:29` names the column **`details TEXT NULL`**. Column `description` does not exist in the schema, so `POST /tasks` and `PATCH /tasks/:id` would fail at runtime with “Unknown column 'description'”, and `SELECT *` returns `details` (never mapped to `Task.description`). Hard code-vs-schema break, not cosmetic.

7. **DRIFT: list response envelope key.** ARCHITECTURE line 106 / README line 86 / IMPLEMENTATION_PLAN line 41 all specify `{ data: Task[], page, page_size, total }` — vs `src/routes/tasks.ts:56` `res.json({ items: data, page, page_size, total })`. Code emits the array under **`items`**, not `data`.

8. **DRIFT: README access-token TTL.** README lines 46-47 say *“The access token expires after **30 minutes**”* — vs PRD R2 / ARCHITECTURE line 83 / CONTEXT line 23 / `src/config.ts:10` all `15m`. README contradicts every other doc *and* the code (which is 15m).

9. **DRIFT: rate-limit max (architecture vs everyone).** ARCHITECTURE “Key config values” table line 119 says **`250` requests / window / IP** — vs PRD R8 / CONTEXT line 25 / README line 114 / IMPLEMENTATION_PLAN line 51 / `src/config.ts:31` (`max: 100`) all `100`. Architecture’s number is the outlier; code is correctly 100.

10. **DRIFT: Redis cache claimed shipped but absent.** IMPLEMENTATION_PLAN lines 53-54 (Phase 4 ✅ DONE) claim task-list responses are cached in **Redis, 60s TTL, cache-aside** — vs no Redis dependency, client, or cache logic anywhere in `src/` (grep: zero hits), and no Redis in ARCHITECTURE. `GET /tasks` queries MySQL directly every call (`src/routes/tasks.ts:45-54`).

11. **DRIFT: completion webhook never fires.** PRD R7 / ARCHITECTURE webhook-flow lines 125-132 / CONTEXT lines 15,26 / README lines 102-110 / IMPLEMENTATION_PLAN line 55 all state the webhook fires on transition to `done`. The service exists (`src/services/webhook.ts` `fireTaskCompleted`) but is **never imported or called** — `src/routes/tasks.ts` has no reference to it (the PATCH handler at lines 118-148 carries only a comment “fire webhook on -> done” at line 117, with no call). `fireTaskCompleted` is dead code; R7 is effectively unimplemented.

12. **DRIFT: CONTEXT claims the token-refresh endpoint shipped (and self-contradicts).** CONTEXT line 13 lists *“Phase 2 Auth — … token refresh endpoint. ✅”* as shipped — vs no `/auth/refresh` route in code (`src/routes/auth.ts` has only `/register`, `/login`) and none in the ARCHITECTURE API surface. CONTEXT then contradicts itself at line 34, listing *“A `POST /auth/refresh` endpoint”* under “What’s next … not yet scheduled.” (PRD R2 correctly scopes refresh out of v1; the code matches PRD, so the line-13 ✅ claim is the drift.)

13. **DRIFT: CONTEXT route count off by one.** CONTEXT line 17 says *“the 8 routes documented in `ARCHITECTURE.md` **plus** `GET /health`.”* The ARCHITECTURE API-surface table (lines 93-102) already includes `/health` among its **8** rows; the non-health routes number **7** (register, login, + 5 task routes). “8 routes plus health” implies 9 and double-counts `/health`.

14. **DRIFT: stale in-code comments.** `src/auth/jwt.ts:27` comment `// 7d` (actual `config.refreshTokenTtl` = `30d`); `src/routes/auth.ts:28` comment `// cost 12` (actual `config.bcryptCost` = `8`). Both comments assert the documented value while the constants assert another — residue of the intended-but-unmet spec.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

This project is documented as fully shipped (CONTEXT “all four phases complete”, IMPLEMENTATION_PLAN “All four phases DONE … implements every requirement R1–R9”), but the code both violates documented constants and fails to run against its own schema. Most important issues, highest first:

1. **The code cannot work against its own schema (§3 #6).** The `tasks` column is `details` in `schema.sql` but every write/read path uses `description`. `POST`/`PATCH /tasks` would throw “Unknown column 'description'”. This alone refutes the “shipped / DONE” claim.
2. **R7 webhook is not wired up (§3 #11).** The headline automation feature — claimed shipped in five documents — never executes; `fireTaskCompleted` is dead code.
3. **`in_progress` status is unsupported in code (§3 #5)** despite being a first-class enum in the schema, types, PRD, and README — silently downgrading creates and rejecting filters/updates.
4. **Three config constants violate the spec the plan certifies (§3 #1, #2, #3):** refresh TTL 30d vs 7d, bcrypt cost 8 vs 12 (security regression), default page size 50 vs 20.
5. **Two contract-shape drifts (§3 #4, #7):** health returns `healthy` not `ok`; list envelope key is `items` not `data` — both break any client coded to the docs.
6. **Doc-vs-doc conflicts (§3 #8, #9, #10, #12, #13):** README access TTL (30m), ARCHITECTURE rate-limit max (250), the phantom Redis cache, CONTEXT’s contradictory refresh-endpoint “✅”/“what’s next”, and the route miscount.

Net: the documentation set is internally inconsistent **and** the code diverges from it in ways that would fail at runtime. The “feature-complete v1 / all requirements met” status is not supported by the code on disk.

---

#### Gate Verdict

```text
VERDICT: FAIL
DIMENSIONS:
  - Brief -> Architecture: FAIL
  - Architecture -> Plan: FAIL
  - Status/Docs -> Code: FAIL
BLOCKING:
  - src/schema.sql: tasks column `details` vs code/type/arch `description` — write paths error at runtime
  - src/routes/tasks.ts: completion webhook (R7) never called; fireTaskCompleted is dead code
  - src/routes/tasks.ts: STATUSES omits `in_progress`, contradicting schema/types/PRD/README
  - src/config.ts: refreshTtl 30d (docs 7d), bcryptCost 8 (docs 12), defaultPageSize 50 (docs 20)
  - src/index.ts: /health returns {status:"healthy"} not {status:"ok"} (PRD R9)
  - src/routes/tasks.ts: list envelope uses `items` not documented `data`
  - IMPLEMENTATION_PLAN.md: Phase 4 claims Redis 60s cache — absent from arch and code
  - ARCHITECTURE.md: rate-limit max 250 contradicts PRD R8 / code (100)
  - CONTEXT.md: claims token-refresh endpoint shipped (✅) — no such route; self-contradicts line 34
RIGOR: tuned
```

**Open Questions:** none blocking — every finding is verifiable on disk (see `questions.md`).

**Verification Evidence:** all line citations above read directly from the workspace; `grep` over `src/` confirmed (a) zero references to Redis/cache, (b) `fireTaskCompleted` defined but never imported/called, (c) schema column `details` vs SQL `description`, (d) no `/auth/refresh` route.

**Residual Risk:** This review is static (no build/test run — no MySQL or `npm install` in this environment). Drifts #6 and #11 in particular would surface immediately under any integration test; their absence from the “DONE” claims suggests the test suite is thin or unrun.
