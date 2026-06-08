# Results — shared blackboard (stigmergy)

**Headline:** the stigmergic blackboard is the **clean counterpoint to leader-election** — it
coordinates K agents through a shared store with *no messages at all* and holds every
pre-registered safety property, because all coordination reduces to the same `flock`-atomic claim
that work-division proved, plus a completeness-gated synthesis. Crucially it does **not** share the
election's N=7 ceiling: it is **low-frequency** (an agent touches the board a handful of times,
not many times per second), so it never stresses the transport's per-message cost.

## What ran
`bb_worker.sh` knowledge sources (no orchestrator, no direct messages) over `blackboard.sh`,
driven by `run_blackboard.sh` which generates a random transaction set, computes the **true**
per-category totals independently, then checks the board's final answer + all safety properties.
`bb_stress.sh` replicates (S,K) ∈ {(6,3),(10,4),(12,6)} + a speed-skew config × T trials.

## Stress battery — **20/20, zero violations**

T=5 per config, ground-truthed. Every property held in every trial:

| Config (S,K) | Trials | Lost entries | Double-work | Synthesis-once | Correct vs truth | Stigmergy (synth after complete) |
| --- | --- | --- | --- | --- | --- | --- |
| (6, 3)       | 5/5 | 0 | 0 | ✓ | ✓ | ✓ |
| (10, 4)      | 5/5 | 0 | 0 | ✓ | ✓ | ✓ |
| (12, 6)      | 5/5 | 0 | 0 | ✓ | ✓ | ✓ |
| (10, 4) skew | 5/5 | 0 | 0 | ✓ | ✓ | ✓ |

Balance was even when workers were equal-speed (e.g. (12,6) → 2 shards each, every trial) and
**tilted to the faster workers under skew** (delays 0.02/0.04/0.06/0.08 s → **3/3/2/2**,
consistent across all 5 skew trials) — emergent work-stealing, no balancing logic.

## Verified properties
- **No lost contributions / no double-work** — every shard is claimed and solved by exactly one
  worker; the atomic `claim-shard` makes a double-claim impossible (same guarantee as
  `board.sh`, here extended to a multi-level store).
- **Synthesis-once** — the single synthesis slot, atomically claimed only when every shard is
  `done`, is produced exactly once even though all idle workers race for it. This is the safety
  property the pattern exists to provide (no "everyone computes the final answer").
- **Correctness** — the board's merged per-category totals + grand total equal the independently
  computed ground truth, every trial.
- **Stigmergic triggering** — the synthesis claim timestamp is strictly after the last shard's
  done timestamp: the reduction fired *because the board reached completeness*, with no agent
  instructed to do it and no message exchanged.
- **Emergent load-balance** — sample skew run (delays 0.02/0.04/0.06/0.08 s over 10 shards):
  the faster two workers claimed **3** each, the slower two **2** each — pull-based work-stealing
  falls out of the atomic claim for free, same as work-division. (The skew is mild because the
  per-shard `jq` compute dominates the injected delay; the trend is the point.)

## Interpretation
- Stigmergy is the **simplest** of the three A2A patterns to make correct: with no messages and no
  leader, the only thing that must be right is the **atomic claim** — and that is exactly the
  primitive the whole roster is already built on. The blackboard adds only a *level structure* and
  a *completeness gate* on top.
- It also sidesteps the leader-election ceiling: because coordination is **low-frequency**
  (claim a shard, post once), it never generates the per-second `send … all` storm that overwhelms
  the fork-per-message transport. Shared-state stigmergy scales where chatty message-passing does not.

## Live-agent layer — DONE (`live_demo/demo_result.md`)
Three **real, heterogeneous** agents — `alice` (claude), `bob` (codex), `cleo` (gemini-3-flash) —
built a shared 6-section stack fact-sheet coordinating **only through the board** (no `--peers`,
**0 A2A messages**). Outcome: all 6 sections + the executive summary done, `solved=yes`. Observed:
- **Emergent division, no negotiation:** alice claimed §1,2,4,6; cleo claimed §3,5; **bob got shut
  out** — the faster two backends won every section race before codex claimed. That's the honest
  work-stealing dynamic: pull-based, no central assignment, **no starvation *guarantee*** for a
  slow worker (it just does less, here zero).
- **Synthesis-once with real agents:** alice's `claim-synthesis` returned `OK`; the others' returned
  `NOPE` and they correctly stood down ("another agent is writing the synthesis"). Exactly one
  executive summary, written *after* all sections were posted — stigmergic triggering by real agents.
- The content is genuinely good (accurate per-topic summaries + a coherent synthesis), reproducible
  via `live_demo/run_demo.sh`. (Gemini needs `GEMINI_CLI_TRUST_WORKSPACE=true` for headless runs in
  an untrusted dir — the harness sets it via tmux's global env.)
