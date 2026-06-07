# Drift-detection experiment — results (FINAL)

Pre-registration: `drift_detection_prereg.md`. Corpus + ground truth: `drift_corpus/`.
Harness, 40 raw reports, blinding manifest, judge scores: `drift_corpus/_harness/`.

**Question.** On the task `/sanity` actually performs — doc↔code coherence / drift detection —
does a multi-reviewer panel beat a single reviewer, does backend *diversity* add value beyond
more reviewers, and does the EXPERIMENTS #12 bug-finding backend ranking transfer? Should
`/sanity` move off its single-codex reviewer?

**Design (as run).** 4 synthetic projects (2 "easy" value-drift + 2 "hard" behavioral-drift),
each injected with 12–13 recorded drifts + ~7 coherent "tempting" controls. 5 conditions ×
2 reps: single **claude / codex / gemini-3-flash-preview** (via `agent_roster`), the
**P-same** control (3× claude), and the cross-backend **P-cross** panel (claude+codex+gemini).
**40 reviewer reports**, each scored by a **blinded** claude judge against the answer key
(caught/partial/missed per drift + false positives). Models: claude (roster default), codex
(`read-only`→`workspace-write`), gemini-3-flash-preview.

## Headline results

| | easy round (value drift) | hard round (behavioral drift) |
|---|---|---|
| single recall (claude / codex / gemini) | 1.00 / 1.00 / 1.00 | **0.90 / 0.96 / 0.87** |
| subtle-tier single recall | 1.00 / 1.00 / 1.00 | **0.83 / 0.94 / 0.78** |
| single FP / report (cl / cx / gm) | 0.75 / 1.75 / 2.00 | **0.67 / 0.00 / 1.00** |
| P-same (3× claude) union / consensus recall | 1.00 / 1.00 | 0.92 / 0.88 |
| P-cross (cl+cx+gm) union / consensus recall | 1.00 / 1.00 | **0.96 / 0.92** |

### 1. The easy round hits a recall ceiling; the hard round breaks it
Value-swap drifts (a config number, a renamed field, a wrong endpoint) are caught by **every**
single reviewer **100%** of the time — so on that class, a panel cannot add recall and the
backends are indistinguishable on recall. The hard round (behavioral inversions, off-by-ones,
atomicity, units bugs) drops single recall to **0.87–0.96**: subtle behavioral drift *is*
missed by single reviewers. This is where the question becomes real.

### 2. The #12 bug-finding ranking does NOT transfer — it REVERSES
#12 ranked **claude > codex > gemini** on *bug-finding* recall. On *behavioral drift detection*
the order is **codex (0.96) > claude (0.90) > gemini (0.87)**, and codex is also the most
**precise** (0.00 FP/report on the hard round vs claude 0.67, gemini 1.00). Codex was strongest
and cleanest at exactly the thing `/sanity` does. Drift detection ≠ bug hunting; the backend you
want differs by task.

### 3. Backends have DIFFERENT blind spots — that's the real case for diversity
Per-drift catch rates (hard round, across all 20 reports) expose backend-specific blind spots:

| drift | what it is | caught | claude | codex | gemini |
|-------|------------|--------|--------|-------|--------|
| **ING-D10** | a removed `if (isSymbolicLink) continue` guard (doc: "symlinks not followed") | **0/10** | 0/6 | 0/2 | 0/2 |
| **ING-D7** | atomicity: `db.transaction()` wrapper removed | 3/10 | **0/6** | **2/2** | 1/2 |
| **LED-D2** | balance invariant: cache `+= amount` while the entry credits `net` | 4/10 | 2/6 | 2/2 | 0/2 |

- **Claude has a systematic atomicity blind spot** (ING-D7: 0/6) that **codex completely covers**
  (2/2). This is the diversity argument made concrete: P-cross *union* catches ING-D7 because
  codex rescues claude's miss. That is why P-cross union (0.96) > P-same union (0.92) > single
  claude (0.90).
- **ING-D10 is a UNIVERSAL blind spot: 0/10 — no backend, and therefore no panel, caught it.**
  A *removed guard* leaves no positive code trace; catching it requires noticing an **absence**
  against the doc, which doc↔code review structurally under-detects. The panel can only union
  what *someone* sees — it cannot rescue what nobody sees. This bounds the achievable recall of
  *any* reviewer configuration.

### 4. Panel value is real but bounded; aggregation choice matters
- **P-cross union (0.96)** beats single **claude (+0.06)** and **gemini (+0.09)** by covering
  their backend-specific blind spots — but only **ties the best single (codex, 0.96)**, because
  the residual misses are the universal blind spot.
