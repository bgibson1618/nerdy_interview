#!/usr/bin/env bash
# bb_worker.sh — ONE knowledge source for the shared-blackboard pattern. It watches the board
# and contributes where it can, with NO orchestrator and NO direct messages (pure stigmergy):
#   claim an open shard -> compute its per-category partial -> post it; and once it observes the
#   board is complete, race to claim the single synthesis slot and post the merged final answer.
#   bb_worker.sh <board> <worker-id>
# Optional WORKER_DELAY=<seconds> simulates a slow worker (to observe emergent load-balance).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BB="$HERE/blackboard.sh"
board="${1:?board}"; self="${2:?worker id}"
delay="${WORKER_DELAY:-0}"

while :; do
  # solved? then stop.
  state="$("$BB" state "$board")"
  [[ "$state" == *"solved=yes"* ]] && break

  res="$("$BB" claim-shard "$board" "$self")"
  if [[ "$res" != "EMPTY" ]]; then
    id="${res%%$'\t'*}"; payload="${res#*$'\t'}"
    # Level-1 contribution: per-category subtotal for this shard.
    partial="$(jq -cn --argjson p "$payload" 'reduce $p[] as $x ({}; .[$x.cat] += $x.amt)')"
    [[ "$delay" != "0" ]] && sleep "$delay"
    "$BB" post-partial "$board" "$id" "$self" "$partial"
    continue
  fi

  # No open shard. Either peers still hold claimed shards, or every shard is done.
  if [[ "$("$BB" claim-synthesis "$board" "$self")" == "OK" ]]; then
    # Level-2 synthesis: merge all shard partials into per-category totals + grand total.
    final="$(jq -cs '
      [ .[] | select(.kind=="shard") | .partial ]
      | reduce .[] as $p ({}; reduce ($p|to_entries[]) as $e (.; .[$e.key] += $e.value))
      | { by_cat: ., total: (to_entries | map(.value) | add) }
    ' "$board")"
    "$BB" post-final "$board" "$self" "$final"
    break
  fi

  sleep 0.05   # brief backoff while peers finish their claimed shards
done
