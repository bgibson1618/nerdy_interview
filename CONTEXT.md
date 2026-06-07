# CONTEXT — orchestrator resume brief

**Read this first on resume (especially after a `/compact`).** Files persist; conversation
detail may not. This is the continuity record for the `agent-roster-observe-smoke` repo —
a dual-purpose space: real study material **+** a live testbed for the `agent_roster` plugin.

## Active mode
- The primary CLI agent is operating **as the orchestrator persona** (loaded from
  `/home/bgibs/projects/agent_roster/personas/orchestrator/`) and stays in that role until
  the user says "revert".
- tmux **window 0 is renamed `Orchestrator`** as a visual flag (auto-rename + allow-rename
  off). On revert: `tmux rename-window -t 0:0 claude` (and re-enable auto-rename if desired).
- Working arrangement (also in memory `dual-purpose-study-roster-repo`): user states an **end
  state** → orchestrator designs a **phased plan** where each phase ships a study artifact AND
  probes a roster behavior → instrument findings to `EXPERIMENTS.md` → **review deliverables
  before integrating into `NERDY_STUDY_PLAN.md`**. User has licensed deliberately
  inefficient / over-engineered experiment designs for robustness.

## LIVE tmux state
- Window 0 `Orchestrator` = this CLI session. **No other live agent windows** — the Phase 2b
  interactive agents have all been torn down.

## Build progress (user's current end state)
- [x] **Phase 0** — scaffolding: `README.md`, `EXPERIMENTS.md`, `study/{drills,exercises}/`.
- [x] **Phase 1** — JS/TS/React gotcha exercises → `study/exercises/js-ts-react-gotchas.md`
      (30 exercises), linked from the plan's gotchas section. Backend bake-off finding:
      **claude > codex > gemini** for code-with-framing (EXPERIMENTS #4).
- [x] **Phase 2a** — stack interviewer Q&A + deep GraphQL/gRPC primers →
      `study/exercises/stack-interview-qa.md`, linked from the plan's tech-stack section.
- [x] **Phase 2b** — interactive-surface test (EXPERIMENTS #5): works on all 3 backends, but
      interactive runs have **no clean durable transcript**.
- [ ] **Phase 3 — NEXT:** more planted-bug drills into `study/drills/` (model on "Drill #1" in
      `NERDY_STUDY_PLAN.md`), PLUS buggy **PR-candidate branches** for GitHub-UI review.
      **PR workflow decided:** user adds a git remote (none yet; `gh` is authed as
      `bgibson1618`) → THEN orchestrator pushes branches + opens the PRs. Generate branch code
      locally now; gate PR-opening on the remote existing.

## Key references
- Study: `NERDY_STUDY_PLAN.md` (main plan), `NERDY_STACK.md` (authoritative stack — overrides
  web guesses; it's TS/JS, React, MySQL, SQL Server, OAuth, REST, Webhooks, gRPC, GraphQL),
  `study/exercises/*`.
- Roster findings + open questions: `EXPERIMENTS.md`.
- Plugin: `/home/bgibs/projects/agent_roster` (CLI: `bin/agent-roster`; adapters under
  `adapters/tmux/`). Many fixes committed this session — see its `git log`. Open plugin items:
  interactive durable-transcript gap (#5); consider defaulting `verifier`→claude (codex
  declines large open-ended reviews); per-instance manifest config (review finding #2).

## Resume action
Confirm orchestrator mode is intact and window 0 is still named `Orchestrator`, then re-read
live `git`/`tmux` state (it can change during a compact) before continuing with Phase 3 or
whatever the user directs next.
