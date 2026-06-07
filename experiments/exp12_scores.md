# Exp 1+2 scores (recall = distinct planted bugs found / 10)

## Exp 1 — neutral target (orchestrator-authored, 10 bugs)
| backend | rep1 | rep2 | rep3 | mean |
|---|---|---|---|---|
| codex  | 10 | 9 | 10 | 9.67 |
| claude | 10 | 10 | 10 | 10.0 |
| gemini | 8 | 7 | 8 | 7.67 |

## Exp 2 — claude-authored target (10 bugs)
| backend | rep1 | rep2 | rep3 | mean |
|---|---|---|---|---|
| codex  | 8 | 7 | 10 | 8.33 |
| claude | 9 | 10 | 10 | 9.67 |
| gemini | 8 | 8 | 8 | 8.0 |

## Precision / cry-wolf
- On both BUGGY targets: ~0 false positives — every flagged item was a real defect. codex's higher volume (14–20 items) = real secondary bugs, not noise.
- "Clean" control was NOT clean: all 3 backends independently found ~4 real bugs I left in (no-auth on /transfer & /users & /report; credit leg never checks affectedRows → funds destroyed if `to` invalid; DECIMAL string-concat in reduce; Express-4 async unhandled-rejection). ZERO hallucinations: nobody flagged the genuinely-fixed items (parameterized queries, randomBytes, finally-release) as still broken.

## Key findings
- Recall ranking: **claude (~10) > codex (~9) > gemini (~8)**.
- **gemini systematic blind spot:** missed B2 (SELECT* sensitive-data exposure) and B3 (missing authorization) on BOTH targets, every rep. Catches injection/secret/off-by-one/Math.random fine; misses authz + data-exposure.
- **No author blind-spot for claude-as-reviewer:** claude on claude-authored code = 9.67 ≈ claude on neutral = 10.
- But author blind-spot at the WRITING level is real: I (claude) shipped a "clean" file with ~4 real bugs; cross-backend review caught them all.
- Panel value: every single reviewer missed something on some run; union of any 2 backends ≈ 10/10.

## Exp 4 — autonomous peer-to-peer messaging: SUCCESS
- ALPHA (held SECRET=7) and BETA (held formula ANSWER=SECRET*6-2), non-interactive, bypassPermissions.
- ALPHA `note`d SECRET=7 → beta inbox (02:57:14); BETA polled, computed, `note`d ANSWER=40 → alpha inbox (02:57:22, +8s); both reported FINAL: 40 (correct). NO orchestrator relay.
- Enablers: peer label + exact `note` command + poll-the-inbox convention in the prompt; bypassPermissions so they run bash unattended.
- Gaps: no first-class A2A primitive — agents hand-rolled the inbox poll; peers/`note` are invisible in the default prompt; no delivery/notification (poll only).
