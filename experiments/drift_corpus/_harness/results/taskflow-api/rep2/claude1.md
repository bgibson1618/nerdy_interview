# taskflow-api — Independent Drift / Coherence Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS (with one internal config contradiction)
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/routes/tasks.ts: completion webhook (R7) is never invoked, yet docs mark it shipped
  - src/schema.sql: tasks column is `details`, but all code reads/writes `description` (runtime-breaking)
  - src/routes/tasks.ts: status enum drops `in_progress`, contradicting PRD R6, schema, types, README
  - src/config.ts: refresh TTL (30d), bcrypt cost (8), default page size (50) all disagree with every doc
RIGOR: tuned
```

Reviewed with fresh eyes, from disk only. Scope: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, and all of `src/`. No tests exist in the tree, so
correctness was assessed by static cross-referencing of checkable facts (endpoints, enums,
config numbers, schema, payloads, status claims).

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement at the design level. Per-requirement:

| Req | Requirement | Architecture coverage | Verdict |
|-----|-------------|-----------------------|---------|
| R1 | `POST /auth/register` + `POST /auth/login`, bcrypt hashes | API surface + Auth model sections cover both; bcrypt cost 12 specified | Addressed |
| R2 | JWT stateless auth; access 15m, refresh 7d; refresh issued but unused | Auth model + key-config table specify 15m / 7d | Addressed |
| R3 | `POST /tasks`, `GET /tasks/:id`; title/description/status/priority/project | API surface + data model cover it | Addressed |
| R4 | `GET /tasks` with status + project_id filters, page/page_size, default 20 / max 100 | API surface documents params + default 20 / max 100 | Addressed |
| R5 | `PATCH /tasks/:id`, `DELETE /tasks/:id`, ownership enforced | API surface covers both | Addressed |
| R6 | status ∈ {todo,in_progress,done} default todo; priority ∈ {low,medium,high} default medium | Data model ENUMs match exactly | Addressed |
| R7 | Completion webhook to `projects.webhook_url` on transition to done; non-blocking | "Webhook flow" section specifies it precisely | Addressed (in design) |
| R8 | Rate limit 100 req / 15 min / IP, return 429 | Rate-limit design present | Addressed — but see contradiction below |
| R9 | Unauthenticated `GET /health` -> `{status:"ok"}` | API surface documents it | Addressed |

**Internal contradiction in ARCHITECTURE itself (contradicted value):** the "Key config
values" table (`ARCHITECTURE.md:119`) lists **Rate limit max = `250` requests / window / IP**,
which directly contradicts PRD **R8 (100)** and the same architecture document's own statement
that this value "maps onto … R8" (`ARCHITECTURE.md:122`). The architecture is internally
inconsistent on the single most safety-relevant number it specifies.

No requirement is unsatisfied at the design level; the architecture is otherwise not overbuilt
(it deliberately scopes out refresh, project CRUD, and retries — consistent with PRD non-goals).

### 2. Architecture -> Delivery Plan

The plan's phase structure maps cleanly onto the architecture components, and its per-phase
acceptance criteria are mostly faithful. Sequencing is sound (Foundation → Auth → Tasks →
Hardening). Two defects:

- **Plan references a component that exists in neither the architecture nor the code.**
  `IMPLEMENTATION_PLAN.md:54-55` (Phase 4 acceptance) states: *"Task list responses are cached in
  Redis with a `60s` TTL (cache-aside) to cut database load."* Redis appears nowhere in
  `ARCHITECTURE.md` (stack lists only Node/Express/MySQL/JWT), nowhere in `package.json`
  dependencies, and nowhere in `src/`. This is a stale/aspirational acceptance criterion baked
  into a phase marked **✅ DONE** — the criterion can never have passed.

- **Plan asserts a status the code does not meet.** `IMPLEMENTATION_PLAN.md:61-64`
  ("Status summary") claims *"All four phases are DONE. The API implements every requirement
  R1–R9."* Section 3 shows R6 (status enum) and R7 (webhook) are not implemented, so the blanket
  "every requirement implemented" claim is false.

### 3. Delivery/Status -> Code

Every concrete doc-vs-code (or doc-vs-doc) inconsistency, as a checkable numbered list:

1. **DRIFT:** Refresh-token TTL is `7d` per PRD R2 (`PRD.md:34`), ARCHITECTURE auth model &
   key-config table (`ARCHITECTURE.md:85,114`), CONTEXT (`CONTEXT.md:23`), README
   (`README.md:47`), and the plan (`IMPLEMENTATION_PLAN.md:27`) — **vs** `refreshTokenTtl: '30d'`
   in `src/config.ts:11` (used by `signRefreshToken`, `src/auth/jwt.ts:27`).

2. **DRIFT:** Access-token TTL is documented as **30 minutes** in README (`README.md:47`) — **vs**
   `15m` everywhere else (PRD R2 `PRD.md:33`, ARCHITECTURE `ARCHITECTURE.md:84,113`, CONTEXT
   `CONTEXT.md:23`) and **vs** the code value `accessTokenTtl: '15m'` (`src/config.ts:10`). README
   is the outlier.

3. **DRIFT:** bcrypt cost is `12` per ARCHITECTURE (`ARCHITECTURE.md:48,80,115`) and the plan
   (`IMPLEMENTATION_PLAN.md:12,25`) — **vs** `bcryptCost: 8` in `src/config.ts:12`. The comment
   `// cost 12` in `src/routes/auth.ts:28` is also stale (actual cost is 8).

