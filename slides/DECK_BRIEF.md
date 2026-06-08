# Deck brief — "Composing a reliable multi-agent system"

**Audience:** an engineer. **Tone:** technical, concise, data-forward, no fluff. Every claim
carries its evidence (a number, a ratio, an experiment #). This is an *experiment log*, not a
product pitch — it should read like a sharp internal tech talk.

**Source of truth for every claim:** `EXPERIMENTS.md` (#1–#22) and `experiments/a2a_patterns/`.
Do not invent numbers; use the ones below (they are copied from the results).

---

## Brand palette (real, from nerdy.com CSS design tokens) — dark theme

```
--bg-ink        #202344   /* primary slide background (navy) */
--bg-deep       #0f0928   /* deepest panels / gradient stop */
--bg-panel      #161c2c   /* alt section background */
--surface       rgba(255,255,255,0.05)  /* cards on dark */
--surface-line  rgba(255,255,255,0.12)  /* hairline borders */
--text          #ffffff
--text-dim      rgba(255,255,255,0.72)
--text-muted    #6c6e87
--violet        #a110ff   /* PRIMARY brand accent */
--purple        #5824c5
--cyan          #17e2ea   /* secondary accent (data highlights) */
--mint          #35dd8b   /* "good"/success metrics */
--blue          #1756e2
--yellow        #ffcb19   /* caution/attention */
--orange        #ff800d
--red           #ff4e00   /* failure/ceiling */
--lilac         #9e97ff   /* gradient mid */
/* signature gradient: linear-gradient(110deg, #a110ff, #1756e2 55%, #9e97ff) */
```
**Font:** Poppins (Google Fonts; system sans fallback). Use a monospace (ui-monospace / JetBrains
Mono) for code, envelope bodies, and big metric numerals. Accents are for emphasis and data only —
keep large areas ink-navy with white text; never rainbow a slide.

## Build constraints
- ONE self-contained `.html` file. Embedded `<style>`; minimal vanilla JS for nav (← / → / Space,
  Home/End, and clickable progress dots); slide counter. No framework, no build step.
- 16:9 slides, centered, scale to viewport. Readable from across a room: large type, generous
  whitespace, one idea per slide. Subtle slide-transition is fine; no gratuitous animation.
- Poppins via Google Fonts `<link>` with a robust fallback so it still looks right offline.
- Accessible contrast (white on ink is fine; dim text ≥ rgba .6). Print/PDF-export friendly if easy.

---

## Slides (16)

### 1 — Title
- **Composing a reliable multi-agent system**
- Subtitle: *An experiment log — characterizing, hardening, and self-organizing a cross-backend agent roster.*
- Chips: `codex · gemini · claude` · `22 ground-truthed experiments` · `agent_roster`
- Footer: built + run on a local observable roster (tmux), 2026.

### 2 — The system under test
- **agent_roster**: an *observable* multi-agent roster. Each agent = a backend CLI (codex / gemini /
  claude) launched into its own tmux pane, with a durable run dir (`prompt` / `output` / `status` /
  `events.jsonl`) and a peer-to-peer (A2A) message channel.
- The question driving all 22 experiments: **how do you compose heterogeneous LLM backends into a
  system that's actually reliable — and where does it break?**

### 3 — Methodology (why trust any of this)
- Every finding is **ground-truthed, replicated, and pre-registered** — often blinded.
- **The control is the linchpin.** #2: a single gemini control turned "codex is broken" into the
  real cause — an adapter bug clobbering codex's output. Without it, the wrong conclusion ships.
- Decisions trace to data, not vibes. (This slide sets up that the numbers below are earned.)

### 4 — Backend characterization
- Head-to-head, identical tasks, only the backend varies.
- **Code-with-framing quality: claude > codex > gemini** (#4), and it **survives blind cross-backend
  judging** (#8 — claude was the only candidate all three judges found technically error-free;
  *only codex self-preferred*).
- codex's one real reliability limit: it **declines large, open-ended reviews** (#1) — but completes
  *concrete* ones fine (#9: a clean 1,200-line, 9-file review). The limit is open-endedness, not size.

### 5 — Single-agent output ships errors
- Even the best single agent ships mistakes: **~7 of 9** generated drills had ≥1 answer-key error (#9).
- Two-backend QA catches them, and the **consensus items are the reliable signal**.
- → a cross-backend QA pass became a standing part of the generation pipeline.

### 6 — From findings to routing decisions
- Ground-truthed backend **battery** (#12–#16) turned characterization into config:
  - **verifier → claude** for open-ended gates (codex declines them); **codex** for bounded review.
  - **`/sanity` = single codex** (later *validated* by #20, not overturned).
  - **gemini → research + judging, NOT the security gate** — a repeatable authz/exposure blind spot.
- Principle: **route by measured strength, not reputation.**

### 7 — A2A: agents talk to each other (no relay)
- Built a peer-to-peer messaging primitive on the roster: **typed JSON envelopes**, request/reply
  correlation, broadcast (`send … all`), 1:N fan-in (`gather`), and **push delivery** (inotify),
  every write **flock-atomic**. Hardened to v0.4 — **46 passing tests**; a verify pass caught real
  bugs the green tests missed (numeric-flag crash, char-vs-byte truncation, etc.).
- Envelope: `{id, ts, from, to, type, subject, in_reply_to, corr, body}` — show it in mono.

### 8 — Emergent behavior: no herding
- Plant a **confident, unanimous WRONG majority** in a cross-backend debate — does the lone correct
  agent cave? (Asch conformity, but for LLMs.) #17–#19.
- **0 caves** across every paradigm tested: verifiable *and* pure-subjective questions, mild *and*
  maximal pressure (authority + unanimity + "you're the lone dissenter, reconsider").
- vs **human Asch ~33%**. The subjective false-absolute majority **backfired into reactance** —
  agents defended the option the majority called wrong. Frontier LLMs showed no conformity we could induce.

### 9 — Drift detection: panel vs single reviewer
- Does a multi-reviewer panel beat one reviewer at doc↔code coherence (what `/sanity` does)?
  **40 blinded, ground-truthed reviews** across 4 synthetic projects (#20).
- Hard behavioral round: single recall **codex 0.96 > claude 0.90 > gemini 0.87** — the earlier
  claude-first ranking **reverses** for this task (the bug-finding/recall ranking from #12; codex
  best *and* most precise, 0 FP).
- Backends have **different blind spots** → a cross-backend *union* panel (0.96) > 3×claude (0.92),
  but only **+0.04** (below the pre-registered +0.10 bar). Diversity > redundancy, marginally.
- **Universal blind spot:** a *removed* guard (absence-drift) = **0/10** — no backend or panel catches
  an absence with no code trace. → keep `/sanity` single-codex; union = insurance; add executable checks.

### 10 — Self-organization, three ways (the throughline)
- Three ways roster agents coordinate **with no orchestrator** — a comparison table:

| Pattern | Coordination | Communication | Result |
|---|---|---|---|
| work-division | shared-state atomic claim | none (pull) | exactly-once, emergent balance |
| leader-election | message-passing, term-based | direct A2A | 28/30; ceiling at N=7-failover |
| shared-blackboard | shared-state, multi-level | **stigmergy (0 messages)** | 20/20, clean |

### 11 — Work-division
- Workers drain a shared board; the only coordination is an **atomic `flock` claim**
  (read-find-mark-write). Two workers never take the same task.
- **Exactly-once under stress:** 10 workers × 100 tasks, **0 double-claims**. Emergent load-balance:
  speed-skewed workers split 10/9/7/4 with no balancing logic — work-stealing for free.

### 12 — Leader-election (and the bug replication found)
- Term-based, highest-id-wins election over A2A broadcast. **28/30.**
- Replication *earned* two findings: (1) a real **liveness bug** — a non-max candidate that missed
  the single `COORDINATOR` broadcast stranded forever (no retry); fixed. (2) a **transport ceiling**:
  the node loop spins as fast as messages arrive, so an ungated heartbeat *storms* `send … all` —
  each message a forked `bash`+`jq`+`flock`+`inotify`.
- After fixes: **N=3 / N=5 perfect (incl. failover), N=7 steady perfect**; only **N=7-with-failover**
  stays soft (3/5) — bursty jitter the timing budget can't always cover.

### 13 — Shared-blackboard (stigmergy)
- Agents contribute to a shared multi-level store and react to its state — **no messages at all**.
- A completeness-gated synthesis slot, claimed atomically, guarantees the final reduction happens
  **exactly once**.
- **20/20, zero violations:** no lost work, no double-work, synthesis-once, correct vs ground truth,
  synthesis strictly after completeness, emergent balance. **No ceiling** — it's low-frequency.

### 14 — The cross-cutting insight
- **The atomic claim is the universal primitive.** Work-division, the blackboard, and the A2A inbox
  all reduce to one race-free `flock` op. Get it right and leaderless coordination falls out.
- **Reliable broadcast enables consensus** — the file-backed inbox provides it (election converges).
- **The ceiling is the TRANSPORT, not the protocol.** High-frequency message-passing (heartbeats)
  hits the fork-per-message cost; low-frequency stigmergy doesn't. *Shared-state scales where chatty
  message-passing does not* — to lift it, change the transport (persistent/batched), not the algorithm.

### 15 — Live, cross-backend (not shell stand-ins)
- Real **claude + codex + gemini** agents, no orchestrator:
  - **Leader election over A2A:** unanimous — all three agreed `leader = claude (id 30)`; **10 typed
    envelopes**; the leader then assigned a task to a follower over A2A.
  - **Zero-message stigmergy:** three agents built a 6-section fact-sheet through a shared board —
    **0 A2A messages**, emergent division, synthesis-once. (Faster backends won the section races;
    honest work-stealing — codex got shut out.)

### 16 — Takeaways
- **Route by measured strength, not reputation** (claude for framing, codex for bounded review/drift,
  gemini for research/judging — never the security gate).
- **Consensus / diversity as insurance**, not default — it pays only on tasks with divergent blind spots.
- **Ground truth + replication earns the surprising findings** (the codex-for-drift reversal; the
  no-herding result; the transport ceiling) — none were guessable up front.
- **Lift the transport before scaling chatty protocols.** Leaderless coordination works today at
  small N; the atomic claim is the thing to make first-class.
- Footer chip: 22 experiments · ground-truthed · pre-registered · reproducible.
