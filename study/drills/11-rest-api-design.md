## Assignments & Submissions Router — REST API design (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { logger } from "../logger";

// req.user is populated by requireAuth: { id, role: "student" | "instructor" }
const router = Router();
router.use(requireAuth);

// GET /courses/:courseId/assignments — list a course's assignments
router.get("/courses/:courseId/assignments", async (req: Request, res: Response) => {
  const { status } = req.query;
  const assignments = await prisma.assignment.findMany({
    where: {
      courseId: req.params.courseId,
      ...(status ? { status: String(status) } : {}),
    },
    orderBy: { dueAt: "asc" },
    include: {
      submissions: {
        include: { student: true }, // attach each submitter's profile
      },
    },
  });
  res.json(assignments);
});

// GET /assignment/:id — fetch a single assignment
router.get("/assignment/:id", async (req: Request, res: Response) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.id },
  });
  if (!assignment) return res.status(404).json({ error: "Not found" });
  res.json(assignment);
});

// POST /assignments — create an assignment
router.post("/assignments", async (req: Request, res: Response) => {
  const assignment = await prisma.assignment.create({
    data: { ...req.body, createdBy: req.user.id },
  });
  res.json(assignment);
});

// GET /assignments/:id/publish — make an assignment visible to students
router.get("/assignments/:id/publish", async (req: Request, res: Response) => {
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data: { status: "published", publishedAt: new Date() },
  });
  res.json({ ok: true, assignment });
});

// PUT /assignments/:id — edit an assignment
router.put("/assignments/:id", async (req: Request, res: Response) => {
  const data: Record<string, unknown> = {};
  if (req.body.title !== undefined) data.title = req.body.title;
  if (req.body.dueAt !== undefined) data.dueAt = req.body.dueAt;
  if (req.body.points !== undefined) data.points = req.body.points;
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data,
  });
  res.json(assignment);
});

// POST /assignments/:id/submissions — student submits work
router.post("/assignments/:id/submissions", async (req: Request, res: Response) => {
  try {
    const submission = await prisma.submission.create({
      data: {
        assignmentId: req.params.id,
        studentId: req.user.id,
        content: req.body.content,
        submittedAt: new Date(),
      },
    });
    res.status(201).json(submission);
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: (err as Error).message, stack: (err as Error).stack });
  }
});

