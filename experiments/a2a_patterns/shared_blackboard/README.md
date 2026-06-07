# A2A pattern: shared blackboard (stigmergy)

The third self-organizing pattern, completing the set:

| Pattern | Coordination | Communication |
| --- | --- | --- |
| work-division (`../work_division/`) | shared-state, atomic claim | none (pull from board) |
| leader-election (`../leader_election/`) | message-passing, term-based | direct A2A messages |
| **shared-blackboard (this)** | **shared-state, multi-level** | **stigmergy — via the board only** |

A classic blackboard architecture: a shared structured store holds partial solutions at multiple
levels; independent knowledge sources (agents) watch it and contribute **opportunistically** when
the board's state enables their step. No orchestrator and — unlike leader-election — **no direct
messages**: agents coordinate purely through what they read and write (stigmergy).

Pre-registration: `PREREG.md`. Results: `RESULTS.md`.

## Mechanism
`blackboard.sh` — a shared JSONL store with `flock`-atomic ops and a small level schema:
**Level-0** seeded shards (`open`), **Level-1** one partial per shard (atomic `claim-shard` →
compute → `post-partial`, marks `done`), **Level-2** a single synthesis that may be claimed only
once **every** shard is `done` (the stigmergic gate). The synthesis slot's atomic claim guarantees
the reduction is computed **exactly once**, not raced by every idle agent.

- `blackboard.sh` — the store + atomic operations.
- `bb_worker.sh` — one stigmergic knowledge source (claim shard → post partial; and, on observing
  completeness, race to claim the synthesis and post the merged final). No messages, no leader.
- `run_blackboard.sh <S> <K> [skew]` — generates a random transaction set, computes the **true**
  per-category totals independently, seeds the board, runs K workers, checks board vs ground truth.
- `bb_stress.sh [T]` — replicates (S,K) ∈ {(6,3),(10,4),(12,6)} plus a speed-skew config × T trials.

## Problem (deterministic layer)
Sum + per-category breakdown of a transaction list split into S shards. Each worker claims shards
and posts per-category subtotals; whoever first sees all shards done claims the synthesis and posts
the merged totals. Ground truth is computed independently from the same data, so correctness is
checkable exactly.

## Properties (verified — see RESULTS.md)
- **No lost contributions** — N·M concurrent posts all persist (atomic append).
- **No double-work** — each shard claimed/solved by exactly one worker (atomic claim).
- **Synthesis-once** — exactly one synthesis entry despite every worker racing to produce it.
- **Correctness** — board's final answer == independently computed ground truth.
- **Stigmergic triggering** — the synthesis is claimed strictly *after* the last shard is done
  (reacted to board completeness; no one told it to).
- **Emergent load-balance** — with speed-skewed workers, faster workers claim more shards, free.

## Run
```bash
bash run_blackboard.sh 6 3          # one trial
bash run_blackboard.sh 10 4 skew    # speed-skewed workers
bash bb_stress.sh 5                 # full replicated battery
```

## Live-agent layer
See `RESULTS.md` for the demonstration with real heterogeneous roster agents collaborating through
the board with no direct messages.

## If it graduates
`claim-shard` / `post-partial` / `claim-synthesis` on a shared JSONL store is the same `flock`
discipline as the `board` work-division candidate, extended with levels and a completeness gate —
a natural `agent-roster blackboard` companion to a future `board` subcommand.
