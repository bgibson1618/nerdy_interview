# Implementation brief: optional cross-backend "union panel" for the `/sanity` skill

**Audience:** the Codex agent that maintains/syncs skills.
**File to change:** `~/.claude/skills/sanity/SKILL.md` (the skill is a prompt/procedure doc, not code).
**Type of change:** additive. Do **not** change the default single-reviewer behavior.

---

## 1. Why (evidence, so the design isn't arbitrary)

We ran a ground-truthed, blinded, pre-registered experiment (40 reviews across 4 synthetic
projects with injected doc↔code drift; results: `agent-roster-observe-smoke/experiments/
drift_detection_results.md`, EXPERIMENTS #20). Findings that drive this design:

- **The current single-codex reviewer is the right default.** On hard behavioral drift, codex had
  the **highest recall (0.96) and the lowest false-positive rate (0 FP/report)** of the three
  backends — better than claude (0.90) and gemini (0.87). The naive guess (switch to claude, per
  the older bug-finding result #12) would have been **wrong** for drift detection. Keep codex.
- **A panel's value is recall *insurance*, via backend-diverse blind spots.** Backends miss
  *different* things: claude systematically missed an atomicity drift (a removed DB-transaction
  wrapper) in 0/6 reviews; codex caught it 2/2. A **union** of claude+codex+gemini reached 0.96 —
  it lifts a weaker backend up to codex-level by covering its blind spots.
- **Use UNION, never consensus.** Requiring ≥2 backends to agree (consensus) cut false positives
  but *also dropped recall back down* — it discards exactly the single-backend rescues that justify
  running a panel. The whole point is to surface a finding even if only one backend saw it.
- **No reviewer config catches "absence" drifts.** A *removed* guard/check (e.g. a deleted
  `if (isSymlink) continue`) was caught by **0/10** reviewers — there's no positive code trace to
  notice. The panel cannot fix this; the skill should say so and point at executable checks.

**Net:** default stays single-codex; add an *opt-in* union panel for high-stakes reviews.

## 2. Scope

- **ADD** an opt-in panel mode, triggered by the user invoking `/sanity panel` (or `/sanity --panel`).
- **KEEP** the default (`/sanity` with no arg) exactly as today: one fresh-eyes codex reviewer via
  `agent_roster`, claude `general-purpose` fallback when the roster isn't installed.
- **DO NOT** change the fresh-eyes prompt template, the 5-section report contract, or the
  pain-points retrospective step. The panel reuses the existing reviewer prompt verbatim.

## 3. Behavior of panel mode

When the user runs `/sanity panel` AND `agent_roster` is installed (same install check the skill
already uses), spawn **three** fresh-eyes reviewers in parallel — one per backend — each with the
**existing** reviewer prompt and the project workspace, then **union** their findings.

If `agent_roster` is NOT installed, panel mode degrades to the current single Claude
`general-purpose` reviewer and says so (no panel without the roster).

### Launch (concrete `agent_roster` commands)

Write the existing fresh-eyes prompt to a temp file once, then launch all three (they run
concurrently in tmux and return immediately):

```bash
ROSTER=/home/bgibs/projects/agent_roster/bin/agent-roster   # or `agent-roster` on PATH
PROMPT=<the temp prompt file>

"$ROSTER" run reviewer --backend codex  --codex-sandbox read-only \
    --workspace "$PWD" --run-id sanity-codex  --task-file "$PROMPT"
"$ROSTER" run reviewer --backend claude --claude-permission-mode default \
    --workspace "$PWD" --run-id sanity-claude --task-file "$PROMPT"
"$ROSTER" run reviewer --backend gemini --model gemini-3-flash-preview --gemini-approval-mode yolo \
    --workspace "$PWD" --run-id sanity-gemini --task-file "$PROMPT"
```

- **Gemini model matters:** the gemini CLI's *default* (pro) model has a small per-model free-tier
  quota that exhausts after one or two calls (error: "exhausted your capacity on this model").
  Pass `--model gemini-3-flash-preview` (large per-model headroom; validated in the experiment).
  Run gemini serially / with one retry on a 429 if you ever batch many.
- **Codex `read-only` cannot write `output.md`.** That's fine — the roster captures the terminal
  output as a fallback. Harvest `output.md` if non-empty, else fall back to `terminal.log`. (If you
  prefer guaranteed `output.md`, use `--codex-sandbox workspace-write`; the reviewer is instructed
  to write only its run dir, but `read-only` is safer for a review of the user's real project.)

### Collect

Wait for all three with `agent-roster status --workspace "$PWD" <run-id>` until each reaches a
terminal status (`done`/`failed`), then read each reviewer's
`work/agents/<run-id>/<role>/output.md` (role label is `verifier`).

### Aggregate = UNION (this is the load-bearing part)

- Pool every distinct finding from all three reports.
- **Deduplicate** near-identical findings (same file + same claim) into one entry.
- For each merged finding, record **which backends flagged it** and show that count, e.g.
  `[codex, claude]` or `[gemini only]`.
- **Do not drop a finding just because only one backend raised it** — that single-backend rescue is
  the panel's entire value. Instead, sort/group so the user can triage by agreement:
  - **High confidence** — flagged by all 3 (or ≥2).
  - **Worth checking** — flagged by 1 (could be a real blind-spot rescue OR a false positive; a
    union panel raises false positives, so 1-of-3 findings need human judgment).
- Present the merged findings grouped under the **existing 5 report sections** (Source Brief→Arch,
  Arch→Plan, Status→Code, AI-First proof, Verdict). For the **Verdict**, take the most severe of the
  three (ON TRACK < MINOR DRIFT < SIGNIFICANT DRIFT).
- Name the path used per backend, as the skill already does (e.g. "panel: codex + claude +
  gemini-3-flash-preview reviewers").

## 4. Required caveat in the output

Panel mode must print a short note: *"A reviewer panel raises recall but also false positives, and
no reviewer configuration reliably catches **absence** drifts — a removed guard, check, or
transaction wrapper leaves no positive code trace. For high-stakes invariants (atomicity, auth
scopes, money/balance, rate-limit keying) pair this review with executable tests, not just more
reviewers."*

## 5. Acceptance criteria

1. `/sanity` (no arg) behaves exactly as before — one codex reviewer, claude fallback. Unchanged.
2. `/sanity panel` with the roster installed launches codex + claude + gemini reviewers
   concurrently, harvests all three, and prints UNION findings annotated with the flagging-backend
   set, grouped by the 5 sections, with a most-severe verdict.
3. `/sanity panel` without the roster installed falls back to the single Claude reviewer and says
   so.
4. Gemini is invoked with `--model gemini-3-flash-preview`.
5. Codex-`read-only` `output.md`-empty case falls back to the terminal log without erroring.
6. The absence-drift caveat (§4) is shown in panel mode.
7. No change to the reviewer prompt template, the 5-section contract, or the pain-points step.

## 6. Out of scope / explicitly not wanted

- **No consensus/voting filter** that hides single-backend findings (it measurably hurt recall).
- **No change** to the default backend (codex stays the single-reviewer default).
- No new dependencies; reuse `agent_roster` exactly as the skill already does.
