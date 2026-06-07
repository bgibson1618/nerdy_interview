# A2A pattern: leaderless leader election

The **message-passing** self-organizing pattern, complement to work-division's shared-state
claim. N peers elect a single coordinator over the hardened A2A primitive (`send <run> all`
broadcast + `recv`), with **no orchestrator**. A correct election is, in effect, a live test of
whether the file-backed inbox delivers the **reliable broadcast** the protocol assumes — so this
both demonstrates a pattern and stress-tests the v0.4 A2A channel under genuine concurrency.

Pre-registration (questions, protocol, pass bar): `PREREG.md`. Results: `RESULTS.md`.

## Mechanism
`election.sh` — one node of a **term-based, highest-id-wins** election. Each node autonomously:
broadcasts `ELECTION term=t id=i`, collects rivals' candidacies for a bounded window, and the
node holding the **global-max id** declares itself with `COORDINATOR`; lower ids defer. The
leader then emits `HEARTBEAT`s; a follower that stops hearing them re-opens the election at the
next term (`term+1`), which is what makes failover safe — a higher term always supersedes a
stale belief, so two leaders can never agree in the same term.

- `election.sh` — a single node's loop (messages only via `agent-roster send/recv`).
- `run_election.sh <N> <dur> [kill]` — fabricates an N-node run dir with **shuffled** distinct
  ids (so the winner is not positional), launches the nodes, optionally kills the elected leader
  mid-run, then checks the trace against ground truth.
- `stress.sh [T]` — replicates over N∈{3,5,7} × {steady, leader-kill} × T trials.

## Properties (verified — see RESULTS.md)
- **Agreement / no split-brain** — all live nodes converge on the *same* leader; never two
  leaders in the same term.
- **Correct target** — the elected leader is the **max id** (after a kill, the max of survivors).
- **Failover** — kill the leader and the survivors autonomously re-elect the next-highest, no
  orchestrator. (Reliable-broadcast over the A2A inbox is what makes this hold.)

## Run
```bash
bash run_election.sh 3 8         # one steady 3-node election
bash run_election.sh 3 14 kill   # elect, kill the leader, watch re-election
bash stress.sh 5                 # full replicated battery
```

## Live-agent layer
See `RESULTS.md` for the demonstration with real heterogeneous roster agents (claude/codex/
gemini) electing a leader in natural language over A2A, no orchestrator.

## If it graduates
`ELECTION`/`COORDINATOR`/`HEARTBEAT` over `send all` is a thin protocol on top of the existing
primitive; a `agent-roster elect` helper (or a documented recipe) could make leaderless
coordinator selection first-class alongside the `board` work-division candidate.
