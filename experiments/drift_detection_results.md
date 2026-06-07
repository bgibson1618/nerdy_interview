# Drift-detection experiment — results (INTERIM: claude + codex; gemini pending)

Pre-registration: `drift_detection_prereg.md`. Corpus + ground truth: `drift_corpus/`.
Harness + raw reports + judge scores: `drift_corpus/_harness/`.

**Status:** 16 of 20 reviewer runs complete (claude×3 + codex×1 per cell, 2 projects × 2 reps).
Gemini's 4 runs (S-gemini + the cross-backend P-cross member) are deferred — gemini's API
quota was exhausted at run time (resets ~3.5h). Everything below is claude + codex only.

## Headline: recall is at ceiling
Every one of the 16 blinded-judged reports caught **all 12** planted drifts and returned the
correct **SIGNIFICANT DRIFT** verdict — across both backends, both projects, both reps, and
all three detectability tiers (obvious / moderate / subtle).

| condition | n reports | recall (strict) | FP / report | verdict acc | obvious | moderate | subtle |
|-----------|-----------|-----------------|-------------|-------------|---------|----------|--------|
| **S-claude** | 12 | **1.00** | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| **S-codex**  | 4  | **1.00** | 1.50 | 1.00 | 1.00 | 1.00 | 1.00 |
| S-gemini | 0 | (pending) | | | | | |

P-same control (3× claude aggregated per cell):

| aggregation | recall | FP basis |
|-------------|--------|----------|
| union (any-of-3)     | 1.00 | 3.0 (FPs accumulate across members) |
| consensus (≥2-of-3)  | 1.00 | 1.0 (idiosyncratic single-reviewer FPs filtered out) |

## What this means for the pre-registered question
- **Panel-beats-single (recall +0.15):** NOT met — recall gain is **0.00**. A single strong
  reviewer already saturates recall on drift of this detectability, so a panel cannot add recall.
- **The #12 bug-finding ranking does NOT transfer.** #12 found claude > codex > gemini on
  *bug-finding* recall. On *doc↔code drift detection*, claude ≈ codex — both at 1.00. Drift
  detection (reconciling explicit doc claims against code) is an easier, more bounded task than
  open-ended bug hunting, and frontier single reviewers max it out on modest projects.
- **The only lever a panel offers here is precision, not recall.** Union aggregation *inflates*
  false positives (3.0 vs a single reviewer's ~1.0); consensus (≥2) claws that back to ~1.0 —
  i.e. consensus protects against one reviewer's idiosyncratic false alarm but does not beat a
  single reviewer. So a panel's value proposition on this task is "filter false alarms," not
  "find more drift."

## Precision detail (false positives by backend × project)
| backend | project | n | recall | FP/rep | unplanted/rep |
|---------|---------|---|--------|--------|---------------|
| claude | pulse-dashboard | 6 | 1.00 | 1.33 | 1.83 |
| claude | taskflow-api    | 6 | 1.00 | 0.67 | 0.50 |
| codex  | pulse-dashboard | 2 | 1.00 | 3.00 | 0.00 |
| codex  | taskflow-api    | 2 | 1.00 | 0.00 | 0.00 |

- FPs concentrate in **pulse-dashboard**, and largely on *genuine baseline gaps* the generator
  left in the "coherent" base (OAuth `handleCallback` exported but no `/auth/callback` route;
  PKCE named in comments but not implemented; `getProfile`/`getMetric` defined but never called).
  These are real incompletenesses, not pure hallucinations — the judges split on whether to call
  them "false positive" vs "real-unplanted," which is itself judge noise (see caveats).
- On the **clean** project (taskflow-api), both backends are near-perfectly precise; codex had
  **0** FPs there. There is no robust backend precision difference at this n (codex's pulse FP is
  one outlier report, FP=6, against another codex report with FP=0 — high nondeterminism).

## Honest caveats
1. **Ceiling = the pre-registered confound #1 materialized.** The synthetic projects are small
   enough to hold entirely in a single reviewer's context, and each planted drift, once both
   sides are read, is individually clear. So this measures "single strong reviewers are
   sufficient *for drift of this detectability*," NOT "panels never help." A harder corpus
   (subtler drifts, or larger projects that exceed a single context) would be needed to see any
   recall separation between single and panel.
2. **The base wasn't 100% coherent.** The generated skeletons carried a few real wiring gaps
   (above), so "FP" conflates true false-positives (flagging a coherent control) with flagging
   real-but-unplanted gaps. The judge tried to separate these but was inconsistent across reports
   — the same PKCE finding was scored FP by one judge and real-unplanted by another. Treat the FP
   column as noisy; the recall ceiling is the solid result.
3. **n is small for codex** (4 reports) and **gemini is missing** — the most decision-relevant
   cell (does a *weak* backend benefit from the panel?) is exactly the one still pending.

## Provisional recommendation (subject to the gemini completion)
For `/sanity`-style doc↔code coherence checking on modest projects, **a single strong reviewer
(claude or codex) is sufficient for recall** — switching to a multi-reviewer panel buys no
recall and, naively unioned, *adds* false alarms. If a panel is used at all, it should be for
**consensus-based precision** (require ≥2 reviewers to agree before surfacing a finding), not for
coverage. The cross-backend panel's likely real value — insurance when you can't guarantee a
strong reviewer — is what the pending gemini runs will test.
