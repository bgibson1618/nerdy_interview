#!/usr/bin/env bash
# Leaderless work-division board: a shared JSONL task list with an ATOMIC claim.
# This is the shared-state complement to the A2A message primitive — workers
# self-organize off one list with no orchestrator handing out work. The claim is
# a flock-guarded read-find-open-mark-write, so two workers never claim the same
# task (the exactly-once property).
#
#   board.sh init   <board> <n>            create n open tasks
#   board.sh claim  <board> <worker>       atomically claim the next open task -> prints id or EMPTY
#   board.sh done   <board> <id> [result]  mark a claimed task done
#   board.sh status <board>                counts by status
#   board.sh dump   <board>                show id -> worker for done tasks
set -euo pipefail
cmd="${1:?init|claim|done|status|dump}"; board="${2:?board path}"; shift 2 || true
lock="$board.lock"

case "$cmd" in
  init)
    n="${1:?count}"; : > "$board"
    for i in $(seq 1 "$n"); do
      printf '{"id":%d,"status":"open","worker":null,"result":null}\n' "$i" >> "$board"
    done ;;
  claim)
    worker="${1:?worker}"
    exec 9>>"$lock"; flock 9                       # serialize the whole read-modify-write
    id="$(jq -r 'select(.status=="open")|.id' "$board" 2>/dev/null | head -1)"
    if [ -z "$id" ]; then echo "EMPTY"; exit 0; fi
    tmp="$(mktemp)"
    jq -c --argjson id "$id" --arg w "$worker" \
      'if .id==$id then .status="claimed" | .worker=$w else . end' "$board" > "$tmp"
    mv "$tmp" "$board"
    echo "$id" ;;
  done)
    id="${1:?id}"; result="${2:-ok}"
    exec 9>>"$lock"; flock 9
    tmp="$(mktemp)"
    jq -c --argjson id "$id" --arg r "$result" \
      'if .id==$id then .status="done" | .result=$r else . end' "$board" > "$tmp"
    mv "$tmp" "$board" ;;
  status)
    jq -r '.status' "$board" | sort | uniq -c ;;
  dump)
    jq -r 'select(.status=="done")|"\(.id)\t\(.worker)"' "$board" | sort -n ;;
  *) echo "unknown: $cmd" >&2; exit 2 ;;
esac
