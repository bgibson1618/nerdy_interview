#!/usr/bin/env bash
# Stress the leaderless work-division board: K concurrent workers drain a shared
# list of N tasks. Verify the exactly-once + full-coverage + balance properties
# under real contention. Repeats several trials to shake out races.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOARD="$HERE/board.sh"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

trial() { # K N
  local K="$1" N="$2" d board claims
  d="$(mktemp -d)"; board="$d/board.jsonl"; claims="$d/claims.log"; : > "$claims"
  bash "$BOARD" init "$board" "$N"
  for w in $(seq 1 "$K"); do
    ( while :; do
        id="$(bash "$BOARD" claim "$board" "w$w")"
        [ "$id" = EMPTY ] && break
        printf '%s\tw%s\n' "$id" "$w" >> "$claims"     # record who claimed what
        bash "$BOARD" done "$board" "$id" "w$w"
      done ) &
  done
  wait
  local claimed distinct done_count
  claimed="$(wc -l < "$claims" | tr -d ' ')"
  distinct="$(cut -f1 "$claims" | sort -u | wc -l | tr -d ' ')"
  done_count="$(bash "$BOARD" status "$board" | awk '/done/{print $1}')"
  local dupes; dupes="$(cut -f1 "$claims" | sort | uniq -d | wc -l | tr -d ' ')"
  echo "  trial K=$K N=$N: claims=$claimed distinct=$distinct done=$done_count dup-ids=$dupes  | per-worker: $(cut -f2 "$claims" | sort | uniq -c | tr '\n' ' ')"
  [ "$claimed" = "$N" ] && [ "$distinct" = "$N" ] && [ "${done_count:-0}" = "$N" ] && [ "$dupes" = 0 ] && echo PASS || echo FAIL
  rm -rf "$d"
}

echo "== leaderless work-division: exactly-once stress =="
for t in "5 20" "8 50" "3 30" "10 100" "6 7"; do
  set -- $t
  r="$(trial "$1" "$2" | tail -1)"
  if [ "$r" = PASS ]; then ok "K=$1 N=$2 — every task claimed by exactly one worker, all done"; else bad "K=$1 N=$2 — exactly-once violated"; fi
done
echo
echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
