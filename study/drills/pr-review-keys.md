# PR review drills — answer keys

> ⚠️ **SPOILERS.** These are the planted-bug keys for the open review-practice PRs
> on GitHub. **Review the PR diff on GitHub first** (write your comments, severity-tag
> them, decide block vs. nit), *then* expand the matching section to self-grade.
>
> The keys live on `main` and are **not** part of any PR diff, so opening a PR on
> GitHub won't show you the answers. The discipline is yours to keep.

How to run each one (≈15 min):
1. Open the PR on GitHub. Read the description as if a teammate wrote it.
2. Review the **Files changed** tab top-to-bottom. Leave real review comments.
3. Lead with correctness/security/design; severity-tag (Blocker / Should-fix / Nit).
4. Say your senior-framing summary out loud: what you'd *block* vs. *raise* vs. *leave to a linter*.
5. Expand the key below and compare. Score: did you catch every Blocker?

---

## PR #1 — `feat/payment-webhook`: "Add payment webhook handler to grant course access"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — no signature verification):** the handler trusts `req.body` as a genuine provider event and **never verifies a webhook signature** against the signing secret. Anyone who can POST to `/webhooks/payments` forges `payment.succeeded` and grants themselves any course for free. Note `router.ts` mounts `express.json()`, which *consumes* the raw body you'd need to verify a signature — so the fix is two-part: capture the raw body (`express.raw`) **and** verify the provider's signature header before doing any work.
2. **Blocker (Data integrity — not idempotent):** every delivery is processed unconditionally. Webhook providers retry on any non-2xx and can deliver duplicates, so the same `event.id` runs `grantAccess` again → duplicate enrollments / double refunds. Dedupe on `event.id` (a processed-events table or a unique constraint so replays are no-ops).
3. **Should-fix (Reliability — slow synchronous ack):** the DB write *and* `sendReceiptEmail` run before the 200. If email or the DB throws, you return 500, the provider retries forever — and `grantAccess` may already have run (compounding #2). Ack fast after minimal validation, grant idempotently, and move email to a background job; an email failure must not fail the webhook.
4. **Should-fix (Correctness — partial failure):** `grantAccess` then `sendReceiptEmail` aren't atomic; email failure 500s *after* access was granted, leaving inconsistent state. Tied to #2/#3 — make the grant idempotent and decouple the email.
5. **Should-fix (Info leak):** `catch { res.status(500).send(err.message) }` returns the internal error string to the caller. Log server-side; return a generic status.
6. **Nit (Correctness — money as float / loose `==`):** `parseFloat(amount) == 0` parses minor-units money as a float and uses loose equality. `amount` is integer minor units — compare with `===` (or treat as int); the free-promo branch is also oddly structured (grants then early-returns).
7. **Praise (Webhook hygiene):** the unknown-event-type branch returns **200** (`sendStatus(200)`) so the provider stops retrying events you don't handle — correct. Contrast it with the missing signature check: the author thought about retries but not authenticity.

**Senior framing:** "Block on the missing signature check (forged webhooks = free access) and the non-idempotent processing (retries double-grant). Raise the synchronous ack and the leaked error message as fix-before-prod. The float money is a nit. Good instinct acking unknown events — apply that same care to verifying they're real."
</details>

---

## PR #2 — `feat/students-rest-api`: "Add REST endpoints for student roster"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — mass assignment + identifier injection):** `POST /students` builds the INSERT from `Object.keys(req.body)`, so the **client chooses which columns are written** — a caller sets `role: 'admin'`, `credits`, `is_verified`, whatever exists. Worse, those column names are **string-interpolated** into the SQL (`INSERT INTO students (${columns}) ...`); the *values* are parameterized but the *identifiers* are not, so a crafted key is also a SQL-injection vector. Fix: whitelist allowed fields explicitly; never interpolate client-derived identifiers.
2. **Blocker (Security — broken object-level auth / IDOR):** neither `GET /:id` nor `PATCH /:id` checks that the requester may see or modify that student — in fact **no route authenticates at all**. Any caller reads or renames any student by enumerating ids. Fix: require auth and check ownership/role on every record access.
3. **Should-fix (Privacy — `SELECT *`):** list and get both `SELECT *`, shipping sensitive columns (e.g. `password_hash`, email) to the client. Use an explicit column allow-list.
4. **Should-fix (Scale — no pagination):** `GET /students` returns **every** row unbounded. Add LIMIT/OFFSET or keyset pagination.
5. **Should-fix (Correctness — wrong status codes):** create returns the default **200** instead of **201**; `GET /:id` for a missing student returns **200 with `null`** instead of **404**. Callers can't distinguish "found nothing" from "here's null."
6. **Should-fix (Validation):** create only checks the body is non-empty — no required-field or type validation before it hits the DB.
7. **Should-fix (Info leak):** create's `catch` returns `err.message` (DB internals) to the client.
8. **Praise (Parameterization):** `GET /:id` and `PATCH /:id` correctly bind **values** with `?` placeholders, and PATCH scopes to a single hard-coded column (`display_name`). The author clearly knows to parameterize values — the gap is the dynamically-built column list in create and the missing authorization.

**Senior framing:** "Block on mass assignment (privilege escalation + injection via column names) and the total absence of authorization (any user reads/edits any student). Raise `SELECT *`, no pagination, and the wrong status codes as must-fix. Credit the parameterized values — the fix is to extend that rigor to the column list and add an auth check."
</details>

---

## PR #3 — `feat/jwt-auth-middleware`: "Add JWT auth middleware"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — signature never verified):** `requireAuth` calls `jwt.decode(token)`, which **only base64-decodes** the token — it never checks the signature. Any user mints `{ id, role: 'admin' }`, base64s it, and is trusted. Tell-tale: `JWT_SECRET` is declared but **never used** in `requireAuth`. Fix: `jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })` (pin the algorithm to avoid `alg:none`/confusion).
2. **Blocker (Security — fail-open auth):** the `catch` calls `next()`. A malformed/forged token makes `jwt.decode` return `null`, so `payload.id` throws → the catch lets the request **proceed unauthenticated** (no `req.user`). Auth must fail **closed**: `return res.status(401)` in the catch.
3. **Should-fix (Security — token in query param):** it accepts `req.query.token`, so tokens leak into URLs, access logs, browser history, and `Referer` headers. Take the token from the `Authorization` header only.
4. **Should-fix (Correctness — no expiry / claims check):** `decode` doesn't validate `exp`, `iss`, or `aud`, so an expired token is accepted. Fixed implicitly by switching to `verify`, but call it out.
5. **Should-fix (Privilege — trusts a forgeable claim):** `requireAdmin` trusts `req.user.role`, which is attacker-controlled until #1 is fixed. It's correct *only* once tokens are actually verified.
6. **Nit (Security — weak secret fallback):** `process.env.JWT_SECRET || 'dev-secret-change-me'` silently falls back to a **known** secret if the env var is missing (e.g. a misconfigured prod box). Fail closed when it's unset. (Moot while #1 ignores the secret entirely — but critical the moment you switch to `verify`.)
7. **Praise (Correct signing):** `issueToken` is right — `jwt.sign` with the secret and a 30-day `expiresIn` — and `requireAdmin` returns a clean 403. The whole fix is to make `requireAuth` **verify** with the same secret `issueToken` signs with.

**Senior framing:** "Block on two: `decode` instead of `verify` (every token is forgeable, including `role: admin`) and the fail-open `catch` (auth errors let requests through). Raise the query-param token and the weak secret fallback. The encouraging part is `issueToken` already signs correctly — the verify path just has to use the same secret."
</details>

---

## PR #4 — `feat/password-reset`: "Add password reset flow"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — predictable token):** the reset token is `Math.random().toString(36)` ×2 — `Math.random()` is **not** cryptographically secure, so tokens are guessable/predictable and an attacker can forge a valid reset. The irony: `randomBytes` is imported and used right below for the salt — they had the right tool. Fix: `randomBytes(32).toString('hex')`.
2. **Blocker (Security — token never expires, never single-use):** the token is stored with no expiry, and `/confirm` sets the password but never clears `reset_token`. So a leaked/old link works forever and is replayable. Fix: store an expiry, check it, and null the token on use (and on password change).
3. **Should-fix (Security — user enumeration):** `/request` returns `404 "no account for that email"` for unknown emails vs `200` for known ones, so an attacker can enumerate registered users. Fix: always return the same generic 200 ("if that email exists, we sent a link").
4. **Should-fix (Security — token logged):** `console.log('[password-reset] emailing … link …')` writes the live reset link (token) to logs/aggregators where it can be replayed within its (nonexistent) TTL. Fix: never log the token; log a correlation id.
5. **Should-fix (Security — loose token check + no rate limit):** `user.reset_token != token` uses loose `!=`, and `/request` has no rate limiting, so it doubles as an enumeration/spam amplifier. Fix: strict compare (ideally constant-time), and rate-limit by IP/email.
6. **Nit (no password policy):** `newPassword` is hashed without any length/strength validation. Fix: validate before hashing.
7. **Praise (Correct hashing):** `/confirm` hashes the new password with `scrypt` and a **per-user random salt** — a real KDF, done right. That's exactly the bar; the token generation just needs the same crypto rigor (`randomBytes`, not `Math.random`).

**Senior framing:** "Block on the `Math.random` token and the no-expiry/replayable token — together they make account takeover trivial. Raise the enumeration response, the logged token, and the missing rate limit. Credit the scrypt+salt hashing — the author clearly knows secure crypto, so the fix is to apply it to the token too."
</details>

---

## PR #5 — `feat/avatar-upload`: "Add avatar upload endpoint"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — path traversal on write):** `path.join(UPLOAD_DIR, filename)` with a client-controlled `filename` lets `../../…` escape the upload dir and **overwrite arbitrary files** (e.g. app code, cron). Fix: `path.basename` + a server-generated name, and verify the resolved path stays under `UPLOAD_DIR` (`path.resolve(...).startsWith(root)`).
2. **Blocker (Security — stored XSS via trusted content-type):** the client-supplied `contentType` is stored and replayed verbatim as the response `Content-Type` on `GET /file/:id`, served inline same-origin. Upload `text/html`/SVG with a script and it executes in victims' browsers. Fix: don't trust client content-type — allow-list image types, send `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`, ideally serve from a separate origin/CDN.
3. **Blocker (Security — no auth / IDOR):** `POST /:userId` lets **any** caller upload to **any** userId and overwrite someone else's avatar. Fix: require auth; force the target to the authenticated user.
4. **Should-fix (Availability — no real size/type validation):** only a 20 MB JSON limit; base64 inflates, there's no per-user quota and no magic-byte check, so it's a disk/DoS vector and lets non-images through. Fix: cap decoded size, verify real image bytes.
5. **Should-fix (Correctness — sync fs blocks the event loop):** `fs.writeFileSync` / `fs.readFileSync` on the request path stall every concurrent request under load. Fix: `fs.promises` / streaming.
6. **Should-fix (Reliability — unawaited insert):** the `db.query(INSERT …)` is **not awaited** — a floating promise. The response is sent (claiming success) regardless of whether the row was written, and any insert error is swallowed as an unhandled rejection. Fix: `await` it inside a try/catch.
7. **Praise (Good id + parameterization):** the avatar record id is a server-side `randomUUID()` (not client-controlled) and the insert is parameterized — good instincts. The gap is trusting the filename and content-type and skipping auth.

**Senior framing:** "Block on the path traversal, the content-type stored-XSS, and the missing authorization — any one is a real compromise. Raise the size/type validation, the sync fs, and the unawaited insert. Credit the UUID + parameterized insert."
</details>

---

## PR #6 — `feat/graphql-notes`: "Add GraphQL session-notes resolvers"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — IDOR / missing auth):** `studentNotes(studentId)` returns any student's **private** tutor notes with no `ctx.user` check — any caller reads anyone's notes by changing the id. Fix: verify the caller is that student's tutor (or admin) before returning.
2. **Blocker (Security — unauthorized mutation):** `deleteNote(id)` deletes a note with **no auth and no ownership check** — any caller deletes any note. Fix: require auth and confirm the note belongs to the caller.
3. **Should-fix (Performance — N+1):** `Note.author` runs one `SELECT users` per note, so a list of N notes fires N author queries. Fix: batch with a DataLoader keyed on `author_id`.
4. **Should-fix (Privacy — full-row leak):** `Note.author` does `SELECT *` from `users`, handing the raw row (password hash, email, …) to the `User` resolver — over-fetching and a leak risk. Fix: select an explicit projection.
5. **Should-fix (Correctness — non-null mismatch):** `note(id): Note!` is non-null but returns `rows[0]`, which is `undefined` for an unknown id; resolving a non-null field to null makes GraphQL error the whole query. Fix: throw a NotFound error, or make the field nullable.
6. **Should-fix (no pagination):** `studentNotes`/`myNotes` return all rows unbounded. Fix: paginate.
7. **Nit (input validation):** `createNote` doesn't validate `body` (empty/length) before inserting.
8. **Praise (Auth done right):** `myNotes` derives identity from `ctx.user.id` and ignores client args — the secure pattern `studentNotes` should copy.

**Senior framing:** "Block on the two authorization holes — `studentNotes` is an IDOR and `deleteNote` has no ownership check. Raise the N+1, the `SELECT *` leak, the non-null mismatch, and pagination. The fix template already exists in the file: `myNotes` does auth correctly."
</details>

---

## PR #7 — `feat/course-cache`: "Add in-process read cache for courses and dashboards"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Security — cross-user data leak):** `getStudentDashboard` caches each student's **personalized** dashboard under the constant key `'dashboard'` — the key omits `studentId`. The first student's private data (their courses, messages) is then served to **every** other student. Fix: key on the user (`dashboard:${studentId}`).
2. **Should-fix (Correctness — no invalidation / stale reads):** `updateCourse` writes the DB but never invalidates the cached course, so `getCourse` serves the old title until the process restarts. Fix: `cache.delete(courseId)` (or update it) on write.
3. **Should-fix (Availability — unbounded cache):** the `Map` has no size cap and no eviction — it grows forever. Fix: a bounded LRU.
4. **Should-fix (Correctness — TTL is dead code):** `TTL_SECONDS`/`expiresAt` are computed but never enforced (and the unit is seconds added to a millisecond `Date.now()`), so nothing ever expires. Fix: store `{ value, expiresAt }` in ms and check on read.
5. **Should-fix (caches misses):** `getCourse` uses `cache.has`, so a missing course caches `undefined` and is returned forever even after the row is created. Fix: don't cache misses (or use a short negative TTL).
6. **Should-fix (cache stampede):** on a cold key under load every concurrent caller misses and hits the DB at once — no single-flight. Fix: cache the in-flight promise so concurrent callers share one query.
7. **Praise (Fully-qualified key):** `getEnrollment` builds `enrollment:${studentId}:${courseId}` — every dimension in the key. That's exactly the discipline `getStudentDashboard` is missing.

**Senior framing:** "Block on the `'dashboard'` key — it's a cross-user privacy leak, not just a perf bug. Raise the missing invalidation, the unbounded growth, the dead TTL, and the stampede. The in-file model is `getEnrollment`'s fully-qualified key."
</details>

---

## PR #8 — `feat/email-queue-worker`: "Add background email queue worker"

<details>
<summary><b>Answer key — don't peek until you've reviewed the PR</b></summary>

1. **Blocker (Reliability — ack before process → lost email):** `queue.delete(msg.id)` runs **before** `deliver(msg)`. If the send throws (or the process dies between the two), the job is already gone — the email is silently never sent. Fix: delete only **after** a successful send; rely on a visibility timeout for retries.
2. **Should-fix (Correctness — not idempotent → double-send):** nothing dedupes on `msg.id`. Queues are at-least-once, so a redelivered message sends the same email twice. Fix: idempotency key / processed-id set, or make delivery idempotent.
3. **Should-fix (Reliability — poison message, infinite retry):** on failure `requeue(msg)` re-adds the job with no attempt counter, no cap, and no dead-letter queue — a permanently-bad message loops forever. Fix: track attempts, cap retries, DLQ after N.
4. **Should-fix (no backoff):** `requeue` is immediate, so a failing provider gets hammered with zero delay. Fix: exponential backoff.
5. **Should-fix (Availability — unbounded concurrency):** `Promise.all(messages.map(...))` fires all 100 sends at once with no concurrency cap — floods the provider, risks rate-limit bans and memory spikes. Fix: bound concurrency (e.g. p-limit, or batch).
6. **Should-fix (Observability — swallowed error):** the `catch` requeues but logs nothing, so delivery failures are invisible to on-call. Fix: log the error with context.
7. **Nit (busy-loop):** `while (true)` with no sleep when `receive` returns empty spins hot, pegging CPU and hammering the queue. Fix: backoff / long-poll on empty.
8. **Praise (Defensive shape check + typed contract):** it validates `msg.to`/`msg.template` and drops malformed jobs instead of crashing the batch, behind a typed `QueueMessage` interface — good habits. (Note even the skip path deletes — consistent with the ack-ordering issue to fix.)

**Senior framing:** "Block on ack-before-process — it silently loses email on any failure. Raise idempotency (double-sends), the poison-message infinite retry with no DLQ, unbounded concurrency, and the swallowed errors. Credit the typed contract and shape validation."
</details>