4. **DRIFT:** Default page size is `20` per PRD R4 (`PRD.md:47`), ARCHITECTURE
   (`ARCHITECTURE.md:106,116`), README (`README.md:81,86`), CONTEXT (`CONTEXT.md:24`), and the
   plan (`IMPLEMENTATION_PLAN.md:12,40`) — **vs** `defaultPageSize: 50` in `src/config.ts:25`
   (used by `GET /tasks`, `src/routes/tasks.ts:37`).

5. **DRIFT:** Rate-limit max is `250` requests/window in the ARCHITECTURE key-config table
   (`ARCHITECTURE.md:119`) — **vs** `100` in the code (`src/config.ts:31`,
   `src/middleware/rateLimit.ts:8`) and **vs** PRD R8 (`PRD.md:66`), README (`README.md:114`),
   CONTEXT (`CONTEXT.md:25`), plan (`IMPLEMENTATION_PLAN.md:51`). Code matches the PRD;
   ARCHITECTURE's table is the outlier.

6. **DRIFT:** Health response body is `{ status: "ok" }` per PRD R9 (`PRD.md:71`), ARCHITECTURE
   (`ARCHITECTURE.md:95`), and the plan (`IMPLEMENTATION_PLAN.md:57`) — **vs**
   `res.json({ status: 'healthy' })` in `src/index.ts:19`. A liveness probe asserting
   `status === "ok"` would fail.

7. **DRIFT:** List response envelope key is `data` per ARCHITECTURE (`ARCHITECTURE.md:106`),
   README (`README.md:86`), and the plan (`IMPLEMENTATION_PLAN.md:41`) — **vs**
   `res.json({ items: data, … })` in `src/routes/tasks.ts:56`, which emits the key `items`. A
   client reading `body.data` gets `undefined`.

8. **DRIFT:** Task `status` enum is `todo | in_progress | done` per PRD R6 (`PRD.md:55`),
   ARCHITECTURE (`ARCHITECTURE.md:70`), README (`README.md:78,99`), `src/types.ts:3`, and
   `src/schema.sql:30` — **vs** the route's validation list
   `const STATUSES: TaskStatus[] = ['todo', 'done']` in `src/routes/tasks.ts:11`, which omits
   `in_progress`. Consequence: creating with `status:"in_progress"` silently falls back to `todo`
   (`tasks.ts:79`); filtering or PATCHing to `in_progress` returns HTTP 400 (`tasks.ts:23,125`).
   `in_progress` is effectively unsupported.

9. **DRIFT:** The completion webhook (R7) is documented as shipped — PRD R7 (`PRD.md:59`),
   ARCHITECTURE "Webhook flow" (`ARCHITECTURE.md:125-132`), CONTEXT (`CONTEXT.md:15,26`), README
   (`README.md:102-110`), plan Phase 4 ✅ (`IMPLEMENTATION_PLAN.md:54`) — **vs** the code, where
   `fireTaskCompleted` (`src/services/webhook.ts:9`) is **never imported or called anywhere**
   (verified: only def-site references exist). The PATCH handler
   (`src/routes/tasks.ts:118-148`) sets status to `done` but never invokes the webhook; its own
   comment "fire webhook on -> done" (`tasks.ts:117`) is aspirational. R7 is unimplemented despite
   five docs claiming it ships.

