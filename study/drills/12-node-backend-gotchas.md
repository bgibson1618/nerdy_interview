## EduTrack cohort report export — Node.js backend gotchas (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// src/services/reportExport.ts
//
// Cohort progress-report export endpoints for the EduTrack platform.
// - GET /cohorts/:cohort/report  -> build & return a cohort CSV
// - GET /downloads/:file         -> serve a previously archived export
//
import { createReadStream } from "fs";
import { basename } from "path";
import * as crypto from "crypto";
import { Router, Request, Response } from "express";
import { MongoClient, Db } from "mongodb";

const SIGNING_SECRET = process.env.REPORT_SIGNING_SECRET || "dev-secret";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/edutrack";

// Cap rows per export. We coerce, reject non-finite / non-positive values,
// and clamp to a hard ceiling so a bad env var can't blow the limit open.
const MAX_ROWS = (() => {
  const raw = Number(process.env.EXPORT_MAX_ROWS);
  if (!Number.isFinite(raw) || raw <= 0) return 50_000;
  return Math.min(raw, 200_000);
})();

console.log("[reportExport] starting export service", {
  mongoUri: MONGO_URI,
  signingSecret: SIGNING_SECRET,
  maxRows: MAX_ROWS,
});

const client = new MongoClient(MONGO_URI);
let db: Db;

export async function initReportService(): Promise<void> {
  await client.connect();
  db = client.db();
}

// Per-process audit trail, surfaced on the internal /metrics page.
const exportHistory: Array<{ id: string; cohort: string; at: number }> = [];

function csvRow(s: { _id: string; name: string; score: number; status: string }): string {
  return `${s._id},${s.name},${s.score},${s.status}\n`;
}

// Signed, tamper-evident token so a client can re-download the report.
function signToken(reportId: string): string {
  const hash = crypto.pbkdf2Sync(reportId, SIGNING_SECRET, 100_000, 32, "sha512");
  return new Buffer(hash).toString("hex");
}

export const reportRouter = Router();

reportRouter.get(
  "/cohorts/:cohort/report",
  async (req: Request, res: Response) => {
    const { cohort } = req.params;

    // Let callers narrow the export, e.g. ?filter={"status":"active"}
    const filter: Record<string, unknown> = req.query.filter
      ? JSON.parse(String(req.query.filter))
      : {};
    filter.cohort = cohort;

    const students = await db
      .collection("students")
      .find(filter)
      .toArray();

    let csv = "studentId,name,score,status\n";
    for (const s of students as any[]) {
      csv += csvRow(s);
    }

    const reportId = `${cohort}-${students.length}-${Date.now()}`;
    const token = signToken(reportId);
    exportHistory.push({ id: reportId, cohort, at: Date.now() });

    if (process.env.EXPORT_DEBUG) {
      res.setHeader("X-Export-Rows", String(students.length));
      res.setHeader("X-Export-Token", token);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${cohort}-report.csv"`
    );
    res.send(csv);
  }
);

reportRouter.get("/downloads/:file", (req: Request, res: Response) => {
  // Files are written to a private volume by the nightly archive job.
  const filePath = `/var/exports/${basename(req.params.file)}`;
  const stream = createReadStream(filePath);

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.params.file}"`
  );
  stream.pipe(res);
});
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security — NoSQL injection):** Lines 59–67 — `JSON.parse(req.query.filter)` is handed straight to `students.find(filter)`. An attacker sends `?filter={"$where":"sleep(5000)||true"}` (arbitrary server-side JS) or `{"score":{"$regex":"(a+)+$"}}` (ReDoS). The `filter.cohort = cohort` on line 62 *is* ANDed with the injected predicate, so it can't read another cohort's rows — but it does nothing to stop `$where`/`$regex` from executing attacker-controlled JS/regex against this cohort's documents and pinning the event loop (and operator injection like `{"score":{"$gt":-1}}` still lets the caller reshape the query) — it slips past because the line reads like ordinary "let callers narrow results" config and the cohort assignment *looks* like it scopes the query. Fix: never `JSON.parse` untrusted input into a Mongo filter — accept an allow-listed set of fields/values validated by a schema (zod), and keep `$where` disabled server-side. (Bonus: malformed `?filter=oops` makes `JSON.parse` throw, and with no try/catch on the async handler that's an unhandled rejection — fix the error handling too.)

