#!/usr/bin/env bash
# run_blackboard.sh — one ground-truthed shared-blackboard trial.
#   run_blackboard.sh <shards> <workers> [skew]
# Generates a random transaction set split into <shards> shards, computes the TRUE per-category
# totals independently, seeds the board, runs <workers> stigmergic bb_workers concurrently (no
# orchestrator), then checks the board's final answer + the pre-registered safety properties.
# `skew` gives workers staggered delays to observe emergent load-balance. Prints TRIAL PASS/FAIL.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB="$HERE/blackboard.sh"
S="${1:?shards}"; K="${2:?workers}"; SKEW="${3:-}"
WS="$(mktemp -d)"; trap 'rm -rf "$WS"' EXIT
board="$WS/board.jsonl"; payloads="$WS/payloads.jsonl"; truth="$WS/truth.json"
cats=(A B C D)

# --- generate shards of random {cat,amt} and the independent ground truth ---
: > "$payloads"; : > "$WS/all.jsonl"
for ((i=1;i<=S;i++)); do
  rows=$(( (RANDOM % 5) + 3 ))     # 3..7 transactions per shard
  shard="["
  for ((r=0;r<rows;r++)); do
    c="${cats[$((RANDOM % ${#cats[@]}))]}"; a=$(( (RANDOM % 100) + 1 ))
    shard+="{\"cat\":\"$c\",\"amt\":$a},"
    printf '{"cat":"%s","amt":%d}\n' "$c" "$a" >> "$WS/all.jsonl"
  done
  shard="${shard%,}]"
  printf '%s\n' "$shard" >> "$payloads"
done
jq -cs 'reduce .[] as $x ({}; .[$x.cat] += $x.amt) | { by_cat: ., total: (to_entries|map(.value)|add) }' \
  "$WS/all.jsonl" > "$truth"

"$BB" seed "$board" "$S" "$payloads"

# --- run K stigmergic workers concurrently, no orchestrator ---
pids=()
for ((w=1;w<=K;w++)); do
  if [[ -n "$SKEW" ]]; then d="$(awk -v w="$w" 'BEGIN{printf "%.3f", w*0.02}')"; else d=0; fi
  WORKER_DELAY="$d" bash "$HERE/bb_worker.sh" "$board" "w$w" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" 2>/dev/null || true; done

# --- check against ground truth + pre-registered properties ---
final="$(jq -c 'select(.kind=="synthesis")|.final' "$board")"
rc=0; msgs=()

# 1) no lost entries: all S shards present and done
ndone="$(jq -r 'select(.kind=="shard" and .status=="done")|.id' "$board" | wc -l | tr -d ' ')"
[[ "$ndone" == "$S" ]] || { msgs+=("FAIL lost-entries: $ndone/$S shards done"); rc=1; }

# 2) no double-work: each shard has exactly one worker and is done exactly once
dupes="$(jq -r 'select(.kind=="shard")|.id' "$board" | sort | uniq -d | wc -l | tr -d ' ')"
[[ "$dupes" == 0 ]] || { msgs+=("FAIL double-work: duplicate shard ids"); rc=1; }

# 3) synthesis-once: exactly one synthesis, done, non-null final
nsyn="$(jq -r 'select(.kind=="synthesis")|.status' "$board" | grep -c done || true)"
[[ "$nsyn" == 1 && "$final" != "null" ]] || { msgs+=("FAIL synthesis-once: nsyn=$nsyn final=$final"); rc=1; }

# 4) correctness vs ground truth
if jq -e --slurpfile t "$truth" --argjson f "$final" -n '$f == $t[0]' >/dev/null 2>&1; then :; else
  msgs+=("FAIL correctness: board=$final truth=$(cat "$truth")"); rc=1
fi

# 5) stigmergy: synthesis claim_ts is AFTER the last shard done_ts (reacted to completeness)
synclaim="$(jq -r 'select(.kind=="synthesis")|.claim_ts' "$board")"
lastdone="$(jq -rs '[.[]|select(.kind=="shard")|.done_ts|tonumber]|max' "$board")"
if awk -v a="$synclaim" -v b="$lastdone" 'BEGIN{exit !(a+0 >= b+0)}'; then :; else
  msgs+=("FAIL stigmergy: synthesis claimed ($synclaim) before last shard done ($lastdone)"); rc=1
fi

# emergent balance (informational): per-worker shard counts
balance="$(jq -r 'select(.kind=="shard")|.worker' "$board" | sort | uniq -c | tr '\n' ' ')"

if [[ $rc -eq 0 ]]; then
  printf 'TRIAL PASS  S=%s K=%s%s  total=%s  balance:[%s]\n' \
    "$S" "$K" "${SKEW:+ skew}" "$(jq -r '.total' <<<"$final")" "$balance"
else
  printf 'TRIAL FAIL  S=%s K=%s\n' "$S" "$K"; printf '   %s\n' "${msgs[@]}"
  echo "   board:"; "$BB" dump "$board" | sed 's/^/     /'
fi
exit $rc
