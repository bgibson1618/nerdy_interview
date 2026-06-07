# Backend experiment battery — results & recommendations

Four ground-truthed, replicated experiments (2026-06-06) to turn the anecdotal
findings (#1–#11) into decisions. Backends: **codex** (read-only), **claude** (default),
**gemini** (default). Pre-registration + ground truth: [`PREREG.md`](PREREG.md); raw
scores: [`exp12_scores.md`](exp12_scores.md); review targets: [`targets/`](targets/).

---

## TL;DR — answers to the four questions

**1. Should `/sanity-check` spawn a *different* backend instead of a fresh claude?**
The reviewing data says shared authorship is **not** the problem: claude reviewed
**claude-authored** buggy code as well as it reviewed neutral code (9.7 vs 10.0 / 10).
So a fresh claude is a fine reviewer of claude's code. **But two things argue for a small
panel over any single reviewer:** (a) *every* single reviewer missed ≥1 real bug on some
run, while the **union of any two backends hit ~10/10**; (b) the "clean" control I wrote
(as claude) actually shipped ~4 real bugs, and cross-backend review caught them all — authors
ship bugs they believe absent. **Recommendation:** make `/sanity-check` a **2-backend panel**
(claude + codex). If it must be one, claude. The win is "more than one reviewer," not
"different from the author."

**2. Should the default verifier change from codex to claude?**
**Claude has the best recall** (≈10/10) and is the strongest single verifier. But **codex is a
close, *more exhaustive* second** — it reported more *real* secondary bugs (14–20 items, ~0
false), and its only known failure mode is **large open-ended** input (#1), not concrete review.
**Recommendation:** default the verifier to **claude** for quality; keep **codex** for thorough
*bounded* reviews (and as the panel's second). **Do not make gemini your sole correctness/security
verifier** — see below.

**3. Should gemini do more than research?**
**Yes — as a judge and second opinion, not as a security verifier.** As a blind judge it was
**reliable and unbiased** (agreed with the cross-backend consensus on every task, never
self-preferred). But as a *verifier* it has a **systematic blind spot**: it missed the
`SELECT *` data-exposure bug and the missing-authorization bug on **both** targets, **every
rep** (recall ≈8/10 vs claude's ~10). It reliably catches injection, hardcoded secrets,
off-by-one, and `Math.random`. **Recommendation:** promote gemini to **research + judging +
breadth/second-opinion**; keep it **off the security gate**.

**4. Can two agents message each other autonomously, or only via the orchestrator?**
**They can — directly — with scaffolding.** In Exp 4 two agents solved a split-secret task by
messaging each other through `agent-roster note` + inbox polling, **no orchestrator relay**
(round-trip ~8s, correct answer). What's required: tell each agent its **peer's label**, the
exact `note` command, and a **poll-the-inbox** convention, and run them in a mode that lets them
execute Bash unattended (`bypassPermissions`). What's **missing** is a first-class A2A primitive:
peers/`note` are invisible in the default prompt, there's no delivery/notification (poll only),
and no addressing/await. **Recommendation:** if you want routine A2A, add a real primitive;
today it's hub-and-spoke by default and peer-to-peer only when you wire it. **(Now built — see Follow-ups.)**

---

## Exp 1+2 — verifier precision/recall (ground truth: 10 planted bugs/file, 3 reps)

Recall = distinct planted bugs found / 10.

| backend | neutral target (Exp 1) | claude-authored target (Exp 2) |
|---|---|---|
| **claude** | **10.0** (10/10/10) | **9.7** (9/10/10) |
| **codex**  | 9.7 (10/9/10) | 8.3 (8/7/10) |
| **gemini** | 7.7 (8/7/8) | 8.0 (8/8/8) |

- **Precision was high for all three on the buggy files (~0 false positives)** — every flagged
  item was a real defect. codex's larger volume is *signal* (real secondary bugs), not noise.
- **Gemini's blind spot is specific and repeatable:** it missed *sensitive-data exposure*
  (`SELECT *` → client) and *missing authorization* on both targets, all reps.
- **No author blind-spot at review time:** claude on claude-authored code ≈ claude on neutral.
- **Cry-wolf control backfired instructively:** my "clean" file wasn't clean (no auth on
  `/transfer`, credit leg never checks `affectedRows`, DECIMAL string-concat, Express-4 unhandled
  rejection). All three backends found these real bugs and **none hallucinated** — nobody flagged
  the genuinely-fixed code (parameterized queries, `randomBytes`, `finally` release). Strong
  evidence that (a) backends don't cry wolf on correct code, and (b) a second reviewer catches
  the author's own misses.

## Exp 3 — judge calibration (2 fresh blind bake-offs × 3 judges × 2 reps = 12 judgments)

Blind A/B/C mapping varied per task. Winner per task, by judge:

| task | winner (unanimous) | self-preference observed? |
|---|---|---|
| SQL gotchas | **claude** — #1 by **all 6** judges (incl. codex & gemini, above themselves) | claude self-#1, but corroborated by 4 foreign judges |
| async gotchas | **codex** — #1 by **all 6** judges (incl. claude & gemini, above themselves) | codex self-#1, but corroborated by 4 foreign judges |

- **Inter-judge agreement was effectively perfect on the winner** — blind judging is reliable/low-noise.
- **The best *generator* is domain-dependent:** claude won SQL, codex won async. No backend
  dominates all generation.
- **Net self-preference bias ≈ 0 here:** a judge ranked itself #1 *only* when it was the genuine
  consensus winner; when it wasn't the best, every judge honestly ranked itself #2 or #3. This
  **walks back the Phase-4 #8 "codex self-preference"** worry — that was the lone unsupported
  self-#1 across three tasks. Still, for high-stakes judging use a **panel** (majority would have
  corrected the Phase-4 outlier automatically).
- Judges also **agreed on technical errors** (e.g. multiple flagged the same data-type-precedence
  mistake in one SQL candidate) — error-detection is consistent, not random.

## Exp 4 — autonomous peer-to-peer messaging: **works with scaffolding**

ALPHA (secret) + BETA (formula) solved a split task by messaging each other via `note`+inbox,
no relay, correct answer in ~8s. Enabled by: peer label + exact `note` command + poll convention
+ `bypassPermissions`. Gap: no first-class A2A primitive (no addressing, delivery, or await; poll-only).

---

## Follow-ups

### Cry-wolf, resolved (real false-positive rate)
Re-ran the precision test against a **genuinely clean** read-only target
(`work/exp/targets/catalog_clean.ts` — parameterized queries, async-rejection wrapper,
input validation, auth-scoping, projections, public-by-design reads), 3 backends × 3 reps:

| backend | result |
|---|---|
| codex  | "NO DEFECTS FOUND" ×3 → **FP = 0** |
| gemini | "NO DEFECTS FOUND" ×3 → **FP = 0** |
| claude | "NO DEFECTS FOUND" ×2; 1 MINOR (deep-pagination OFFSET / `>MAX_SAFE_INTEGER` precision) — a defensible hardening nit, not a hallucination |

**False-positive rate ≈ 0.** Backends correctly recognized clean code as clean. Combined with
Exp 1 (where they found every real bug and flagged nothing fixed), this confirms **high precision**
across all three — the Exp-1 "clean" confound is resolved.

### A2A messaging primitive — built & demoed
Implemented in the plugin (commit `d49527e`, local): `agent-roster peers` (discovery),
`send --from` (attributed delivery, logs a `message_sent` event), and `recv [--wait] [--timeout]
[--peek]` (returns only NEW messages via a per-inbox read cursor; `--wait` blocks until a peer
messages you). `run-role --peers` injects a "Peer messaging" block (the agent's label, run-id,
and exact commands) so agents coordinate directly — **opt-in, off by default**.

Demo: two agents solved the split-secret task via `peers → send → recv --wait`, **no orchestrator
relay and no hand-rolled poll loop** (the Exp-4 agents had to spell out the `note` path and write
an `until [ -s ]` loop; here discovery + a real blocking receive are first-class). Round-trip ~8s,
correct answer. Still missing for "production" A2A: addressing beyond a shared run, delivery
push/notification (it's still cursor-poll under `--wait`), and multi-peer fan-in/out semantics.

---

## Caveats (honest limits)
- Ground truth is **one author's** bug ledger per file; "is this finding a match" was scored by
  the orchestrator against a pre-registered list (rubric in PREREG). 3 reps/cell estimates but
  doesn't eliminate variance.
- ~~The cry-wolf metric was confounded (clean file wasn't clean)~~ → **resolved** in Follow-ups
  with a truly-clean target: FP ≈ 0 across all three backends.
- Exp 3 quality "winner" is judge-consensus, not an independent oracle; self-preference is the
  objective sub-metric. Domains tested: SQL, async (plus Phase-4 JS/TS/React).
- All single-vendor (Anthropic/OpenAI/Google) latest models as wired in the roster on this date.
