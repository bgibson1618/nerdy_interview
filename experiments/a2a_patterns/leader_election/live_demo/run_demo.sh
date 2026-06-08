#!/usr/bin/env bash
# run_demo.sh — live-agent leader-election demo. Three REAL heterogeneous roster agents,
# launched as PEERS (--peers), run a highest-id election using ONLY A2A messages — no
# orchestrator. ids are assigned so the election is deterministic (claude=30 wins), then the
# leader assigns a task over A2A. Harvests the actual A2A envelopes exchanged into demo_result.md.
#   run_demo.sh [out.md]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROSTER="/home/bgibs/projects/agent_roster/bin/agent-roster"
OUT="${1:-$HERE/demo_result.md}"
RUN="elect-demo"
SESS="electdemo"
WS="$(mktemp -d /tmp/elect_live.XXXXXX)"

task_for() { # name id
  local n="$1" id="$2"
  cat <<EOF
You are node "$n" with election id $id. You are one of 3 nodes in a peer group with NO
coordinator. Your job: elect a single leader = the node with the HIGHEST id, using ONLY the A2A
peer-messaging commands described above (send / recv). Do NOT assume who the others are.

Do exactly this, step by step:
1. Announce your id by sending to the special peer \`all\` the EXACT body: ID=$id FROM=$n
2. Collect the other nodes' ids. There are 3 nodes total, so you must receive ids from the 2
   OTHER nodes. Repeatedly run your recv command WITH --wait and read every "ID=.. FROM=.."
   message until you have both peers' ids. Be patient — a peer may take a while to start.
3. Decide using the highest id among {your id $id} ∪ {the two ids you received}:
   - If YOUR id ($id) is the highest, you are the leader. Send to \`all\` the EXACT body:
     LEADER=$n ID=$id . Then assign a task: send ONE specific peer the body: TASK report-status
   - If your id is NOT the highest, run recv --wait until you receive a "LEADER=.." message;
     record the leader. If you receive a "TASK .." addressed to you, reply to the leader with
     the body: STATUS ready ($n)
4. Finish with a one-line report: "agreed leader = <name> id <id>; ids seen = <list>".

Keep every message body short and exactly in the formats above.
EOF
}

launch() { # name backend id extra...
  local name="$1" backend="$2" id="$3"; shift 3
  "$ROSTER" run researcher --backend "$backend" --peers "$@" \
    --run-id "$RUN" --label "$name" --window "$name" --session "$SESS" \
    --workspace "$WS" --task "$(task_for "$name" "$id")" >/dev/null 2>&1
}

echo "workspace: $WS"
export GEMINI_CLI_TRUST_WORKSPACE=true
tmux set-environment -g GEMINI_CLI_TRUST_WORKSPACE true 2>/dev/null || true

launch alice claude 30 --claude-permission-mode bypassPermissions
launch bob   codex  20 --codex-sandbox workspace-write
launch cleo  gemini 10 --model gemini-3-flash-preview --gemini-approval-mode yolo

# --- poll to completion ---
deadline=$(( $(date +%s) + 420 ))
while :; do
  done_n=0
  for n in alice bob cleo; do
    s="$(cat "$WS/work/agents/$RUN/$n/status" 2>/dev/null || echo missing)"
    case "$s" in done|failed|done-no-output|stopped) done_n=$((done_n+1));; esac
  done
  (( done_n == 3 )) && break
  (( $(date +%s) >= deadline )) && { echo "TIMEOUT"; break; }
  sleep 5
done
tmux set-environment -gu GEMINI_CLI_TRUST_WORKSPACE 2>/dev/null || true

# --- harvest the A2A envelopes + reports ---
decode_inbox() { # role
  local d="$WS/work/agents/$RUN/$1/inbox.jsonl"
  [[ -s "$d" ]] && jq -r '"  [\(.ts)] \(.from) -> \(.to // "?"): \(.body)"' "$d" 2>/dev/null || echo "  (none)"
}
{
  echo "# Live-agent leader-election demo — result"
  echo
  echo "Three **real, heterogeneous** roster agents launched as **peers** (\`--peers\`) ran a"
  echo "highest-id leader election over the hardened A2A primitive — **no orchestrator**. ids:"
  echo "\`alice\` (claude) = 30, \`bob\` (codex) = 20, \`cleo\` (gemini-3-flash) = 10 → alice should win."
  echo
  echo "## Final status"
  echo '```'
  for n in alice bob cleo; do echo "$n: $(cat "$WS/work/agents/$RUN/$n/status" 2>/dev/null)"; done
  echo '```'
  echo
  echo "## A2A envelopes each node received (the actual coordination traffic)"
  for n in alice bob cleo; do
    echo "### $n received:"
    echo '```'
    decode_inbox "$n"
    echo '```'
  done
  echo "## Per-agent reports (who they concluded is leader)"
  for n in alice bob cleo; do
    echo "### $n"
    echo '```'
    tail -n 6 "$WS/work/agents/$RUN/$n/output.md" 2>/dev/null || echo "(no output)"
    echo '```'
  done
  echo "## Envelope count (hardened v0.3 typed JSON, no relay)"
  tot="$(find "$WS/work/agents/$RUN" -name inbox.jsonl -exec cat {} \; 2>/dev/null | grep -c . || true)"
  echo "Total A2A messages delivered across all nodes: **${tot:-0}**."
} > "$OUT"
echo "harvested -> $OUT"
echo "workspace kept at: $WS"
