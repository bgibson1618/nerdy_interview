# Drift-detection experiment — pre-registration

**Question.** On the task `/sanity` *actually* performs — layered **doc↔code coherence /
drift detection** — does a multi-reviewer panel beat a single reviewer, and does backend
**diversity** add anything beyond just having more reviewers? Concretely: should `/sanity`
switch from its current **single-codex** reviewer to a panel (and if so, which)?

This is the untested half of EXPERIMENTS #12. #12 ranked backends on **bug-finding** recall
(claude > codex > gemini). Drift detection is a *different* task (reconciling claims across
docs and code, in both directions), so the ranking may not transfer. Ground-truthed,
replicated, blinded, pre-registered — per the project's methodology.

## What `/sanity` does (the task we measure)
Five-section coherence review (see `~/.claude/skills/sanity/SKILL.md`):
1. Source brief → architecture (every requirement satisfied / over- or under-built?)
2. Architecture → delivery plan (coherent order, acceptance criteria, checkable claims?)
3. Delivery/status → code (**both directions**: code violating the plan/arch, AND docs the
   code has quietly outgrown; stale CONTEXT/README status claims)
4. AI-First proof artifacts present (out of scope for this corpus — synthetic projects)
5. Verdict: ON TRACK / MINOR DRIFT / SIGNIFICANT DRIFT

## Ground truth (orchestrator-controlled)
A corpus of **synthetic mini-projects**, each = a doc-set (PRD / ARCHITECTURE /
IMPLEMENTATION_PLAN / CONTEXT / README) + a small code tree, authored to be internally
**coherent**, into which the orchestrator then **injects a known list of drifts**. The
orchestrator records every injected drift; agents never see the ground-truth list. Each item:

| field | meaning |
|-------|---------|
| `id` | drift id (or `coherent-NN` for a control claim) |
| `class` | brief↔arch · arch↔plan · plan/status↔code · doc-outgrown-by-code · numeric/config · stale-status |
| `where` | the doc claim + the code/doc fact it contradicts (file:section) |
| `truth` | the objective inconsistency, one sentence |
| `tier` | obvious · moderate · subtle (does panel help more on subtle ones?) |

**Controls are the linchpin.** Each project also carries **coherent "tempting" claims** —
statements that look like they might drift but actually match the code — to measure
false-positive rate. A panel that "finds more" is only better if it isn't just inventing drift.

## Conditions (each produces a 5-section report on the same project)
- **S-claude / S-codex / S-gemini** — single reviewer, one per backend (S-codex = today's default).
- **P-cross** — cross-backend panel: claude + codex + gemini, reports aggregated.
- **P-same** — same-backend panel: **3× claude** (fixed a priori — claude was #12's strongest
  and is the most likely panel default; chosen before running to avoid a post-hoc pick). The
  **control** isolating "more reviewers" from "diverse backends": if P-cross ≈ P-same → the gain
  is N-reviewers, not diversity; if P-cross > P-same → diversity adds value.

All conditions run on the **same harness** (the `agent_roster`, codex `read-only` sandbox),
so codex/gemini and claude are compared fairly. Reviewers get only file paths + the sanity
prompt template (no orchestrator interpretation — true fresh eyes).

**Panel aggregation** (scored both ways): **UNION** (any reviewer flags it → caught;
max recall) and **CONSENSUS** (≥2 reviewers agree; max precision).

## Metrics (per condition, per project, per rep)
- **Recall** = injected drifts caught / total injected (caught / partial / missed by the judge).
- **Precision** = real-drift flags / all flags raised.
- **FP-rate** = coherent control claims wrongly flagged as drift / total controls.
- **Verdict accuracy** = did the report land on the correct ON-TRACK/MINOR/SIGNIFICANT bucket
  (ground-truth verdict from the injected drift count/severity).
- **Subtle-tier recall** (does diversity help most on the hard ones?).

## Scoring (blinded)
A **judge agent** receives each report + the project's ground-truth drift list and marks every
injected drift caught/partial/missed and classifies every flag the report raised
(planted-drift / real-unplanted / false-positive). The judge is **blind to which condition**
produced the report (reports are shuffled + de-labeled). Primary judge = claude; a **codex
judge re-scores a random sample** to check judge self-preference (echoing #12's judge
calibration, where self-preference was small but nonzero). Disagreements are spot-checked by
the orchestrator against ground truth.

## Pre-registered decision rules
- **Panel beats single** if best-panel recall − best-single recall ≥ **+0.15** at FP-rate not
  worse by more than +0.10. (Recall gain must not be bought with hallucinated drift.)
- **Diversity matters** if P-cross recall − P-same recall ≥ **+0.10** (same aggregation).
- **Ranking transfer**: report whether single-backend drift recall ordering matches #12's
  bug-finding ordering (claude > codex > gemini) or differs.
- Recommendation for `/sanity`: keep single-codex / switch to single-X / switch to P-cross /
  switch to P-same — chosen by the above rules on the measured numbers, stated even if null.

## Scale (set by the user; fills the corpus/replication knobs)
- **LIGHT** — 1 project, ~10 drifts + ~6 controls, all 5 conditions, 1 rep, claude judge. (~9 reviewer runs)
- **MEDIUM** — 2 projects (different domains), ~12 drifts + ~7 controls each, 5 conditions, 2 reps,
  both aggregations, claude judge + codex spot-check. (~36 reviewer runs)
- **HEAVY** — 3 projects, ~15 drifts + ~8 controls each, 5 conditions, 3 reps, both aggregations,
  dual judges on a sample. (~80 reviewer runs)

## Honest confounds
- Synthetic projects may be cleaner/smaller than real ones → drift may be easier to spot than
  in production (recall biased high); mitigated by including subtle-tier drifts + realistic doc bulk.
- Reviewer nondeterminism → reps; 1 rep (LIGHT) is directional only.
- Judge is itself an LLM scoring LLM reports → blinding + codex cross-check + orchestrator spot-check.
- `agent_roster` real-backend runs are slow; HEAVY is ~80 sequential/batched tmux agents (long wall-clock).
- Single-codex is the incumbent, so the experiment is adversarial to the *new* (panel) option — the bar
  to switch is deliberately set with a margin (+0.15), not a tie.
