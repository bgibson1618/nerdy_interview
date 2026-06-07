# Roster Experiment Log

Each study build doubles as an experiment against the `agent_roster` plugin. This log
captures what we ran, what we were probing, and what we learned. Newest first.

## Format
`#N — title` · date · **probe:** what roster behavior · **setup:** agents/backends/modes ·
**result:** outcome + finding · **action:** plugin change, if any.

---

## #6 — Orchestrator /compact resilience (2026-06-06)
- **Probe:** can the orchestrator survive a context `/compact` and resume seamlessly from a handoff brief?
- **Setup:** at ~80% context, wrote `CONTEXT.md` (resume brief) + the `dual-purpose-study-roster-repo` memory; then the user ran `/compact`.
- **Result:** **clean resume, no drift.** Post-compact orchestrator, without re-asking, (a) stayed in orchestrator mode and confirmed window 0 still named `Orchestrator`, (b) recalled Phases 0–2b shipped without redoing them, (c) knew Phase 3 + the PR-remote gate were next. The auto-`/compact` summary carried the high-level facts (orchestrator mode, phase ledger, the gate); `CONTEXT.md` was the durable on-disk anchor that **agreed with** the summary on resume — belt-and-suspenders worked. **One thing neither artifact predicted:** the user had added a git remote (`origin` → `nerdy_interview`) during the compact, so live `git`/`tmux` state still had to be re-read on resume — files + summary anchor *intent*, but never substitute for re-observing the world.
- **Action:** none for the plugin. Procedural confirmation: a `CONTEXT.md`-style brief + memory is a reliable orchestrator handoff across `/compact`.

## #5 — Interactive-surface test (2026-06-06)
- **Probe:** does the `--interactive` surface work across backends — spawn → input → response → transcript → teardown? (Previously untested.)
- **Setup:** 3 interactive `researcher` agents (codex / gemini / claude), driven by `tmux send-keys` (and, incidentally, live human typing into the claude one).
- **Result:** **all three work.** Each TUI launched, processed the initial prompt (printed `READY-INTERACTIVE`), accepted input from *both* `send-keys` and a human at the keyboard, and answered correctly (`4`; claude also answered a human-typed `10×5 = 50`). **But durable output is weak:** interactive runs leave `output.md` **empty** (codex, claude) because the interactive code paths don't use `--output-last-message`/`tee`, so the clobber-fix `last_message.md` fallback never fires; only gemini wrote `output.md`, incidentally, via auto-accept-edits. The only transcript is `terminal.log` (raw pane bytes), polluted by TUI redraws: codex ~128 KB (cleanest — `--no-alt-screen`), claude ~54 KB, **gemini ~288 KB of mostly ANSI noise.**
- **Action / open:** interactive mode has **no clean durable transcript**. If interactive runs should be observable, the adapter needs an ANSI-stripped or structured transcript (codex's `--no-alt-screen` is the most capture-friendly model; gemini's TUI the least). `send-keys` is a viable programmatic driver. Answers the "interactive surface untested" open question.

## #4 — Gotcha-exercise backend bake-off (2026-06-06)
- **Probe:** head-to-head code-example *quality*, codex vs gemini vs claude, on identical tasks (only the backend varies).
- **Setup:** 3 categories (JS / TS / React gotchas) × 3 backends = 9 `implementer` agents, same role + task, writable.
- **Result:** all 9 completed. Quality ranking **consistent across all three categories: claude > codex > gemini.** claude produced the most review-realistic, memorable bugs (a truthy `Promise` that deletes every session; a `timout` typo illustrating "`any` is contagious") with thoughtful framing/intros. codex was a strong, more *granular* second (18 JS exercises vs claude's 16). gemini was accurate but textbook-generic. Counts JS/TS/React: codex 18/6/8, gemini 8/6/8, claude 16/6/8.
- **Action:** shipped claude's best-of as `study/exercises/js-ts-react-gotchas.md`. Backend guidance: prefer **claude** for code-with-pedagogical-framing, **codex** for volume/granularity, **gemini** lags on this task type.

## #3 — Codex research pipeline, clean e2e (2026-06-06)
- **Probe:** does codex work end-to-end (research → verify → synthesize) once the output-capture bug is fixed?
- **Setup:** 5 codex researchers (topic sizes 1/1/1/2/4) + 1 gemini control; codex verifier (read-only); codex synthesizer.
- **Result:** all 8 codex agents completed at every stage; `output.md` clean. The team-04hr "flake" tracks input *complexity*, not read-only mode (the small read-only review here completed fine).
- **Action:** none — validated the fix from #2.

## #2 — Codex research experiment + adapter review (2026-06-06)
- **Probe:** does codex flake as task size grows? (hypothesis: yes)
- **Setup:** 5 codex researchers across topic-count gradient + 1 gemini control, all writing `output.md`.
- **Result:** **hypothesis refuted** — every codex agent completed with good content at all sizes. The "tiny output" was an **adapter bug**: `codex exec --output-last-message "$OUTPUT_FILE"` overwrote the agent's own `output.md` with its terse final message (recoverable only from `terminal.log`). The **gemini control was decisive** — without it the clobbered codex output read as "codex is broken."
- **Action:** routed every backend's capture to a separate `last_message.md` with a fallback into `output.md` (`dca7924`). Also drove the adapter-review fixes: README clobber, stale docstring, SIGPIPE hardening (`d98f7fc`) and `resolve_bin` bashrc hardening (`d068826`).

## #1 — Adapter self-review (2026-06-06)
- **Probe:** orchestrator-driven review; codex verifier reliability on a large read-only task.
- **Setup:** 2 codex researchers + 1 codex verifier reviewing 4 large adapter scripts.
- **Result:** researchers found real bugs (cross-validated); **codex verifier declined** the big review ("can't complete in this turn"). A follow-up claude verifier completed the gate.
- **Action:** confirmed-bug fixes above; open question — codex's genuine decline threshold on large open-ended inputs.

---

## Open questions
- Codex's real decline threshold on large/open-ended inputs (the one genuine reliability limit found).
- ~~Interactive surface untested~~ → characterized in #5: works across backends, but interactive runs have **no clean durable transcript** (`terminal.log` is raw TUI bytes; gemini worst). Open: ANSI-strip / structured transcript if interactive observability matters; wire the `last_message.md` capture into interactive paths.
- Backend quality head-to-head (codex vs gemini vs claude) on identical generation tasks.