// DELETE /assignments/:id — instructor removes an assignment
router.delete("/assignments/:id", async (req: Request, res: Response) => {
  const { count } = await prisma.assignment.deleteMany({
    where: { id: req.params.id, course: { instructorId: req.user.id } },
  });
  if (count === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

export default router;
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security — broken object-level authorization / IDOR):** `GET /assignment/:id` looks up by `req.params.id` alone — `requireAuth` proves you're *a* user, never that you may see *this* assignment, so any logged-in account can enumerate ids and read unpublished assignments. It slips past because the route *has* auth middleware, so a skim reads "authenticated = authorized" — the missing piece is the ownership check, not the login check. Fix: scope every record route to the caller (e.g. `findFirst({ where: { id, course: { OR: [{ instructorId: uid }, { enrollments: { some: { studentId: uid } } }] } } })`); the same gap exists on `PUT` and the publish route — only `DELETE` got it right.

2. **Blocker (Security — CSRF / unsafe GET mutation):** `GET /assignments/:id/publish` performs `prisma.update`. A GET must be safe and side-effect-free; here a browser prefetch, an `<img src>`, a link scanner, or a crawler can silently publish an assignment, and no CSRF token is required because it's a GET. It slips past because "publish" reads like a harmless toggle and the handler body is tiny. Fix: make it `POST /assignments/:id/publish` (or `PATCH .../status`), run it through the normal CSRF/auth path, and return the updated resource.

3. **Should-fix (API design — no pagination + over-fetch / data exposure):** the list endpoint adds a `status` filter but no `take`/`skip`/cursor, and `include: { submissions: { include: { student: true } } }` returns every submission plus each student's *full* profile (email, etc.) inline. It slips past because it works fine on a seed DB with three rows — it only falls over (and leaks PII) at real class sizes. Fix: paginate (cursor or capped `take`/`skip`), `select` only the fields the client needs, and never inline another user's profile into a list response.

4. **Should-fix (Validation + mass assignment):** `POST /assignments` does `data: { ...req.body, createdBy: req.user.id }` with zero validation — missing/wrong-typed fields hit the DB, and a client can set columns it shouldn't, e.g. `{"status":"published"}` or a forged `courseId`/`id`. It slips past because the happy-path payload looks clean in the demo and the spread reads as convenient. Fix: validate with a schema (zod/joi) and whitelist allowed fields explicitly instead of spreading the raw body.

5. **Should-fix (Correctness — non-idempotent create):** `POST /assignments/:id/submissions` unconditionally `create`s a row with no idempotency key and no unique `(assignmentId, studentId)` constraint, so a double-click or a retry on a slow network produces duplicate submissions — and "which one gets graded?" becomes a support ticket. It slips past because a single manual test never double-fires. Fix: accept an `Idempotency-Key` header or add a DB unique constraint and `upsert` (or 409 on conflict) so re-sends collapse to one row.

6. **Should-fix (Reliability/Security — error leakage + inconsistent handling):** the submissions handler is the *only* one wrapped in try/catch, and it returns `err.message` **and** `err.stack` in the response body — leaking DB/ORM internals and file paths to the client — while every other route is an **unwrapped async handler** — and in Express 4 a rejected promise there does **not** reach the default error handler; it surfaces as an `unhandledRejection` that hangs the request and can crash the process. So error handling is both inconsistent *and* unsafe across the API. It slips past because the leak/crash only appears on a real failure, not in green tests. Fix: centralize error handling in one Express error middleware that logs detail server-side and returns a stable, minimal shape (`{ error, code }`) — never the stack — **and** wrap async handlers (an `asyncHandler` helper, `express-async-errors`, or Express 5) so their rejections actually reach it.

7. **Nit (HTTP semantics — PUT vs PATCH):** `PUT /assignments/:id` only writes the fields that are present, i.e. it's a partial merge, but `PUT` is defined as full-resource replacement — a client that omits `title` expecting it cleared will be surprised it persists. It slips past because the merge "feels" correct and the tests only send full bodies. Fix: expose this as `PATCH` (partial), or keep `PUT` and require/replace the full representation.

8. **Nit (HTTP status & conventions):** `POST /assignments` returns the default `200` (via `res.json`) for a creation instead of `201 Created` with a `Location` header; the path is also singular `GET /assignment/:id` while every sibling uses the plural collection, and publish returns an ad-hoc `{ ok: true, assignment }` envelope. It slips past because the response *body* is correct, so nobody checks the status line or the URL casing. Fix: return `201` + `Location: /assignments/:id` on create, standardize on the plural resource name, and return the resource (not an `{ ok }` wrapper).

9. **Praise (Authorization & idempotency done right):** `DELETE /assignments/:id` is the model handler — it scopes the write to `course: { instructorId: req.user.id }` so a non-owner gets a clean `404` (no IDOR, no existence leak), it's naturally idempotent via `deleteMany` + the `count` check, and it returns `204` with no body. Call this out as the pattern the read/update/publish routes should copy.

**Senior framing to say out loud:** "Two blockers gate the merge — the unscoped `GET /assignment/:id` (IDOR) and the state-changing `GET .../publish` (CSRF); both are authz/semantics holes that the login middleware masks, so I'd hold the PR on those alone. The should-fix cluster — unpaginated PII over-fetch, unvalidated mass-assignment, non-idempotent submissions, and stack-trace error leaks — is where the real design debt lives and would be my next pass. The PUT/PATCH and 201/Location items are cheap polish, and I'd explicitly hold up the `DELETE` handler as the scoping-and-idempotency pattern the rest of the file should follow."
</details>