10. **DRIFT:** The `tasks` description column is `description` per ARCHITECTURE data model
    (`ARCHITECTURE.md:69`) and `src/types.ts:26`, and the code reads/writes `description`
    (`src/routes/tasks.ts:85-87,139`) — **vs** `src/schema.sql:29`, which names the column
    `details`. The INSERT and UPDATE statements reference a column the DDL does not create, so
    every create/update-task call would fail at runtime (`Unknown column 'description'`).

11. **DRIFT:** Plan Phase 4 acceptance claims *"Task list responses are cached in Redis with a
    `60s` TTL (cache-aside)"* (`IMPLEMENTATION_PLAN.md:54-55`) — **vs** the codebase, which has no
    Redis dependency (`package.json:11-17`), no cache code (`grep -ri redis/cache src/` → empty),
    and no mention of caching in ARCHITECTURE. The criterion describes a component that does not
    exist.

12. **DRIFT:** CONTEXT says Phase 2 shipped a *"token refresh endpoint ✅"* (`CONTEXT.md:13`) —
    **vs** the code, which has no refresh endpoint (`src/routes/auth.ts` exposes only `/register`
    and `/login`). This also contradicts CONTEXT itself, which lists *"A `POST /auth/refresh`
    endpoint that consumes the refresh token"* as an unscheduled, out-of-v1 follow-up
    (`CONTEXT.md:34`), and PRD R2, which states refreshing is out of scope for v1 (`PRD.md:34`).
    ARCHITECTURE's API surface (`ARCHITECTURE.md:93-102`) correctly lists no refresh route.

13. **DRIFT:** `src/auth/jwt.ts:27` comment `// 7d` annotates `signRefreshToken`, but the value
    it signs with (`config.refreshTokenTtl`) is `30d` (`src/config.ts:11`). The code comment
    disagrees with the code it documents. (Related to item 1.)

14. **DRIFT (minor / miscount):** CONTEXT states *"The public surface is the 8 routes documented
    in ARCHITECTURE.md plus `GET /health`"* (`CONTEXT.md:17`), implying 9 endpoints. The
    ARCHITECTURE API-surface table (`ARCHITECTURE.md:93-102`) lists 8 rows **including**
    `/health` — i.e. 7 non-health routes + health = 8 total. The "8 routes plus health" phrasing
    overcounts by one.

### 4. Verdict

**SIGNIFICANT DRIFT.**

The docs present a uniform "shipped, all phases DONE, R1–R9 implemented" narrative, but the code
diverges on a majority of independently checkable facts, including three that are functionally
breaking. Most important first:

1. **Schema/code column mismatch (item 10)** — `details` vs `description` means task create and
   update throw at runtime. The core CRUD surface (R3/R5) cannot work as written.
2. **Webhook never wired (item 9)** — R7 is documented as shipped in five places, but the service
   is dead code; the headline automation feature does not run.
3. **`in_progress` status unsupported (item 8)** — violates PRD R6 and contradicts the schema,
   types, and README; one of three documented states is unusable.
4. **Security/behavior config silently weakened (items 1, 3)** — bcrypt cost 8 (not 12) and
   refresh TTL 30d (not 7d) are undocumented downgrades of the auth posture the docs promise.
5. **Contract-shape drifts clients will hit (items 6, 7)** — health returns `healthy` not `ok`;
   list envelope key is `items` not `data`. Both break literal adherence to documented contracts.
6. **Pagination + rate-limit number drift (items 4, 5)** — default page size 50 vs 20; and the
   ARCHITECTURE table's lone `250` rate-limit value contradicts the code and every other doc.
7. **Stale status claims (items 11, 12) and stale comments/text (items 2, 13, 14)** — Redis
   caching and a "token refresh endpoint ✅" are claimed but absent; README's "30 minutes" and
   jwt.ts's "7d" comment are stale; CONTEXT miscounts the route surface.

Recommended gate action: **block** the "done / R1–R9 complete" claim. The schema column, webhook
wiring, and `in_progress` enum are correctness blockers; the config-number and contract-shape
drifts should be reconciled (pick code-or-doc as the source of truth for each) before this is
treated as shipped.

---

*Reviewer note: this was a static review — no build or tests were run (no test suite exists in
the tree, and the environment has no MySQL configured). Findings are derived from direct
file-to-file cross-referencing; line numbers cite the files as read this session. The webhook
"never called" and the `details`/`description` column facts were additionally confirmed by grep.*
