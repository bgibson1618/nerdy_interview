# Live-agent leader-election demo — result

Three **real, heterogeneous** roster agents launched as **peers** (`--peers`) ran a
highest-id leader election over the hardened A2A primitive — **no orchestrator**. ids:
`alice` (claude) = 30, `bob` (codex) = 20, `cleo` (gemini-3-flash) = 10 → alice should win.

## Final status
```
alice: done
bob: done
cleo: done
```

## A2A envelopes each node received (the actual coordination traffic)
### alice received:
```
  [2026-06-08T00:09:31Z] cleo -> alice: ID=10 FROM=cleo
  [2026-06-08T00:09:43Z] bob -> alice: ID=20 FROM=bob
  [2026-06-08T00:10:42Z] bob -> alice: STATUS ready (bob)
```
### bob received:
```
  [2026-06-08T00:09:31Z] alice -> bob: ID=30 FROM=alice
  [2026-06-08T00:09:31Z] cleo -> bob: ID=10 FROM=cleo
  [2026-06-08T00:09:48Z] alice -> bob: LEADER=alice ID=30
  [2026-06-08T00:09:49Z] alice -> bob: TASK report-status
```
### cleo received:
```
  [2026-06-08T00:09:31Z] alice -> cleo: ID=30 FROM=alice
  [2026-06-08T00:09:43Z] bob -> cleo: ID=20 FROM=bob
  [2026-06-08T00:09:48Z] alice -> cleo: LEADER=alice ID=30
```
## Per-agent reports (who they concluded is leader)
### alice
```
   - Announced to `all`: `LEADER=alice ID=30`
   - Assigned task to bob: `TASK report-status`
   - (Waited for `STATUS ready` reply from bob; none received within timeout — optional confirmation only.)

## Final report
agreed leader = alice id 30; ids seen = 10, 20, 30
```
### bob
```
agreed leader = alice id 30; ids seen = bob:20, alice:30, cleo:10
```
### cleo
```
agreed leader = alice id 30; ids seen = 10, 20, 30
```
## Envelope count (hardened v0.3 typed JSON, no relay)
Total A2A messages delivered across all nodes: **10**.
