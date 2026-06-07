# Pre-registration — A2A pattern: leaderless leader election

**Status:** pre-registered before implementation. Sibling of the work-division pattern
(`../work_division/`). Where work-division is *shared-state* coordination (one board, atomic
claim), leader election is the *message-passing* coordination pattern: peers agree on a single
coordinator using ONLY the hardened A2A messaging primitive (`send`/`send all`/`recv`/`gather`),
with **no orchestrator** in the loop.

This experiment dogfoods the v0.3 A2A primitive under genuine concurrency: a correct election
is exactly a test of whether the file-backed inbox delivers the **reliable broadcast** the
protocol assumes.

## Questions

- **Q1 (Safety / no split-brain):** Across the run, is there ever a moment when two distinct
  nodes both believe they are the leader *for the same term*? Target: **never**.
- **Q2 (Agreement):** When the election settles, do *all* live nodes agree on the *same* leader
  id? Target: **always**.
- **Q3 (Liveness / convergence):** Does exactly one leader emerge within a bounded number of
  rounds? Target: **always**, within the configured election window.
- **Q4 (Re-election / failover):** When the current leader is killed, do the survivors elect a
  new single leader — and is it the highest id among *survivors*? Target: **always**.
- **Q5 (Backend generality, live layer):** Does the same protocol work with **real heterogeneous
  agents** (claude / codex / gemini) electing a leader over A2A, no orchestrator?

## Protocol (pre-committed)

Term-based, highest-id-wins election over reliable broadcast. Each node `i` has a stable
integer priority = its id. Per node, persistent state: `term` (monotone int), `leader` (id or
none), `role ∈ {follower, candidate, leader}`.

1. **Trigger.** A node with no known live leader increments `term` and broadcasts
   `ELECTION term=<t> from=<i>` to all peers (`send all`). It becomes `candidate`.
2. **Collect.** Every node, on seeing `ELECTION`, records the sender's id for term `t` and (if it
   hasn't already for a term ≥ t) joins by re-broadcasting its own `ELECTION term=<t>`. Nodes
   track the max id seen for the current term.
3. **Declare.** After the election window (bounded `recv --wait` with timeout), the node holding
   the **max id for term `t`** broadcasts `COORDINATOR term=<t> leader=<i>` and sets
   `role=leader`. Lower-id nodes that receive it set `leader=i`, `role=follower`.
4. **Tie-break / monotonicity:** ids are unique and totally ordered, so the max is unique. A
   `COORDINATOR` for a *higher* term always supersedes a lower-term belief (this is what makes
   failover safe).
5. **Heartbeat + failover:** the leader broadcasts `HEARTBEAT term=<t>` every `HB` seconds. A
   follower that misses `K` consecutive heartbeats assumes the leader is gone and triggers a new
   election at `term+1` (step 1). The dead leader's id is excluded because it no longer answers.

**Why it should be safe:** the A2A inbox is loss-free and append-ordered, so every live node sees
every `ELECTION`/`COORDINATOR` for a term. With a unique global max id, all live nodes compute the
same winner for that term. Split-brain is only possible *transiently* across a failover (a slow
heartbeat makes a follower open term+1 while the old leader still thinks it leads at term `t`) —
and the **term ordering resolves it**: the higher term wins, the stale leader steps down on seeing
it. The experiment **measures** whether such transient windows occur and that they always resolve
to a single leader.

## Method

### Layer 1 — deterministic mechanism (ground-truthed, replicated)
`election.sh` implements the protocol as a shell node loop messaging via the real
`agent-roster` CLI against a fabricated run dir (the test-suite seam). `run_election.sh` spawns
N nodes concurrently and records, per node, an **event trace** (`term, role, leader`) to a shared
log with timestamps.

A checker (`check_safety.sh` / inline awk) evaluates the trace against ground truth:
- **Agreement:** final `leader` identical across all live nodes.
- **Single winner:** exactly one node ever holds `role=leader` per term.
- **Split-brain probe:** scan the timeline for any interval where two nodes simultaneously hold
  `role=leader` with the *same* term (hard fail) vs *different* terms (transient, must resolve).
- **Failover:** after killing the leader, the new leader = max id of survivors, unanimously.

**Replication:** `T ≥ 5` trials per configuration; configurations vary N ∈ {3, 5, 7} and inject a
leader kill in half the trials. Pre-registered pass bar: **0 same-term split-brains; 100%
agreement; 100% correct failover** across all trials.

### Layer 2 — live heterogeneous agents (demonstration)
2–3 real roster agents (claude / codex / gemini) launched as peers (`run-role --peers`) run the
election in natural language over A2A: announce candidacy, exchange ids, converge on the highest,
the elected leader then assigns a trivial task to a follower over A2A. Captured as a transcript.
This is a demonstration of generality, not a statistical claim.

## What would falsify / surprise

- Any **same-term** split-brain → the primitive is *not* providing reliable broadcast, or the
  protocol has a hole (would be a real finding against the v0.3 primitive).
- Failover electing a *non-max* survivor, or two leaders persisting → liveness/safety bug.
- Live agents failing to converge (e.g., looping, or all deferring) → a coordination-prompt gap,
  not a primitive bug; would be logged as an interaction-surface finding like #5.

## Threats to validity
- The shell mechanism shares a filesystem; "node failure" is simulated by killing a process, not
  a network partition (the A2A primitive has no network layer — this is local-FS messaging by
  design). We are testing the messaging-coordination logic, not partition tolerance.
- Live-agent layer is N≤3, single-shot — generality signal, not a rate.