2. **Blocker (Availability — crash):** Lines 95–102 — `createReadStream(filePath)` is piped to the response with no `'error'` listener. A missing or locked file emits `'error'`; with no handler Node rethrows it as an **uncaught exception and the whole process dies**, taking every in-flight request with it. It slips past because the happy path (file present) works flawlessly in dev and review. Fix: attach `stream.on('error', () => res.status(404).end())` (and handle errors on `res`), or use `res.download()` / `stream.pipeline()` which propagate errors safely.

3. **Blocker (Security — secret exposure):** Lines 24–28 — the boot log dumps `signingSecret` and `mongoUri` (which carries `user:pass@host` in prod) into stdout and your log aggregator. Anyone with log access can forge download tokens and reach the database — a standing credential leak. It slips past because "log the resolved config on startup" is a common, innocuous-looking habit and the secrets hide inside an object literal. Fix: never log secrets; log only non-sensitive fields or redact (`signingSecret: "***"`), and source config from a vault.

4. **Should-fix (Performance — event-loop block):** Line 47 — `crypto.pbkdf2Sync(…, 100_000, …)` runs on every report request. It's a synchronous CPU grind on the single event-loop thread, so one export stalls **all** concurrent requests for its full duration. It slips past because `pbkdf2` *feels* like correct crypto hygiene and the `Sync` suffix is easy to skim over. Fix: use async `crypto.pbkdf2` (`promisify`), or for a non-password token just `crypto.createHmac("sha256", secret).update(reportId).digest("hex")`.

5. **Should-fix (Reliability — OOM / no streaming):** Lines 64–72 — `.toArray()` pulls the entire result set into memory, then the loop concatenates one ever-growing `csv` string, so peak memory ≈ dataset × ~2; a large cohort OOM-kills the pod. Worse, the carefully validated `MAX_ROWS` (lines 18–22) is **never applied to the query**, so the guard is dead code. It slips past because it works fine on seed data and the `MAX_ROWS` constant *looks* like it's already protecting you. Fix: stream — `find(filter).limit(MAX_ROWS).stream()` through a CSV transform piped to `res`, so backpressure bounds memory.

6. **Should-fix (Reliability — memory leak):** Lines 39 & 76 — `exportHistory` is a module-level array appended on every request and never bounded or drained, so it grows for the life of the process → steady leak and eventual OOM on a long-running server. It slips past because per-request it's "just one tiny object," and an in-memory audit list looks harmless. Fix: bound it (fixed-size ring buffer), persist to Redis/DB, or just emit a metric instead of retaining rows in process memory.

7. **Nit (Config — loose truthiness):** Line 78 — `if (process.env.EXPORT_DEBUG)` is truthy for **any** non-empty value, including the strings `"false"` and `"0"`. Whoever sets `EXPORT_DEBUG=false` to *disable* it leaves the debug headers (including the signed token) switched on. It slips past because the toggle reads like a normal boolean flag. Fix: compare explicitly — `process.env.EXPORT_DEBUG === "true"` — or parse env once through a typed config loader.

8. **Nit (Deprecation):** Line 48 — `new Buffer(hash)` uses the deprecated, footgun `Buffer` constructor (and is redundant, since `hash` is already a `Buffer`). It slips past because it still works and only emits a runtime deprecation warning. Fix: `hash.toString("hex")` directly, or `Buffer.from(hash).toString("hex")`.

9. **Praise (Reliability — validated config):** Lines 18–22 — `MAX_ROWS` is exactly how to read numeric config: coerce with `Number`, reject `NaN`/non-positive via `Number.isFinite`, clamp to a hard ceiling with `Math.min`, and fall back to a sane default. Call it out as the pattern the `EXPORT_DEBUG` read (finding 7) should have copied — the only thing missing is to actually *use* it in the query (finding 5).

**Senior framing to say out loud:** "Two findings block merge on their own: the `JSON.parse`-into-Mongo filter is a remote injection vector, and the unguarded read stream crashes the entire process on the first missing file — I'd pause the review until both are fixed, plus get those secrets out of the boot log. After that it's an availability story: the sync `pbkdf2`, the non-streaming export, and the unbounded `exportHistory` each turn one big cohort into an outage. The validated `MAX_ROWS` shows the team knows how to do config right, so let's apply that same rigor to the query limit and the debug flag."
</details>
