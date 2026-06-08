# A2A self-organization, three ways

Three experiments on how roster agents can coordinate **with no orchestrator**, using only the
hardened A2A primitive (peer messaging) and the same `flock`-atomic shared-state discipline the
whole roster rests on. Together they map the design space of leaderless coordination.

| Pattern | Coordination | Communication | Mechanism result | Live cross-backend demo |
| --- | --- | --- | --- | --- |
| **[work-division](work_division/)** | shared-state, atomic claim | none (pull from a board) | exactly-once under stress, emergent load-balance | 2 claude peers drained a board 4/4 |
| **[leader-election](leader_election/)** (#21) | message-passing, term-based | direct A2A messages | 28/30; N≤5 + N=7-steady perfect; N=7-failover = transport ceiling | 3 backends elect a leader over A2A |
| **[shared-blackboard](shared_blackboard/)** (#22) | shared-state, multi-level | **stigmergy — board only** | 20/20, zero violations | 3 backends build a fact-sheet, **0 messages** |

The two newer patterns (`leader_election/`, `shared_blackboard/`) each have a `PREREG.md`
(questions, protocol, pass bar), the mechanism scripts, a `RESULTS.md`, and a `live_demo/` with a
reproducible `demo_result.md`. The original `work_division/` predates that layout: it carries its
README, the mechanism scripts (`board.sh`, `test_exactly_once.sh`), and an inline `demo_result.md`
(no separate `PREREG`/`RESULTS`).

## The three modes
- **Work-division** — workers pull tasks from a shared list. The only coordination is an **atomic
  claim**: a `flock`-guarded read-find-mark-write, so two workers never take the same task.
  Exactly-once and work-stealing fall out for free. Communication is *optional* (peers may
  announce progress, but don't need to).
- **Leader-election** — peers exchange **direct messages** to agree on one coordinator (highest id
  wins, term-based, with heartbeat failover). This is the message-passing end of the space, and a
  correct election is a live test of whether the A2A inbox delivers **reliable broadcast**.
- **Shared-blackboard** — agents contribute to a shared multi-level store and react to its state,
  with **no messages at all** (stigmergy). A completeness-gated synthesis slot, claimed atomically,
  guarantees the final reduction happens exactly once.

## What the three together taught us

1. **The atomic claim is the universal primitive.** Work-division and the blackboard both reduce
   to it; so does the A2A inbox (the v0.3 hardening proved the same `flock` discipline race-free
   under concurrency). Get that one operation right and a surprising amount of leaderless
   coordination falls out — no leader, no orchestrator, no lost or duplicated work.

2. **Reliable broadcast is what message-passing consensus needs** — and the file-backed inbox
   provides it. Highest-id election converges *because* every live node sees every `ELECTION`/
   `COORDINATOR`. Replication confirmed it at N=3/N=5 (perfect, incl. failover) and N=7 steady.

3. **There is a transport throughput/jitter ceiling, and it is frequency-dependent — not N.**
   The leader-election heartbeat is *high-frequency* (many `send … all` per second), and each
   message is a forked `bash`+`jq`+`flock`+`inotify`; at N=7-with-failover that cost inflates and
   *destabilizes* round timing, so the timing-based protocol occasionally misfires (#21). The
   blackboard and work-division are *low-frequency* (touch shared state a handful of times) and
   have **no such ceiling** (#22: 20/20). The lesson is sharp: **shared-state stigmergy scales
   where chatty message-passing does not**, on this transport. To lift the message-passing ceiling,
   change the transport (persistent/batched delivery), not the protocol.

4. **Real heterogeneous agents can drive all three.** The live demos used genuine claude + codex +
   gemini agents (not shell stand-ins): they self-divided a task board, elected a cross-backend
   leader over A2A, and built a fact-sheet through pure stigmergy with **zero messages** — each
   captured as a reproducible `live_demo/demo_result.md`.

## Picking a pattern
- **Independent units of work, want throughput** → work-division (pull from a board).
- **Need one coordinator / a single decision-maker** → leader-election, at small N (≤5 comfortably;
  N=7 steady fine; treat N=7-with-failover as the transport's edge).
- **A decomposable problem where partial results unlock others, and you want the loosest coupling**
  → shared-blackboard. No messages, no leader — just the board. It is the simplest to make correct
  and the one that scales.

## If they graduate
All three are thin protocols over the existing primitive. A first-class `agent-roster board`
(work-division) with `blackboard`/`elect` companions — same `flock` discipline, same
`work/agents/` run layout — would make leaderless coordination a supported roster capability.
