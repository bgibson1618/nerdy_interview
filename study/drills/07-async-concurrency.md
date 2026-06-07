## Seat-Cap Enrollment & Session Rollups — Async / concurrency (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
import type { Pool } from "pg";
import type { Logger } from "../platform/logger";
import { sendWelcomeEmail } from "../notifications/mailer";

interface EnrollRequest {
  studentId: string;
  courseId: string;
}

interface BatchResult {
  ok: boolean;
  enrolled: string[];
}

interface SessionRow {
  tutorId: string;
  minutes: number;
  rating: number | null;
}

interface StudentSummary {
  studentId: string;
  totalMinutes: number;
  avgRating: number;
}

export class EnrollmentService {
  constructor(
    private readonly db: Pool,
    private readonly log: Logger,
  ) {}

  /** Enroll one student, respecting the course seat cap. */
  async enroll(req: EnrollRequest): Promise<{ ok: boolean }> {
    const course = await this.db.query(
      `SELECT seats_taken, seats_total FROM courses WHERE id = $1`,
      [req.courseId],
    );
    const { seats_taken, seats_total } = course.rows[0];

    if (seats_taken >= seats_total) {
      return { ok: false };
    }

    await this.db.query(
      `INSERT INTO enrollments (student_id, course_id, created_at)
       VALUES ($1, $2, now())`,
      [req.studentId, req.courseId],
    );
    await this.db.query(
      `UPDATE courses SET seats_taken = seats_taken + 1 WHERE id = $1`,
      [req.courseId],
    );

    // Don't make enrollment latency depend on SMTP — send the welcome out of band.
    sendWelcomeEmail(req.studentId, req.courseId);

    return { ok: true };
  }

  /** Admin bulk action: enroll a roster into one course. */
  async batchEnroll(courseId: string, studentIds: string[]): Promise<BatchResult> {
    const enrolled: string[] = [];
    try {
      for (const studentId of studentIds) {
        const res = await this.enroll({ studentId, courseId });
        if (res.ok) enrolled.push(studentId);
      }
    } catch (err) {
      this.log.error("batchEnroll failed", { courseId, err });
    }
    return { ok: true, enrolled };
  }

  /** Roll up tutoring minutes + ratings for one student's recent sessions. */
  async aggregateSessions(studentId: string): Promise<StudentSummary> {
    const res = await this.db.query(
      `SELECT tutor_id, minutes, rating FROM sessions WHERE student_id = $1`,
      [studentId],
    );
    const rows: SessionRow[] = res.rows;

    let totalMinutes = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    rows.forEach(async (row) => {
      const tutor = await this.db.query(
        `SELECT active FROM tutors WHERE id = $1`,
        [row.tutorId],
      );
      if (!tutor.rows[0]?.active) return;
      totalMinutes += row.minutes;
      if (row.rating != null) {
        ratingSum += row.rating;
        ratingCount += 1;
      }
    });

    return {
      studentId,
      totalMinutes,
      avgRating: ratingCount ? ratingSum / ratingCount : 0,
    };
  }

  /** Cohort dashboard: summaries for a selected set of students. */
  async loadStudentSummaries(studentIds: string[]): Promise<StudentSummary[]> {
    return Promise.all(studentIds.map((id) => this.aggregateSessions(id)));
  }

  /** Nightly job: refresh the summary cache for every active student. */
  async refreshAllSummaries(): Promise<void> {
    const res = await this.db.query(`SELECT id FROM students WHERE active = true`);
    const ids: string[] = res.rows.map((r) => r.id);
    const summaries = await Promise.all(ids.map((id) => this.aggregateSessions(id)));
    await this.cacheSummaries(summaries);
  }

  /** Load course, student, and prereqs together for the enroll screen. */
  async getEnrollmentContext(studentId: string, courseId: string) {
    const [course, student, prereqs] = await Promise.all([
      this.db.query(`SELECT * FROM courses WHERE id = $1`, [courseId]),
      this.db.query(`SELECT * FROM students WHERE id = $1`, [studentId]),
      this.db.query(`SELECT * FROM prerequisites WHERE course_id = $1`, [courseId]),
    ]);
    return {
      course: course.rows[0],
      student: student.rows[0],
      prereqs: prereqs.rows,
    };
  }

  private async cacheSummaries(_summaries: StudentSummary[]): Promise<void> {
    // writes to redis; omitted for brevity
  }
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Concurrency / TOCTOU):** `enroll` reads `seats_taken/seats_total`, *then* (in separate statements) inserts the enrollment and bumps the counter — with no transaction, no `SELECT … FOR UPDATE`, and no DB-level cap constraint. Two concurrent requests on the last seat both read `seats_taken < seats_total`, both pass the guard, and both insert → the course is over-enrolled (a double-grant of a scarce seat). — It slips past because each statement is individually correct and the file *looks* like it respects the cap; the gap only exists *between* the read and the write under concurrency, which you can't see by reading top-to-bottom. *Fix:* do it in one transaction — `BEGIN; SELECT … FOR UPDATE;` the course row (or `UPDATE courses SET seats_taken = seats_taken + 1 WHERE id = $1 AND seats_taken < seats_total RETURNING …` and treat 0 rows as "full"), then insert; back it with a check constraint / unique index as a hard floor.

