## Tutoring-Session Billing Repository — SQL / data access (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// billing-repository.ts
// Data access for tutoring-session billing (MySQL via mysql2/promise).
import mysql, { RowDataPacket } from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: 'edtech',
  connectionLimit: 10,
  waitForConnections: true,
});

const PLATFORM_FEE = 0.15;

export interface SessionCharge {
  studentId: number;
  tutorId: number;
  minutes: number;
}

// Find a student account by email. Used by both the login flow and the
// admin "search students" screen.
export async function findStudentByEmail(email: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM students WHERE email = '${email}'`,
  );
  return rows[0];
}

// Charge a student for a finished session and credit the tutor's wallet.
export async function chargeForSession(
  charge: SessionCharge,
  ratePerHour: number,
) {
  const conn = await pool.getConnection();

  const cost = (charge.minutes / 60) * ratePerHour;
  const payout = cost * (1 - PLATFORM_FEE);

  await conn.query(
    'UPDATE wallets SET balance = balance - ? WHERE student_id = ?',
    [cost, charge.studentId],
  );
  await conn.query(
    'UPDATE wallets SET balance = balance + ? WHERE tutor_id = ?',
    [payout, charge.tutorId],
  );

  conn.release();
  return { cost, payout };
}

// Build a payout summary for a tutor: each unpaid session plus the student name.
export async function getUnpaidSessionSummary(tutorId: number) {
  const [sessions] = await pool.query<RowDataPacket[]>(
    'SELECT id, student_id, minutes, rate FROM sessions WHERE tutor_id = ? AND paid = 0',
    [tutorId],
  );

  const summary = [];
  for (const s of sessions) {
    const [students] = await pool.query<RowDataPacket[]>(
      `SELECT name FROM students WHERE id = ${s.student_id}`,
    );
    summary.push({
      sessionId: s.id,
      student: students[0].name,
      cost: (s.minutes / 60) * s.rate,
    });
  }
  return summary;
}

// Refund a session and return the money to the student in one atomic unit.
export async function refundSession(sessionId: number, amount: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE sessions SET refunded = 1 WHERE id = ?', [
      sessionId,
    ]);
    await conn.query(
      `UPDATE wallets SET balance = balance + ?
         WHERE student_id = (SELECT student_id FROM sessions WHERE id = ?)`,
      [amount, sessionId],
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security — SQL injection):** `findStudentByEmail` interpolates the raw `email` argument straight into the query text (`WHERE email = '${email}'`). A login/search request with `' OR '1'='1' -- ` dumps every student row, and stacked statements open the door to far worse. It slips past because the other three functions all use `?` placeholders, so a skimming reviewer pattern-matches "this module parameterizes" and never re-reads this one. **Fix:** `pool.query('SELECT ... FROM students WHERE email = ?', [email])`.

2. **Blocker (Data integrity — missing transaction):** `chargeForSession` debits the student wallet and credits the tutor wallet as two independent statements with no `beginTransaction`/`commit`. If the second UPDATE fails (deadlock, constraint, dropped connection), the debit has already committed — money disappears from the student and is never paid to the tutor. It slips past because the happy path always balances in testing; the gap only opens under concurrency or a mid-call error. **Fix:** wrap both writes in a transaction (commit on success, rollback on error) — exactly the shape `refundSession` already uses.

3. **Blocker (Correctness — null deref / crash):** in `getUnpaidSessionSummary`, `students[0].name` assumes the per-session lookup always returns a row. A session whose student was deleted or soft-deleted yields `students = []`, so `students[0]` is `undefined` and `.name` throws, blowing up the entire summary for that tutor. It slips past because every seeded test student still exists. **Fix:** guard with `students[0]?.name ?? '(unknown)'`, or better, fetch names via a JOIN (see #6).

4. **Should-fix (Privacy — `SELECT *` leaks sensitive columns):** `findStudentByEmail` returns `SELECT *`, so `password_hash` and any PII columns travel back to every caller, including the admin search screen and whatever serializes that object into an API response. It slips past because the function "works" — the extra columns are invisible until something downstream logs or returns them. **Fix:** select an explicit column allow-list; never `SELECT *` from a table that stores secrets.

5. **Should-fix (Resource leak — connection not released on error):** `chargeForSession` takes a connection with `pool.getConnection()` but only calls `conn.release()` on the success path. Any throw from either UPDATE leaks that connection permanently; with `connectionLimit: 10`, ten failures exhaust the pool and the service hangs. It slips past because a `release()` is visibly present and the leak only fires when a query throws. **Fix:** `try { ... } finally { conn.release() }`, like `refundSession`.

6. **Should-fix (Performance — N+1 query):** `getUnpaidSessionSummary` runs one `SELECT name` per session inside the `for` loop. A tutor with 300 unpaid sessions issues 301 round-trips. It slips past because it's instant against 3 test rows. **Fix:** a single `JOIN sessions → students` (or `WHERE id IN (...)`) and map names in memory.

7. **Nit (Consistency / latent injection — interpolated trusted value):** the inner lookup uses `WHERE id = ${s.student_id}` instead of a bound parameter. `s.student_id` is a trusted integer from the DB today, so it isn't exploitable — but it's the exact habit that produced finding #1 and will eventually be copy-pasted onto user input. **Fix:** bind it (`WHERE id = ?`, `[s.student_id]`) so the whole module is uniformly parameterized.

8. **Nit (Money as float):** `cost`, `payout`, and the wallet `balance ± ?` arithmetic are all IEEE-754 floats (`(minutes / 60) * rate`, then `* (1 - PLATFORM_FEE)`). Repeated debits and the fee multiplication accumulate sub-cent rounding error, so balances drift over time. It slips past because small hand-checked examples look exact. **Fix:** compute in integer cents (or DECIMAL columns + a decimal library) and round explicitly at the boundary.

9. **Praise (Correctness — the model to copy):** `refundSession` is the reference implementation — every value is bound with `?`, both writes are wrapped in an explicit transaction with `rollback` on failure, and the connection is released in `finally`. Call it out loud: the team clearly knows the correct pattern, so the entire review reduces to "make `findStudentByEmail` and `chargeForSession` look like this one."

**Senior framing to say out loud:** "I'd block the merge on three things — the injection (a breach), the un-transactioned debit/credit (silently loses customer money), and the null-deref that crashes the payout summary. I'd raise the `SELECT *` privacy leak, the connection leak, and the N+1 as fix-before-scale, but they're not ship-stoppers today. The float money and the interpolated-but-trusted id I'd leave as a comment or hand to a linter. The encouraging part is `refundSession` already demonstrates the right shape, so my whole ask is just 'apply that pattern consistently.'"
</details>
