#!/usr/bin/env bash
# Drift-detection reviewer driver. Runs the configured cells, one cell at a time,
# each as N isolated roster reviewer runs, then harvests every output.md into results/.
# Usage: run_reviews.sh <backendspec> <project:rep ...>
#   backendspec e.g. "claude:3 codex:1"  (backend:instance-count)
# Defaults to the 16 claude+codex runs across both projects x 2 reps.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$(cd "$HERE/.." && pwd)"
ROSTER=/home/bgibs/projects/agent_roster/bin/agent-roster
PROMPT="$HERE/reviewer_prompt.txt"
RUNS="$HERE/runs"; RESULTS="$HERE/results"
mkdir -p "$RUNS" "$RESULTS"

BACKENDSPEC="${1:-claude:3 codex:1}"
shift || true
CELLS=("$@"); [ ${#CELLS[@]} -gt 0 ] || CELLS=(taskflow-api:1 taskflow-api:2 pulse-dashboard:1 pulse-dashboard:2)

perm_for() { case "$1" in
  codex)  printf -- '--codex-sandbox\nworkspace-write\n';;
  claude) printf -- '--claude-permission-mode\nbypassPermissions\n';;
  gemini) printf -- '--gemini-approval-mode\nyolo\n';;
esac; }

launch_one() { # project rep backend inst -> echoes runid
  local project=$1 rep=$2 backend=$3 inst=$4
  local runid="${project}-r${rep}-${backend}${inst}"
  local ws="$RUNS/$runid"
  rm -rf "$ws"; mkdir -p "$ws"; cp -r "$CORPUS/$project/." "$ws/"
  mapfile -t perm < <(perm_for "$backend")
  "$ROSTER" run reviewer --backend "$backend" --workspace "$ws" --run-id "$runid" \
    --task-file "$PROMPT" "${perm[@]}" --close-on-exit >/dev/null 2>&1 || true
  printf '%s' "$runid"
}

terminal_st() { case "$1" in done|done-no-output|failed|stopped) return 0;; *) return 1;; esac; }

wait_cell() { # runids...
  local deadline=$(( $(date +%s) + 900 ))
  while :; do
    local pending=0 runid st
    for runid in "$@"; do
      st="$(cat "$RUNS/$runid/work/agents/$runid/verifier/status" 2>/dev/null || echo running)"
      terminal_st "$st" || pending=$((pending+1))
    done
    (( pending == 0 )) && break
    (( $(date +%s) > deadline )) && { echo "  [timeout] $pending still pending"; break; }
    sleep 10
  done
}

harvest() { # project rep backend inst
  local project=$1 rep=$2 backend=$3 inst=$4
  local runid="${project}-r${rep}-${backend}${inst}"
  local base="$RUNS/$runid/work/agents/$runid/verifier"
  local dest="$RESULTS/$project/rep$rep"; mkdir -p "$dest"
  local st; st="$(cat "$base/status" 2>/dev/null || echo '?')"
  if [ -s "$base/output.md" ]; then
    cp "$base/output.md" "$dest/${backend}${inst}.md"
    echo "  harvested ${backend}${inst} ($(wc -c < "$base/output.md")B, status=$st)"
  else
    [ -f "$base/terminal.log" ] && cp "$base/terminal.log" "$dest/${backend}${inst}.FALLBACK.log"
    echo "  MISSING output.md for ${backend}${inst} (status=$st) -> saved terminal.log"
  fi
}

for cell in "${CELLS[@]}"; do
  project="${cell%%:*}"; rep="${cell##*:}"
  echo "=== cell $project rep$rep ($BACKENDSPEC) ==="
  rids=(); declare -a plan=()
  for bs in $BACKENDSPEC; do
    backend="${bs%%:*}"; count="${bs##*:}"
    for inst in $(seq 1 "$count"); do
      rid="$(launch_one "$project" "$rep" "$backend" "$inst")"
      rids+=("$rid"); plan+=("$backend $inst")
      echo "  launched $rid"
    done
  done
  wait_cell "${rids[@]}"
  for pi in "${plan[@]}"; do set -- $pi; harvest "$project" "$rep" "$1" "$2"; done
done
echo "=== DONE: harvested reports ==="
find "$RESULTS" -name '*.md' | sort
