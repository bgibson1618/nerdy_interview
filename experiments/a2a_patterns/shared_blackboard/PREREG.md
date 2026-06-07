# Pre-registration — A2A pattern: shared blackboard (stigmergy)

**Status:** pre-registered before implementation. Third of the A2A self-organizing patterns,
completing the set:

| Pattern | Coordination | Communication |
| --- | --- | --- |
| work-division (`../work_division/`) | shared-state, atomic claim | none (pull from board) |
| leader-election (`../leader_election/`) | message-passing, term-based | direct A2A messages |
| **shared-blackboard (this)** | **shared-state, multi-level** | **stigmergy — through the board only** |

The classic blackboard architecture: a shared structured store holds partial solutions at
multiple abstraction levels; independent "knowledge sources" (agents) watch it and contribute
**opportunistically** when the board's state enables their step. Control is fully decentralized —
**no orchestrator** and, unlike leader-election, **no direct messages**: agents coordinate purely
through what they read and write on the board (stigmergy).

## Questions

- **Q1 (No lost contributions):** Under concurrent posting, is every contribution persisted?
  `N` agents × `M` posts → exactly `N·M` entries. Target: **always** (atomic append).
- **Q2 (No double-work):** Is each open subproblem claimed and solved by exactly one agent (no
  two agents redundantly computing the same shard)? Target: **always** (atomic claim).
- **Q3 (Synthesis-once):** The final reduction depends on ALL partials being present. Is it
  posted **exactly once** — not raced by every idle agent the moment the board completes?
  Target: **exactly one** synthesis entry.
- **Q4 (Correctness vs ground truth):** Does the board's final answer equal the independently
  computed correct answer? Target: **always**.
- **Q5 (Stigmergic triggering):** Does the synthesis fire *because* the board reached
  completeness — i.e., the synthesizing agent claimed synthesis only **after** observing all
  partials, with no one telling it to? Measured from the trace.
- **Q6 (Emergent balance + specialization, live layer):** With speed/skill-skewed agents, do
  faster agents claim more shards (work-stealing for free), and do heterogeneous agents gravitate
  to shards matching their strength?

## Board model (pre-committed)

`blackboard.sh` — a shared JSONL store with `flock`-atomic operations and a small level schema:

- **Level 0 (problem):** seeded open subproblems (`kind:"shard"`, `status:"open"`).
- **Level 1 (partial):** an agent `claim`s an open shard (atomic open→claimed), computes, then
  `post`s a partial result (`kind:"partial"`, immutable) and marks the shard `done`.
- **Level 2 (synthesis):** when all shards are `done`, the synthesis slot (`kind:"synthesis"`,
  one row, `status:"open"`) can be atomically claimed by exactly one agent, which reduces all
  partials and posts the final answer.

Operations: `seed`, `claim-shard`, `post-partial`, `claim-synthesis`, `post-final`, `state`
(open/claimed/done counts + solved?), `dump`. Every write is a flock-guarded read-modify-write,
the same discipline the hardened A2A inbox and `board.sh` are built on.

## Method

### Layer 1 — deterministic mechanism (ground-truthed, replicated)
Problem: sum + per-category breakdown of a transaction list split into `S` shards. Ground truth
is computed independently in the harness. `S` shards, `K` concurrent workers; each worker loops
`claim-shard → post-partial → done`, and when it observes all shards done, attempts
`claim-synthesis` (only one wins) → `post-final`.

A checker evaluates against ground truth and the pre-registered properties:
- entries == expected (no loss); each shard `done` by exactly one worker (no double-work);
- exactly one `synthesis`/`final`; final answer == ground truth;
- **stigmergy probe:** the synthesis claim's timestamp is *after* the last shard's `done`
  timestamp (it reacted to completeness, not raced ahead).

**Replication:** `T ≥ 5` trials over `(S,K) ∈ {(6,3),(10,4),(12,6)}`, including a speed-skew
trial to observe emergent load-balance. Pre-registered pass bar: **0 lost entries, 0 double-work,
exactly one synthesis, final == ground truth, synthesis-after-completeness — in every trial.**

### Layer 2 — live heterogeneous agents (demonstration)
2–3 real roster agents (claude/codex/gemini) launched as peers, each told only "watch the
blackboard, contribute where you can, do not message the others" — pure stigmergy. Problem: a
small dependent fact-sheet (section summaries as shards; an executive summary as the synthesis
that needs all sections present). Captured as a transcript; we observe whether they self-divide
the shards and whether exactly one composes the synthesis after the others finish.

## What would falsify / surprise
- Lost entries or double-claims under contention → the atomic-claim discipline doesn't hold at
  this access pattern (would also implicate `board.sh` and the inbox).
- Multiple synthesis entries → the "fires exactly once" guard is racy (the interesting safety
  bug this pattern must prevent).
- Live agents all racing the synthesis, or none doing it (waiting on each other) → a stigmergy
  gap: the board state doesn't carry enough signal for agents to self-trigger without messages.

## Threats to validity
- Shared filesystem, single host — same scope note as the sibling patterns (local-FS coordination
  by design; not a network-partition test).
- Live layer is N≤3, single-shot: a generality/feasibility signal, not a rate.
- The deterministic problem is embarrassingly parallel; the dependency is only at the synthesis
  level. A richer multi-level dependency graph is left as future work.
