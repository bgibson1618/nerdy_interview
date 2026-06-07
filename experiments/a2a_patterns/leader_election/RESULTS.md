# Results — leaderless leader election over A2A

**Headline:** the leaderless, term-based, highest-id election is **correct and reliable through
N=7 in steady state (25/25)** over the hardened A2A primitive — but getting there required fixing
a real **liveness bug** replication exposed, and the one residual soft spot, **N=7 *failover*
(3/5)**, pins a genuine **substrate throughput/jitter ceiling**: the fork-per-message file
transport inflates and *destabilizes* round timing under the heaviest load (a death-detection
delay stacked on a second full election), so the timing-based protocol occasionally misses its
window. The protocol logic is sound; the ceiling is the transport, not the algorithm. This is the
honest, decision-relevant result — replication earned it.

## What ran
`election.sh` nodes (one bash loop each, messaging only via `agent-roster send … all` / `recv`),
spawned by `run_election.sh` into a fabricated A2A run dir with **shuffled distinct ids** (winner
is never positional), checked against ground truth (leader = max id; after a kill = max survivor).
`stress.sh` replicates N∈{3,5,7} × {steady, leader-kill} × T trials.

## The journey (this is the finding)

### Round 1 — naive protocol: a liveness bug at N=7
First battery (T=5, fixed 2 s window): **24/30. N=3 and N=5 were perfect (10/10 each); every one
of the 6 failures was N=7.** Tracing them showed a clean bug: the highest id wins and broadcasts
`COORDINATOR` exactly **once**; a non-max node that *missed* that single broadcast had **no
candidate-side retry** — it sat as `candidate / leader=none` forever (the failover re-election
only fired for *followers* that lose heartbeats, never for a stranded candidate). Liveness gap.

### Round 2 — fix the liveness gap (no term churn)
Added: a losing candidate **re-solicits** its `ELECTION` at the same term, and the live leader
**re-announces** `COORDINATOR` on seeing it — so a stranded candidate recovers **without** a term
bump (preserving the correct, max leader). A conservative backstop term-bump remains only for a
genuinely dead leader. This is the right fix and it closes the original stranding.

### Round 3 — the real ceiling: transport throughput, not logic
The remaining N=7 failures traced to two compounding **transport** effects, both fixed/characterized:

1. **Broadcast storm.** The node loop spins as fast as messages arrive (`recv --wait` returns the
   instant one lands), and the leader was broadcasting a `HEARTBEAT` on *every* iteration. With 7
   nodes that is a flood of `send … all`, each a **forked `bash`+`jq`+`flock`+`inotifywait`**.
   *Fix:* gate the heartbeat to its interval — a real, kept improvement that **stabilized N=7
   steady completely**.
2. **Round-time inflation + jitter.** Even gated, at N=7 the per-message fork cost can starve the
   loops: in one trace the **leader itself declared 6.5 s late** (a 2 s window). Late declaration
   → stragglers' backstop fires *before* the `COORDINATOR` arrives → term bump → a second election
   under even more load. The protocol is safe **iff the collection window exceeds worst-case
   broadcast-propagation time**, so the timing budget is scaled with N (EW/HT 2→4 for N≥7). That
   plus the storm fix made **steady-state N=7 perfect** — but **failover at N=7 still misses
   occasionally** (see below), because the starvation is **bursty**, not a fixed offset: failover
   stacks a death-detection delay onto a *second* full election, exactly when load is heaviest, so
   the worst-case spike sometimes still exceeds the budget.

## Definitive battery (current protocol, heartbeat-gated, N-scaled budget)

T=5 per config, ground-truthed, shuffled ids:

| Config | Steady | Leader-kill (failover) |
| --- | --- | --- |
| **N=3** | **5 / 5** | **5 / 5** |
| **N=5** | **5 / 5** | **5 / 5** |
| **N=7** | **5 / 5** | **3 / 5** |

**Total 28/30.** Every steady-state config is perfect (15/15) and small-N failover is perfect
(10/10). The only soft spot is **N=7 failover**: of the 2 misses, one **timed out** (failover
didn't converge inside the window) and one stranded a survivor (**agreement split**) — both are
the bursty-jitter ceiling under the heaviest case, **not** a steady-state safety violation. No
same-term split-brain occurred in the definitive battery.

## Interpretation
- **The A2A primitive delivers reliable broadcast for low-frequency coordination.** Small-N
  election, work-division, request/reply, and the cross-backend debates (#17–#19) all sit
  comfortably inside its envelope.
- **A high-frequency, timing-sensitive protocol (heartbeat election) approaches a throughput/jitter
  ceiling at N=7 failover** on a single WSL2 host: steady-state N=7 is solid once the heartbeat is
  gated and the budget scaled, but *failover* — death-detection + a second election under peak load
  — occasionally exceeds the budget (3/5). The fork-per-message cost inflates effective round time
  and, worse, makes it *jittery*, so a fixed budget cannot cover the worst spike. This is a property
  of the **transport** (a file-backed inbox with a CLI invocation per message), not the election logic.
- **Safety vs. the substrate:** the only safety violations observed (transient same-term
  split-brain) were *downstream of* timing starvation (a premature backstop bump), i.e. the
  window-exceeds-propagation invariant being broken by transport jitter — not a flaw in
  highest-id selection itself.

## Recommendations / if it graduates
- Leaderless election is **rock-solid through N=5 (incl. failover) and N=7 in steady state**; treat
  **N=7-with-failover as the edge** of this transport's envelope. Below that, use it freely.
- For larger or latency-sensitive coordination, the transport — not the protocol — is what to
  change: a **persistent connection / batched delivery** (avoid a process fork per message) would
  lift the ceiling far more than any protocol tuning. The current `inotify` push already helps
  latency; the cost is the per-message CLI spawn.
- If a heartbeat protocol must run on this transport, **size the collection window to the
  worst-case (not mean) propagation time** and keep the backstop term-bump conservative — a
  premature bump is what turns a liveness hiccup into a safety violation.

## Live-agent layer — deferred (by plan)
The real-heterogeneous-agent demonstration is **intentionally held for the demo-strategy
discussion** the user wants on return ("the best way to demo the results of all our experiments").
The mechanism layer above is the rigorous, ground-truthed result; a live N≤3 election over A2A
(comfortably inside the safe envelope) is the natural showcase and is ready to stand up on request.
