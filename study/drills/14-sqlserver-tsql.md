## Confirm-Enrollment Stored Proc — SQL Server / T-SQL (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```sql
-- ============================================================================
-- usp_EnrollStudentInCourse
--   Enrolls a student in a section, posts the tuition charge to the ledger,
--   and returns the current section roster for the confirmation screen.
--   Called by the student-portal API on "Confirm enrollment".
-- ============================================================================
CREATE PROCEDURE dbo.usp_EnrollStudentInCourse
    @StudentEmail   NVARCHAR(256),
    @SectionId      INT,
    @NameFilter     NVARCHAR(100) = N'',
    @RosterSortCol  NVARCHAR(50)  = N'LastName'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StudentId    INT,
            @TermId       INT,
            @Balance      DECIMAL(10,2),
            @TuitionFee   DECIMAL(10,2),
            @EnrollmentId INT;

    -- Resolve the student from their login email
    SELECT @StudentId = StudentId
    FROM dbo.Students
    WHERE Email = @StudentEmail;

    IF @StudentId IS NULL
    BEGIN
        RAISERROR('Student not found.', 16, 1);
        RETURN;
    END

    -- Pick the term we are currently billing for
    SELECT TOP (1) @TermId = TermId
    FROM Terms
    WHERE IsActive = 1;

    -- Eligibility gate: block enrollment if the student owes too much
    SELECT @Balance = AccountBalance
    FROM dbo.StudentAccounts WITH (NOLOCK)
    WHERE StudentId = @StudentId;

    IF @Balance > 1000.00
    BEGIN
        RAISERROR('Outstanding balance too high to enroll online.', 16, 1);
        RETURN;
    END

    -- Look up the price for this section
    SELECT @TuitionFee = TuitionFee
    FROM Sections
    WHERE SectionId = @SectionId;

    -- Create the enrollment
    INSERT INTO dbo.Enrollments (StudentId, SectionId, TermId, EnrolledOn, Status)
    VALUES (@StudentId, @SectionId, @TermId, GETDATE(), 'Active');

    SET @EnrollmentId = @@IDENTITY;

    -- Post the tuition charge against the new enrollment
    INSERT INTO dbo.LedgerEntries (StudentId, EnrollmentId, Amount, EntryType, PostedOn)
    VALUES (@StudentId, @EnrollmentId, @TuitionFee, 'Charge', GETDATE());

    -- Roll the charge into the running account balance
    UPDATE dbo.StudentAccounts
    SET AccountBalance = AccountBalance + @TuitionFee
    WHERE StudentId = @StudentId;

    -- Return the updated roster for the confirmation screen.
    -- Sort column and name filter come straight from the UI controls.
    DECLARE @sql NVARCHAR(MAX);
    SET @sql =
        N'SELECT TOP (25) * FROM dbo.vw_SectionRoster
          WHERE SectionId = ' + CAST(@SectionId AS NVARCHAR(10)) + N'
            AND LastName LIKE ''%' + @NameFilter + N'%''
          ORDER BY ' + @RosterSortCol + N';';
    EXEC(@sql);