2. **Blocker (Reliability / crash):** `const { seats_taken, seats_total } = course.rows[0];` destructures without checking the row exists. A bad or stale `courseId` returns zero rows, so `course.rows[0]` is `undefined` and the destructure throws `TypeError: Cannot destructure property 'seats_taken' of 'undefined'`. — A not-found course is a *normal* input, not an edge case, but it reads like happy-path data access so reviewers skim it. *Fix:* `const row = course.rows[0]; if (!row) return { ok: false };` (or throw a typed 404), then destructure.

3. **Blocker (Reliability / unhandled rejection):** `sendWelcomeEmail(req.studentId, req.courseId);` is a floating promise — no `await`, no `.catch()`. Firing it out-of-band is a fine intent, but a transient SMTP failure becomes an `unhandledRejection`, which under Node's default policy terminates the process — so a flaky mail provider crashes the enrollment API. — The comment ("out of band") makes the *missing await* look deliberate and correct, masking the missing error sink. *Fix:* attach a handler — `void sendWelcomeEmail(...).catch((err) => this.log.error("welcome email failed", { err }));` — or push it onto a real job queue.

4. **Should-fix (Error handling / honesty):** `batchEnroll` wraps the loop in `try/catch` but unconditionally `return { ok: true, enrolled }`. If `enroll` throws partway (e.g., a DB blip, or finding #2), the catch logs and we still report `ok: true` with a *partial* `enrolled` list — the caller is told the bulk action succeeded. — The `enrolled` array makes the response look trustworthy, so the always-true `ok` is easy to miss. *Fix:* track failures and reflect them — `return { ok: failures.length === 0, enrolled, failed }` — or rethrow after logging so the caller can react.

5. **Should-fix (Async correctness):** `aggregateSessions` iterates with `rows.forEach(async (row) => { … })`. `forEach` ignores the returned promises, so the function falls through to `return` **before any callback resolves** — `totalMinutes`/`ratingSum` are still `0`, so it ships all-zero rollups; worse, any error inside a callback is an unhandled rejection. — It *looks* like a normal loop with `await` inside, and in a quick read "there's an await, so it's awaited" feels true. *Fix:* use a real awaited loop or map — `for (const row of rows) { … }`, or `await Promise.all(rows.map(async (row) => …))` accumulating results. (Bonus while you're here: the per-row `tutors` lookup is an N+1 — fold the active-tutor check into the original query with a join.)

6. **Should-fix (Resilience):** `loadStudentSummaries` returns `Promise.all(studentIds.map(...))`. `Promise.all` is fail-fast: one student's rollup rejecting discards *every* already-computed summary and fails the whole dashboard request. — `Promise.all` is the reflexive choice and is correct when you need all-or-nothing; here we want best-effort, which isn't obvious without asking "what should happen if one fails?" *Fix:* use `Promise.allSettled` and map fulfilled values into results while surfacing/logging the rejected ones.

7. **Nit (Async correctness / latency):** `batchEnroll`'s `for … of` awaits each `enroll` strictly serially, so a 300-student roster is 300 sequential round-trips of latency. — It's correct, just slow, so it survives review easily. *Fix:* note the trap first — you can't naïvely `Promise.all` these calls, because parallelizing the racy `enroll` (finding #1) only *amplifies* the over-enrollment window. The real fix is a single set-based, transactional bulk insert (one `INSERT … SELECT` guarded by the seat cap), which removes both the latency *and* the race in one move.

8. **Nit (Resource / scale):** `refreshAllSummaries` does `Promise.all(ids.map(id => this.aggregateSessions(id)))` over *every* active student, and each `aggregateSessions` itself fans out queries — so the nightly job can launch tens of thousands of concurrent queries and exhaust the PG connection pool (or get throttled into timeouts). — On a small dev dataset it runs fine, so the unbounded fan-out never shows up until production scale. *Fix:* bound concurrency — chunk the ids, or use a pool/limiter (`p-limit`, a small worker count) so only N rollups are in flight at once.

9. **Praise (Async correctness):** `getEnrollmentContext` fetches course, student, and prerequisites with a single `Promise.all` of three *independent* queries — correct, idiomatic parallelization of I/O with no shared mutable state between the legs. Call this out as the model the serial loop in #7 should aspire to *once the underlying write is made transactional* — it's the right instinct applied where it's actually safe.

**Senior framing to say out loud:** "I'd block the PR on the seat-cap race (#1), the not-found crash (#2), and the unhandled email rejection (#3) — those are correctness and uptime, and #1 is effectively a double-spend of a scarce resource. The `forEach(async)` rollup (#5) and the always-`ok:true` batch result (#4) I'd push hard on in the same review since they silently ship wrong data; `allSettled` (#6) and bounded fan-out (#8) are should-fix follow-ups. The serial loop (#7) is the only thing I'd leave to a linter/perf note — and only after we flag that 'just `Promise.all` it' would make the race worse, not better."
</details>
