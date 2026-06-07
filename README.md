# agent-roster-observe-smoke

A dual-purpose working repo:

1. **Study material** — interview-prep content (currently a code-review interview for **Nerdy / Varsity Tutors**). Real, usable deliverables.
2. **Agent-roster testbed** — every study build doubles as a live experiment against the [`agent_roster`](/home/bgibs/projects/agent_roster) plugin (the observable tmux multi-agent system). Study material is low-stakes, so we experiment freely — bold compositions, deliberate stress tests, edge cases.

## Layout

| Path | What |
|---|---|
| `NERDY_STUDY_PLAN.md` | The weekend code-review study plan (primary deliverable). |
| `NERDY_STACK.md` | Authoritative Nerdy tech stack (source of truth for stack references). |
| `study/drills/` | Standalone code-review drills — planted-bug exercises + PR-candidate code. |
| `study/exercises/` | Targeted exercises (e.g. JS/TS gotchas). |
| `EXPERIMENTS.md` | Running log of roster experiments + findings. |
| `work/` | Agent run dirs (gitignored, ephemeral). |

## How we work here

The user states an **end state**; the orchestrator (primary CLI agent) designs a phased
build plan where each phase produces a study artifact **and** probes a roster behavior,
with instrumentation logged to `EXPERIMENTS.md`. Deliverables are reviewed before they're
integrated into the real docs.
