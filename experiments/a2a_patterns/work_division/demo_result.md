# Live-agent work-division demo — result

Two real claude agents (`worker1`, `worker2`) launched as peers in one roster run
(`run-role --peers`), self-organizing off a shared 8-task board with NO orchestrator.
They coordinate via (a) the atomic-claim board and (b) A2A broadcasts (`send all`).

## Outcome
- All 8 tasks done, **exactly-once** (8/8 distinct), split **4/4** between the agents.
- Claim interleaving (proves a genuine race, never a collision):
```
task -> worker
1	worker2
2	worker1
3	worker1
4	worker2
5	worker1
6	worker2
7	worker2
8	worker1
```
## A2A broadcasts exchanged (hardened v0.3 primitive, typed JSON envelopes)
### worker1 received (from worker2):
```
[2026-06-07T21:44:39Z] worker2 claimed task 1
[2026-06-07T21:44:39Z] worker2 finished 1 = 1
[2026-06-07T21:44:50Z] worker2 claimed task 4
[2026-06-07T21:44:51Z] worker2 finished 4 = 16
[2026-06-07T21:44:59Z] worker2 claimed task 6
[2026-06-07T21:44:59Z] worker2 finished 6 = 36
[2026-06-07T21:45:09Z] worker2 claimed task 7
[2026-06-07T21:45:09Z] worker2 finished 7 = 49
[2026-06-07T21:45:19Z] worker2: board drained, stopping
```
### worker2 received (from worker1):
```
[2026-06-07T21:44:33Z] worker1 claimed task 2
[2026-06-07T21:44:37Z] worker1 finished 2 = 4
[2026-06-07T21:44:44Z] worker1 claimed task 3
[2026-06-07T21:44:48Z] worker1 finished 3 = 9
[2026-06-07T21:44:55Z] worker1 claimed task 5
[2026-06-07T21:45:04Z] worker1 finished 5 = 25
[2026-06-07T21:45:10Z] worker1 claimed task 8
[2026-06-07T21:45:16Z] worker1 finished 8 = 64
[2026-06-07T21:45:23Z] worker1: board drained, stopping
```
_9 typed envelopes each way; all valid JSON. Both agents self-stopped on claiming EMPTY._
