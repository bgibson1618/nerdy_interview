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