END
GO
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security):** The roster block (the `SET @sql = ...` / `EXEC(@sql)` at the bottom) hand-builds a query string and inlines `@NameFilter` into the `LIKE` and `@RosterSortCol` into the `ORDER BY`, then runs it with `EXEC`. Both come "straight from the UI," so `@NameFilter = '' ; DROP TABLE dbo.Enrollments; --` (or a `UNION SELECT` to exfiltrate other students' rows) executes verbatim — classic SQL injection. *Why it slips past:* the *rest* of the proc looks safely parameterized, so a skimming reviewer assumes the whole thing is; the injection is buried in the one block that needed dynamic SQL. **Fix:** use `sp_executesql` with `@NameFilter` passed as a real `@param` (so the `LIKE` value is bound, not concatenated), and since you *can't* parameterize an `ORDER BY` column name, validate `@RosterSortCol` against a whitelist (`CASE`, or check it exists in `sys.columns`) before concatenating. (SQL-Server note vs MySQL: `sp_executesql` is the parameterized-dynamic-SQL primitive — there's no PDO-style `?` placeholder; `EXEC(@string)` is the unsafe one.)

2. **Blocker (Data integrity):** The three writes — `INSERT dbo.Enrollments`, `INSERT dbo.LedgerEntries`, `UPDATE dbo.StudentAccounts` — run with **no explicit transaction, no `SET XACT_ABORT ON`, and no `TRY/CATCH`**. If the second insert or the balance update fails (deadlock victim, constraint, timeout), the earlier statements stay committed: a student gets enrolled and charged but the balance never moves, or is enrolled with no charge. *Why it slips past:* on the happy path it works every time; the partial-commit window only opens under failure. **Fix:** wrap the three writes in `SET XACT_ABORT ON; BEGIN TRY BEGIN TRAN ... COMMIT END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH;`. (SQL-Server note: unlike MySQL/InnoDB autocommit, a mid-batch runtime error here does **not** auto-roll back the prior statements unless `XACT_ABORT` is on — this catches people coming from MySQL.)

3. **Should-fix (Correctness):** `FROM dbo.StudentAccounts WITH (NOLOCK)` reads the balance that gates enrollment (`IF @Balance > 1000.00`). `NOLOCK` = read uncommitted, so this can read a balance from another transaction's *in-flight, not-yet-committed* (and possibly rolled-back) update — letting an over-limit student through or blocking a paid-up one. *Why it slips past:* `NOLOCK` is cargo-culted everywhere as a "go faster" hint and reviewers stop seeing it. **Fix:** drop the hint and read under the default `READ COMMITTED`; money decisions shouldn't be made on dirty reads. (SQL-Server note: `WITH (NOLOCK)` ≈ `READ UNCOMMITTED`; it allows dirty reads *and* missing/double-counted rows from page splits, not just stale data.)

4. **Should-fix (Correctness):** `SET @EnrollmentId = @@IDENTITY;` then stamps that id onto the ledger charge. `@@IDENTITY` returns the last identity generated *on the connection regardless of scope* — if any trigger on `dbo.Enrollments` (e.g., an audit/history trigger) inserts into its own identity table, `@@IDENTITY` returns *that* row's id and the charge gets linked to the wrong `EnrollmentId`. *Why it slips past:* it's correct today and silently breaks the day someone adds a trigger. **Fix:** use `SCOPE_IDENTITY()`, which is scope-safe (or `OUTPUT inserted.EnrollmentId` from the INSERT). (SQL-Server note: this is the canonical SQL Server gotcha — `SCOPE_IDENTITY()` is the safe default, not `@@IDENTITY`.)

5. **Should-fix (Performance):** `@StudentEmail` is declared `NVARCHAR(256)` but is compared to `dbo.Students.Email`, which in a typical schema is `VARCHAR`. Because `NVARCHAR` has higher datatype precedence, SQL Server applies `CONVERT_IMPLICIT` to the *column*, not the parameter — which can defeat the index on `Email` and turn a seek into a scan on every login/enroll. *Why it slips past:* it's invisible in the T-SQL; you only see it as an implicit-convert warning in the execution plan. **Fix:** match the parameter type to the column (`VARCHAR(256)`), or align the column to `NVARCHAR` if Unicode emails are genuinely required. (SQL-Server note: MySQL is far more forgiving about `varchar`/national-char mixing; here the precedence rule silently moves the conversion onto the indexed side.)

6. **Nit (Correctness):** `SELECT TOP (1) @TermId = TermId ... WHERE IsActive = 1` has **no `ORDER BY`**, so if more than one term is ever flagged active (a data hiccup, or overlapping terms by design) the "current term" is whichever row the engine happens to return — nondeterministic across runs and plan changes. **Fix:** add a deterministic `ORDER BY` (e.g., `ORDER BY StartDate DESC`), or enforce single-active-term with a filtered unique index so the `TOP (1)` is provably safe.

7. **Nit (Maintainability):** The roster query is `SELECT TOP (25) *` — `SELECT *` through a view bakes the column list into the API contract, so adding a view column silently widens the payload (and can break positional consumers). Also, `Terms` and `Sections` are referenced without the `dbo.` schema prefix while everything else is schema-qualified; unqualified names force per-session name resolution and read inconsistently. **Fix:** name the roster columns explicitly and schema-qualify every object (`dbo.Terms`, `dbo.Sections`).

8. **Praise (Good habit):** Credit where it's due — every statement *except* the bottom roster block is done right: the student lookup (`WHERE Email = @StudentEmail`) and both inserts use proper **parameter binding and set-based statements**, and the not-found path checks `@StudentId IS NULL` and bails cleanly. That's exactly the safe pattern the dynamic roster block should have copied — call it out so the contrast with finding #1 lands.

**Senior framing to say out loud:** "Two things block this PR: the concatenated dynamic SQL in the roster block is a straight injection vector, and the three financial writes have no transaction, so a mid-proc failure leaves a student charged-but-not-enrolled. After those I'd fix the `NOLOCK` on the balance check and the `@@IDENTITY` usage before they bite us in production, then mop up the implicit-conversion perf hit and the `SELECT *`/schema-prefix nits. The good news is the parameterized lookups elsewhere show the team knows the right pattern — we just need to apply it to the one block that reached for string-building."
</details>
