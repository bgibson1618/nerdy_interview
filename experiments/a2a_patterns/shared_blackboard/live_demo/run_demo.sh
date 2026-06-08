#!/usr/bin/env bash
# run_demo.sh — live-agent stigmergy demo. Three REAL heterogeneous roster agents
# (claude / codex / gemini-flash) build a shared stack fact-sheet, coordinating ONLY through
# the blackboard (no --peers, no messages). Sets up an isolated workspace, launches the agents,
# polls to completion, and harvests a demo_result.md artifact.
#   run_demo.sh [out.md]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROSTER="/home/bgibs/projects/agent_roster/bin/agent-roster"
OUT="${1:-$HERE/demo_result.md}"
RUN="bb-stig-demo"
SESS="bbdemo"
WS="$(mktemp -d /tmp/bb_live.XXXXXX)"

# --- workspace: bb + blackboard.sh + a seeded board (6 stack topics) ---
cp "$HERE/bb" "$HERE/../blackboard.sh" "$WS/"; chmod +x "$WS/bb" "$WS/blackboard.sh"
printf '%s\n' \
  '{"topic":"TypeScript structural typing"}' \
  '{"topic":"React reconciliation and hooks"}' \
  '{"topic":"MySQL InnoDB MVCC and isolation"}' \
  '{"topic":"gRPC streaming and deadlines"}' \
  '{"topic":"GraphQL N+1 and dataloader"}' \
  '{"topic":"OAuth 2.0 Authorization Code + PKCE"}' > "$WS/payloads.txt"
bash "$WS/blackboard.sh" seed "$WS/board.jsonl" 6 "$WS/payloads.txt"

task_for() { # name
  local n="$1"
  cat <<EOF
You are "$n", one of several agents collaboratively building a shared fact-sheet about a software
stack. CRITICAL: coordinate ONLY through the shared board — do NOT try to message, signal, or wait
on the other agents. The board is your only channel.

Run these from your current directory (use ./bb):
- ./bb claim $n          -> "SECTION <id>: <topic>" (you now own that section) or "EMPTY"
- ./bb post <id> $n <text>   -> record your summary for section <id>
- ./bb synth $n          -> "OK" (you may write the executive summary) or "NOPE"
- ./bb sections          -> list all section summaries posted so far
- ./bb final $n <text>   -> post the executive summary

Do exactly this:
1. Repeatedly run \`./bb claim $n\`. Each time you receive a SECTION, write a concise, factual
   2-3 sentence summary of that topic and run \`./bb post <id> $n <your summary>\`. Keep claiming
   until you get "EMPTY". Do not use double-quote characters in your summaries.
2. Once you get "EMPTY", run \`./bb synth $n\`. If it prints "OK", run \`./bb sections\`, write a
   3-4 sentence executive summary that ties the sections together, and run
   \`./bb final $n <your executive summary>\`. If it prints "NOPE", another agent is writing the
   synthesis — you are done.
3. End with a one-line report: which section ids you claimed, and whether you wrote the synthesis.
EOF
}

launch() { # name backend extra...
  local name="$1" backend="$2"; shift 2
  "$ROSTER" run researcher --backend "$backend" "$@" \
    --run-id "$RUN" --label "$name" --window "$name" --session "$SESS" \
    --workspace "$WS" --task "$(task_for "$name")" >/dev/null 2>&1
}

echo "workspace: $WS"
# gemini refuses headless runs in an "untrusted" folder (e.g. /tmp) even under yolo. Propagate
# the trust override through tmux's global environment so the gemini pane inherits it.
export GEMINI_CLI_TRUST_WORKSPACE=true
tmux set-environment -g GEMINI_CLI_TRUST_WORKSPACE true 2>/dev/null || true

launch alice claude --claude-permission-mode bypassPermissions
launch bob   codex  --codex-sandbox workspace-write
launch cleo  gemini --model gemini-3-flash-preview --gemini-approval-mode yolo

# --- poll to completion (terminal status for all three, or timeout) ---
deadline=$(( $(date +%s) + 420 ))
while :; do
  done_n=0
  for n in alice bob cleo; do
    s="$(cat "$WS/work/agents/$RUN/$n/status" 2>/dev/null || echo missing)"
    case "$s" in done|failed|done-no-output|stopped) done_n=$((done_n+1));; esac
  done
  (( done_n == 3 )) && break
  (( $(date +%s) >= deadline )) && { echo "TIMEOUT waiting for agents"; break; }
  sleep 5
done

# --- harvest ---
solved="$(bash "$WS/blackboard.sh" state "$WS/board.jsonl")"
synth_worker="$(jq -rs '.[]|select(.kind=="synthesis")|.worker // "none"' "$WS/board.jsonl")"
{
  echo "# Live-agent shared-blackboard (stigmergy) demo — result"
  echo
  echo "Three **real, heterogeneous** roster agents — \`alice\` (claude), \`bob\` (codex),"
  echo "\`cleo\` (gemini-3-flash) — built a shared stack fact-sheet coordinating **only through the"
  echo "blackboard**: no orchestrator, **no \`--peers\`, zero messages exchanged**. Pure stigmergy."
  echo
  echo "## Board outcome"
  echo '```'
  echo "$solved"
  echo '```'
  echo "Synthesis (executive summary) written by: **$synth_worker**"
  echo
  echo "## Who claimed which section (emergent division, no negotiation)"
  echo '```'
  jq -rs '.[]|select(.kind=="shard")|"[\(.id)] \(.payload.topic)  <-  \(.worker // "unclaimed")"' "$WS/board.jsonl"
  echo '```'
  echo
  echo "## The fact-sheet the agents built (Level-1 sections)"
  for id in 1 2 3 4 5 6; do
    topic="$(jq -rs --argjson i "$id" '.[]|select(.kind=="shard" and .id==$i)|.payload.topic' "$WS/board.jsonl")"
    who="$(jq -rs --argjson i "$id" '.[]|select(.kind=="shard" and .id==$i)|.worker // "?"' "$WS/board.jsonl")"
    text="$(jq -rs --argjson i "$id" '.[]|select(.kind=="shard" and .id==$i)|.partial.text // "(missing)"' "$WS/board.jsonl")"
    echo "### [$id] $topic — by $who"
    echo "$text"; echo
  done
  echo "## Level-2 synthesis (only postable once every section was done)"
  jq -rs '.[]|select(.kind=="synthesis")|.final.text // "(no synthesis)"' "$WS/board.jsonl"
  echo
  echo "## Stigmergy confirmation — were any A2A messages sent?"
  msgs="$(find "$WS/work/agents/$RUN" -name inbox.jsonl -exec cat {} \; 2>/dev/null | grep -c . || true)"
  echo "A2A inbox lines across all agents: **${msgs:-0}** (expected 0 — they never messaged; they"
  echo "coordinated entirely by reading/writing the shared board)."
  echo
  echo "## Per-agent self-reports"
  for n in alice bob cleo; do
    echo "### $n"
    echo '```'
    tail -n 8 "$WS/work/agents/$RUN/$n/output.md" 2>/dev/null || echo "(no output)"
    echo '```'
  done
} > "$OUT"

tmux set-environment -gu GEMINI_CLI_TRUST_WORKSPACE 2>/dev/null || true
echo "harvested -> $OUT"
echo "workspace kept at: $WS  (board.jsonl + run dirs)"
