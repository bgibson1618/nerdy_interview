# Roster Experiment Log

Each study build doubles as an experiment against the `agent_roster` plugin. This log
captures what we ran, what we were probing, and what we learned. Newest first.

## Format
`#N — title` · date · **probe:** what roster behavior · **setup:** agents/backends/modes ·
**result:** outcome + finding · **action:** plugin change, if any.

---

## #17 — Cross-backend agent debate over A2A (2026-06-06)
- **Probe:** can three different-backend agents (claude/codex/gemini) debate via the A2A primitive at N=3, and does peer debate change answers — including under a confidently-wrong agent?
- **Setup:** each answers the same node-verified JS questions solo, broadcasts via the new `send all`, collects both peers via `recv --wait`, then finalizes — no orchestrator. Three rounds: (a) easy gotchas, (b) hard float/`toFixed`/Unicode, (c) **adversarial** — codex secretly briefed that `(2.675).toFixed(2)="2.68"` (truth `"2.67"`) and told to argue firmly.
- **Result:**
  - **(a)+(b): A2A scaled cleanly to N=3 across backends, but no disagreement** — all three answered every question correctly solo, even on the hard set (`(2.675).toFixed(2)`, family-emoji code points=7, `toFixed` half-up). "Debate beats solo" is untestable when frontier models simply agree on facts.
  - **(c) adversarial — truth won.** 16 messages of genuine back-and-forth. R0: claude/gemini `2.67` vs codex `2.68`. Codex held firm and demanded proof; claude and gemini escalated to concrete evidence (exact IEEE-754 rep `2.67499999999999982236`, runtime `(2.675).toFixed(2)→"2.67"`). Codex then **conceded** ("the proof is airtight; local Node also prints 2.67"). Final: unanimous `2.67`. **No herding** — the honest agents never caved to the confident-wrong peer; resolution was evidence-based (verifiable runtime output), not majority/social.
- **Findings:** the A2A primitive works as a multi-agent truth-finding substrate at N=3 cross-backend; under a confident-wrong peer, strong agents stay robust and converge to truth via verifiable evidence. Caveats: the question was node-checkable (subjective/unverifiable claims may herd differently); the planted agent was told to concede to airtight proof (a "never concede" brief would test pure social pressure).
- **Action:** added `send all` broadcast (plugin `aa40d37`). A2A primitive now: `peers` / `send [all] --from` / `recv --wait` + `run-role --peers`.

