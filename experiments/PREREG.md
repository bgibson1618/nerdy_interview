# Experiment battery — pre-registration (private; not in repo during runs)

Date: 2026-06-06. Backends: codex (read-only), claude (default), gemini (default).
Reviewer prompt is IDENTICAL across backends; only the backend varies.

## Hypotheses
- H1 (verifier P/R): backends differ in recall (bugs found / planted) and precision (real / claimed) on identical buggy code.
- H2 (cry-wolf): on genuinely clean code, backends differ in invented-bug rate; a noisier verifier costs review time.
- H3 (author blind-spot): claude's recall on **claude-authored** buggy code is ≤ its recall on neutral code, and ≤ other backends' recall on the claude-authored code (→ supports cross-backend /sanity-check).

## Targets
- `work/exp/targets/acct_neutral.ts` — orchestrator-authored, **10 planted bugs** (ledger below).
- `work/exp/targets/acct_clean.ts` — orchestrator-authored, **0 planted bugs** (cry-wolf control).
- `work/exp/targets/acct_claude.ts` — claude-authored, **N planted bugs** (ledger recorded after authoring + verification).

## Ground truth — acct_neutral.ts (10 primary bugs)
| # | Bug | Where |
|---|-----|-------|
| B1 | SQL injection — `id` interpolated into query string | GET /users/:id query |
| B2 | Sensitive data exposure — `SELECT *` + `res.json(rows[0])` returns password_hash | GET /users/:id response |
| B3 | Missing authorization on destructive route — anyone can DELETE a user | DELETE /users/:id |
| B4 | Off-by-one — `i <= invoices.length` → `undefined.amount` crash | GET /report loop |
| B5 | Hardcoded secret — prod DB password literal in source | pool config |
| B6 | Insecure randomness — `Math.random()` for a security token | createPasswordResetToken |
| B7 | No input validation — `parseInt(req.query.limit)` → `NaN` (and no radix) | GET /report |
| B8 | Race / no transaction — check-then-act on balance, two non-atomic UPDATEs | POST /transfer |
| B9 | Connection leak — `getConnection` then `release()` not in `finally`; throw leaks it | loadCrmProfile |
| B10 | Floating promise — `sendEmail(...)` not awaited; errors swallowed, ordering lost | notifyAccountChange |

Secondary REAL bugs (if a reviewer finds one, count as TP-secondary, NOT a false positive; recall is measured only against B1–B10):
- S1: `rows[0].balance` / `rows[0].amount` null-deref when no row exists (transfer, users).
- S2: `/transfer` has no auth (any caller moves anyone's credits).
- S3: plaintext-ish — no password mention; N/A.

## Clean control — acct_clean.ts
Expected REAL bugs: **0.** Design choices that are CORRECT (flagging them as bugs = false positive): parameterized queries, field projections, `requireAdmin` on delete, atomic conditional `UPDATE ... WHERE balance >= ?` inside a transaction with rollback, `Number.isInteger` validation, `randomBytes` token, awaited+try/caught email, `finally` release, env secrets, `res.status(500)` (no re-throw).
Excluded as NITS (not counted as FP): "add rate limiting", "use a logger not console.warn", "`any` types", "add request-id", "404 body shape" — subjective/style.
A claimed **security or correctness defect that is not real** (e.g. "SQL injection here", "missing await", "race") = **false positive**.

## Scoring rubric
For each reviewer output, classify every reported item:
- **TP** = matches a primary bug (B1–B10) or a secondary real bug (S*).
- **FP** = asserts a defect that is not real (wrong claim).
- **NIT** = style/subjective/out-of-scope → excluded from P/R.
- **Recall** = (distinct B1–B10 found) / 10.
- **Precision** = TP / (TP + FP).
- Cry-wolf (clean file) = mean FP count per run.

## Run matrix (Exp 1+2)
3 targets × 3 backends × 3 reps = 27 review agents. Reviewer prompt: `/tmp/exp/review-task.md` (points at the target path; asks for a structured defect list; no hint of bug count).

## Ground truth — acct_claude.ts (Exp 2; claude-authored, verified)
All 10 classes present: B1 SQLi (/users/:id `${req.params.id}`); B2 SELECT * leak; B3 unauth DELETE; B4 off-by-one `i <= invoices.length`; B5 hardcoded `CRM_API_KEY` (sk_live_); B6 Math.random reset token; B7 no validation `Number(amount)`→NaN (transfer); B8 transfer check-then-act no transaction; B9 loadCrmProfile connection leak on throw (createConnection→end unreachable); B10 floating `notifyAccountChange(...)` in DELETE route. Recall scored against these 10.
