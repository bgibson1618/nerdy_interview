# A2A pattern: leaderless work-division

The first of the "self-organizing" A2A patterns. Workers drain a shared task list with **no
orchestrator** handing out work — the complement to the message-passing primitive: where
`send`/`recv`/`request`/`gather` are point-to-point coordination, this is **shared-state**
coordination.

## Mechanism
`board.sh` — a shared JSONL task list with one load-bearing operation: an **atomic claim**
(`flock`-guarded read-find-open-mark-write). Because the whole read-modify-write is serialized,
two workers can never claim the same task. Workers loop: `claim` → do the task → `done`, until the
board is `EMPTY`. (Same atomicity guarantee the hardened A2A inbox is built on, applied to shared
state instead of a message log.)

## Properties (verified)
- **Exactly-once** — every task is claimed by exactly one worker; no double-claims. Stress-tested
  in `test_exactly_once.sh` across 5 trials up to 10 workers × 100 tasks: 0 violations.
- **Full coverage** — the pool always drains the whole list.
- **Emergent load-balancing** — with speed-skewed workers (no balancing logic), faster workers
  automatically do more: a 4-worker run at speeds 0.005/0.01/0.02/0.05s split 30 tasks 10/9/7/4.
  Pull-based work-stealing falls out of the atomic claim for free.

## Run
```bash
bash test_exactly_once.sh          # the exactly-once / coverage stress test
bash board.sh init board.jsonl 12  # then `claim`/`done`/`status`/`dump`
```

## Live-agent layer (next step)
The deterministic mechanism is proven above with concurrent shell workers. The full A2A demo adds
**real roster agents** that (a) claim off this board and (b) **announce** claims/completions to
peers via the A2A primitive (`send all` / `recv`), launched with `run-role --peers` in one run so
they discover each other — self-organizing with no orchestrator relay.

## If it graduates
`claim`/`done` on a shared board is a natural candidate to become first-class `agent-roster`
commands (a `board` subcommand) alongside the A2A messaging — same `flock` discipline, same
work/agents run layout.