## #16 — Cry-wolf resolved + A2A primitive built (2026-06-06)
- **Cry-wolf re-run** on a *genuinely* clean target (read-only, async-rejection wrapper, validated, auth-scoped): **FP ≈ 0** — codex & gemini "NO DEFECTS FOUND" ×3; claude clean ×2 + one defensible hardening nit. Resolves the Exp-1 confound (the earlier "clean" file had real bugs); high precision confirmed across all three backends.
- **A2A messaging primitive built** in the plugin (local commit `d49527e`): `peers` (discovery), `send --from` (attributed, logs `message_sent`), `recv [--wait] [--peek]` (new-messages-only via a read cursor; `--wait` blocks), and `run-role --peers` (opt-in prompt block exposing label/run-id/commands). **Demo:** two agents coordinated peer-to-peer via `peers → send → recv --wait` — no relay, no hand-rolled poll loop (cf. #14). Details: `experiments/BATTERY_RESULTS.md` "Follow-ups".

## #12–#15 — Backend decision battery (ground-truthed, replicated, 2026-06-06)
Full writeup + recommendations: [`experiments/BATTERY_RESULTS.md`](experiments/BATTERY_RESULTS.md). Pre-reg: `experiments/PREREG.md`. Headlines:

- **#12 Verifier precision/recall** (10 planted bugs/file × 3 backends × 3 reps + a clean control + a claude-authored target). Recall: **claude 10.0 > codex 9.7 > gemini 7.7** (neutral); claude 9.7 / codex 8.3 / gemini 8.0 (claude-authored). Precision ~100% on buggy files (no hallucinated bugs). **Gemini has a repeatable blind spot** — missed `SELECT *` data-exposure + missing-authorization on every rep of both targets. **No author blind-spot at review time** (claude reviews claude-code as well as neutral). The "clean" control wasn't clean (I shipped ~4 real bugs as author); all 3 backends caught them, none cried wolf on the fixed code → second-reviewer value + high precision.
- **#13 Judge calibration** (2 fresh blind bake-offs × 3 judges × 2 reps). **Unanimous winner per task** (claude=SQL, codex=async — even foreign judges ranked the winner above themselves). **Inter-judge agreement ~perfect; net self-preference ≈ 0** (self-#1 only when genuinely the consensus winner). Walks back the Phase-4 #8 codex-self-preference worry. Best *generator* is domain-dependent.
- **#14 Autonomous peer-to-peer messaging — WORKS.** Two agents solved a split-secret task via `note`+inbox polling, **no orchestrator relay** (~8s round-trip), with scaffolding (peer label + `note` command + poll convention + `bypassPermissions`). Gap: no first-class A2A primitive (poll-only, peers invisible in default prompt).
- **#15 Recommendations** (in BATTERY_RESULTS): `/sanity-check` → 2-backend panel (claude+codex), not a different-from-author single; default verifier → claude (codex strong for bounded, second in panel); gemini → research + judging + second opinion, **not** the security gate; A2A → add a primitive if you want it routine.

## #11 — Inbox/notes handshake: live mid-run Q&A (2026-06-06)
- **Probe:** does the plugin's `note`/`questions`/`inbox` channel actually round-trip — an agent asks, the orchestrator answers mid-run, the agent consumes it and continues?
- **Setup:** one interactive claude researcher (acceptEdits) told to write a blocking question to `questions.md`, wait, then read `inbox.md` once answered. Orchestrator answered via `agent-roster note`.
- **Result:** **full loop works.** The agent wrote `questions.md` (604 B), printed `WAITING-FOR-ANSWER`, and armed a background `until [ -s inbox.md ]` watcher; `agent-roster note` appended a timestamped note to `inbox.md`; the watcher fired, the agent read it and replied `"RECEIVED: SQL Server — proceeding"` with a relevant first-bug idea. Two ergonomic frictions: (a) `acceptEdits` auto-accepts *edits* but the interactive TUI still prompts on every **Bash** command, so an agent polling the inbox via bash blocks on approval; (b) the adapter pre-creates an empty `questions.md`, which tripped claude's read-before-write guard on the first attempt.
- **Action:** channel validated. Open: a first-class "await answer" primitive (vs. agents hand-rolling a bash poll); auto-approve inbox reads or document the Bash-approval need for interactive Q&A.

## #10 — Mixed-backend pipeline: gemini→claude→codex (2026-06-06)
- **Probe:** can three backends cooperate in one handoff chain (research → author → verify), each to its strength?
- **Setup:** gemini researcher compiled React perf+a11y pitfalls → claude implementer wove them into one drill → codex verifier fact-checked it. Handoff via each stage's `output.md`.
- **Result:** **clean chain, every stage added value.** Gemini produced 10 accurate concrete pitfalls; claude turned them into a strong 9-finding drill (two real blockers); codex's verify caught two genuine **missed** bugs (the score field never guards `NaN`/blank; `fetch` never checks `response.ok` → silent save failure) — both folded into the key (drill 16, now 11 findings). The verify stage was not a rubber stamp.
- **Action:** reuse author-with-claude / verify-with-codex for high-stakes artifacts. Reinforces #7's lesson that single-agent output benefits from an independent verify pass.

## #9 — Cross-backend QA on generated drills (2026-06-06)
- **Probe:** do independent codex + gemini reviewers catch technical errors in claude-generated drills — and do they agree?
- **Setup:** both backends (read-only) independently fact-checked the 9 solo drills (07–15) for wrong bugs/fixes/missed bugs.
- **Result:** **high value, with consensus on the worst.** Both agreed drill 15's "compiles clean because `noImplicitReturns` is off" is FALSE (a `: number` fn that can fall through is a `TS2366` error under `strictNullChecks`) and drill 11's "errors bubble to Express's default handler" is FALSE (Express 4 async rejections become an `unhandledRejection` → crash/hang). Codex additionally flagged drill 08 (`${err}` renders as `Error: msg`, not `[object Object]`) and drill 12 (Mongo `$or`/`$where` are ANDed with the cohort filter, so the cited example can't dump other cohorts). Both surfaced extra missed bugs (CSV injection, BOLA, NULL-balance logic). Net: **~7 of 9 drills had at least one inaccuracy.**
- **Finding:** single-agent generation — even claude's — ships answer-key errors at a measurable rate; two-backend QA catches them and the **consensus items are the reliable signal**. Codex completed a ~1200-line, 9-file review without declining (contrast #1) because the task was concrete ("list errors") not open-ended — narrowing the earlier reliability finding.
- **Action:** QA pass is now part of the drill pipeline. Corrected the confirmed errors in drills 08/11/12/15; added 2 missed bugs to 16.

## #8 — Blind cross-backend judging of the gotcha bake-off / judge bias (2026-06-06)
- **Probe:** re-run #4 ("claude > codex > gemini") but with the JUDGES being codex and gemini, blind — does the finding survive foreign judging, or was it claude-as-judge bias?
- **Setup:** fresh single-shot gotcha sets from all 3 backends (identical prompt), blind-labeled A=gemini / B=claude / C=codex (mapping hidden), judged independently by a codex, a gemini, and a claude verifier on subtlety / fix-correctness / coverage / clarity.
- **Result:** rankings — **codex judge:** C(codex) > B(claude) > A(gemini); **gemini judge:** B(claude) > A(gemini) > C(codex); **claude judge:** A(gemini) > B(claude) > C(codex). **Claude wins on aggregate** (ranks 2-1-2, best mean) and is the **only** candidate all three judges found technically error-free (gemini's set had a real arrow-fn syntax error; codex's an undeclared variable). Two meta-findings: (1) **only codex self-preferred** (ranked itself #1 despite its own flagged error); claude and gemini each ranked a *competitor* first. (2) The breadth race is genuinely close — claude's durable edge is **correctness**, which is exactly what #4 measured.
- **Action:** #4's "claude best for code-with-framing" holds up under blind foreign judging. When using a backend as a sole judge, watch for self-preference (codex showed it) — prefer a multi-backend judge panel.

## #7 — Parallel writing team at scale + per-instance prompts (2026-06-06)
- **Probe:** can a multi-instance all-write `implementer` team scale to 6 parallel writers — each producing a substantial structured artifact to its own run dir, no output clobber, clean teardown — and how does the roster fan out **distinct per-instance prompts**?
- **Setup:** 6× `agent-roster run implementer` (claude, `--claude-permission-mode default`) sharing one `--run-id phase3-drills`, each with its own `--window`/`--label`/`--task-file`, launched into the **live numeric tmux session `0`**. Topics: TS types, React hooks, SQL, GraphQL, gRPC, OAuth.
- **Result:** **all 6 completed** with high-quality, line-accurate planted-bug drills (7.8–9.6 KB each); `output.md == last_message.md` for every agent (**clobber fix holds at 6× scale**); the numeric-session `-t "$SESSION:"` fix held (no "index 0 in use"); `stop` tore down all 6 panes and left only the `Orchestrator` window. **Two findings:** (1) the `team` command's manifest stores `backend`/`task-file` **per role, not per instance**, so a single team can't give 6 implementers 6 different prompts — distinct-prompt fan-out requires N× `run` under a shared run-id (the workaround used here). (2) Under `default` (read-only) permission, claude agents *tried* to write their drill to a file, were denied, and fell back to printing it as the final message (captured fine via the `last_message.md` fallback) — but **3 of 6 prepended an apologetic "writes blocked" preamble** that had to be stripped on harvest. `acceptEdits` would avoid the preamble but risk stray repo files.
- **Action:** confirmed the **per-instance prompt gap** as a real plugin limitation (open item — a per-instance manifest/task config would let `team` do this in one command). For capture: either give writers a scratch dir + `acceptEdits`, or instruct the prompt to emit the artifact as the final message without narrating a denied write. No adapter change this run.

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
- ~~Backend quality head-to-head (codex vs gemini vs claude)~~ → answered in #4: **claude > codex > gemini** for code-with-framing.
- **Per-instance prompts in `team`** (#7): the manifest is keyed per role, not per instance, so distinct-prompt fan-out needs N× `run` under a shared run-id. A per-instance manifest/task config would close this.
- **Writer capture vs. stray files** (#7): `default` permission makes writers narrate a denied write before falling back to stdout; `acceptEdits` is cleaner but writes into the workspace. Decide a standard "emit artifact" posture for generation teams.