- **Diversity > redundancy:** P-cross union (0.96) > P-same/3×claude union (0.92): adding diverse
  backends recovers more than adding more claudes (which share claude's atomicity blind spot).
- **Union vs consensus is a precision/recall lever:** union maximizes recall but inflates false
  positives (P-cross union FP-basis 2.25–3.1 vs codex single 0.0); consensus (≥2) cuts FP to
  ~0.7 but *drops recall back to 0.92* — because it discards exactly the single-backend rescues
  that make a cross-backend panel worth running. **Consensus is the wrong aggregation for this
  task.**

## Pre-registered decision rules (stated plainly, even where null)
- **"Panel beats single by ≥ +0.15 recall at ≤ +0.10 FP":** NOT met. P-cross union (0.96) only
  ties the best single (codex 0.96); it beats the *average* single but not the best, and it
  costs FP. ❌
- **"Diversity matters: P-cross − P-same ≥ +0.10 recall":** NOT met at threshold (+0.04), though
  directionally real and mechanistically explained (codex covers claude's atomicity blind spot). ◑
- **"#12 ranking transfers":** NO — it reverses (codex-first for drift vs claude-first for bugs). ❌

## Recommendation for `/sanity`
1. **Keep the single-reviewer default, and keep it codex.** Codex was the best *and* most precise
   single reviewer for doc↔code drift (0.96 recall, 0 false positives on the hard behavioral
   round). `/sanity`'s existing single-codex default is **validated** by this experiment — and the
   intuition to switch it to claude (from #12) would have been **wrong** for this task.
2. **A cross-backend panel is insurance, not an upgrade.** Use P-cross **union** only when you
   cannot guarantee the strong backend or the cost of a missed drift is high (it lifts claude/
   gemini up to codex-level by covering their blind spots), and accept the false-positive cost.
   Do **not** use consensus aggregation here — it discards the cross-backend rescues.
3. **Reviewers (any config) under-detect "absence" drifts** (a removed guard/check). Pair
   `/sanity` with executable checks/tests for the high-stakes invariants (atomicity, guard
   presence, balance/security properties) — those are the drifts no reviewer panel will catch.

## Honest caveats
- **n is modest** for codex/gemini (4 hard-round reports each; claude 12). Codex's 0.96/0-FP was
  *consistent across all 4* (not an outlier), and claude's atomicity blind spot was *6/6*, so the
  directional findings are solid, but exact deltas (±0.04) are within sampling noise.
- **The generated "coherent" bases carried a few real gaps** the reviewers correctly surfaced
  (e.g. ledger's `transfer.failed` audit action defined but never emitted; `FEE_BPS` living in
  `transfers.ts` though docs call `config.ts` the single source of truth). The judge scored these
  as `real_unplanted`, not false positives — evidence the reviewers and judge are doing real work,
  but it means the FP column is noisy and the base wasn't a perfect ON-TRACK control.
- **Single LLM judge** (blinded). A codex spot-check of a sample remains a possible robustness add.
- Easy-round FP is dominated by pulse-dashboard's skeleton-wiring gaps (see the interim section in
  git history), not a backend effect.

---

## Data appendix — full per-condition tables


## Round: easy   (reports=20, cells=4)
### Single-backend (mean over individual reviews)
| cond | n | recall | subtle | moderate | obvious | FP/rep | unplanted/rep | verdict |
|---|---|---|---|---|---|---|---|---|
| S-claude | 12 | 1.00 | 1.00 | 1.00 | 1.00 | 0.75 | 1.42 | 1.00 |
| S-codex | 4 | 1.00 | 1.00 | 1.00 | 1.00 | 1.75 | 0.50 | 1.00 |
| S-gemini | 4 | 1.00 | 1.00 | 1.00 | 1.00 | 2.00 | 0.00 | 1.00 |

### Panels (per-cell aggregation)
| panel | aggregation | recall | subtle-recall | FP basis |
|---|---|---|---|---|
| P-same (3x claude) | union (any) | 1.00 | 1.00 | 2.25 |
| P-same (3x claude) | consensus (>=2) | 1.00 | 1.00 | 0.75 |
| P-cross (cl+cx+gm) | union (any) | 1.00 | 1.00 | 4.00 |
| P-cross (cl+cx+gm) | consensus (>=2) | 1.00 | 1.00 | 1.33 |

## Round: hard   (reports=20, cells=4)
### Single-backend (mean over individual reviews)
| cond | n | recall | subtle | moderate | obvious | FP/rep | unplanted/rep | verdict |
|---|---|---|---|---|---|---|---|---|
| S-claude | 12 | 0.90 | 0.83 | 1.00 | 1.00 | 0.67 | 1.08 | 1.00 |
| S-codex | 4 | 0.96 | 0.94 | 1.00 | 1.00 | 0.00 | 0.25 | 1.00 |
| S-gemini | 4 | 0.87 | 0.78 | 1.00 | 1.00 | 1.00 | 0.25 | 1.00 |

### Panels (per-cell aggregation)
| panel | aggregation | recall | subtle-recall | FP basis |
|---|---|---|---|---|
| P-same (3x claude) | union (any) | 0.92 | 0.88 | 2.00 |
| P-same (3x claude) | consensus (>=2) | 0.88 | 0.81 | 0.67 |
| P-cross (cl+cx+gm) | union (any) | 0.96 | 0.94 | 2.25 |
| P-cross (cl+cx+gm) | consensus (>=2) | 0.92 | 0.88 | 0.75 |

## Round: ALL   (reports=40, cells=8)
### Single-backend (mean over individual reviews)
| cond | n | recall | subtle | moderate | obvious | FP/rep | unplanted/rep | verdict |
|---|---|---|---|---|---|---|---|---|
| S-claude | 24 | 0.95 | 0.89 | 1.00 | 1.00 | 0.71 | 1.25 | 1.00 |
| S-codex | 8 | 0.98 | 0.96 | 1.00 | 1.00 | 0.88 | 0.38 | 1.00 |
| S-gemini | 8 | 0.93 | 0.85 | 1.00 | 1.00 | 1.50 | 0.12 | 1.00 |

### Panels (per-cell aggregation)
| panel | aggregation | recall | subtle-recall | FP basis |
|---|---|---|---|---|
| P-same (3x claude) | union (any) | 0.96 | 0.92 | 2.12 |
| P-same (3x claude) | consensus (>=2) | 0.94 | 0.88 | 0.71 |
| P-cross (cl+cx+gm) | union (any) | 0.98 | 0.96 | 3.12 |
| P-cross (cl+cx+gm) | consensus (>=2) | 0.96 | 0.92 | 1.04 |

## Per-report — HARD round
| bid | project | rep | cond | recall | caught | partial | FP | unpl | verdict |
|---|---|---|---|---|---|---|---|---|---|
| R009 | ingestd | 1 | claude1 | 0.85 | 11 | 0 | 2 | 0 | SIGNIFICANT DRIFT |
| R017 | ingestd | 1 | claude2 | 0.85 | 11 | 0 | 2 | 0 | SIGNIFICANT DRIFT |
| R030 | ingestd | 1 | claude3 | 0.85 | 11 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R028 | ingestd | 1 | codex1 | 0.92 | 12 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R007 | ingestd | 1 | gemini1 | 0.77 | 10 | 0 | 0 | 1 | SIGNIFICANT DRIFT |
| R035 | ingestd | 2 | claude1 | 0.85 | 11 | 0 | 3 | 0 | SIGNIFICANT DRIFT |
| R019 | ingestd | 2 | claude2 | 0.85 | 11 | 0 | 0 | 3 | SIGNIFICANT DRIFT |
| R002 | ingestd | 2 | claude3 | 0.85 | 11 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R020 | ingestd | 2 | codex1 | 0.92 | 12 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R036 | ingestd | 2 | gemini1 | 0.92 | 12 | 0 | 1 | 0 | SIGNIFICANT DRIFT |
| R018 | ledger-api | 1 | claude1 | 1.00 | 13 | 0 | 0 | 2 | SIGNIFICANT DRIFT |
| R012 | ledger-api | 1 | claude2 | 0.92 | 12 | 0 | 0 | 2 | SIGNIFICANT DRIFT |
| R005 | ledger-api | 1 | claude3 | 0.92 | 12 | 0 | 1 | 2 | SIGNIFICANT DRIFT |
| R013 | ledger-api | 1 | codex1 | 1.00 | 13 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R032 | ledger-api | 1 | gemini1 | 0.92 | 12 | 0 | 3 | 0 | SIGNIFICANT DRIFT |
| R001 | ledger-api | 2 | claude1 | 0.92 | 12 | 0 | 0 | 3 | SIGNIFICANT DRIFT |
| R003 | ledger-api | 2 | claude2 | 1.00 | 13 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
| R022 | ledger-api | 2 | claude3 | 0.92 | 12 | 0 | 0 | 1 | SIGNIFICANT DRIFT |
| R039 | ledger-api | 2 | codex1 | 1.00 | 13 | 0 | 0 | 1 | SIGNIFICANT DRIFT |
| R021 | ledger-api | 2 | gemini1 | 0.85 | 11 | 0 | 0 | 0 | SIGNIFICANT DRIFT |
