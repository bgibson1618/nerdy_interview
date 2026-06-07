#!/usr/bin/env bash
# Serialized, rate-limited gemini reviewer runner with retry-on-429/backoff.
# Runs ONE gemini reviewer at a time (never concurrent) with spacing between cells,
# and retries a cell that hit a rate/quota error after exponential backoff.
# Usage: run_gemini.sh <project:rep> [project:rep ...]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="$(cd "$HERE/.." && pwd)"
ROSTER=/home/bgibs/projects/agent_roster/bin/agent-roster
PROMPT="$HERE/reviewer_prompt.txt"
RUNS="$HERE/runs"; RESULTS="$HERE/results"
mkdir -p "$RUNS" "$RESULTS"
SPACING="${GEMINI_SPACING:-25}"     # seconds between successful cells
MAXRETRY="${GEMINI_RETRY:-5}"
MODEL="${GEMINI_MODEL:-gemini-3-flash-preview}"   # current flash; per-model quota with headroom

terminal_st() { case "$1" in done|done-no-output|failed|stopped) return 0;; *) return 1;; esac; }

run_one() { # project rep inst -> 0 ok / 1 fail
  local project=$1 rep=$2 inst=$3
  local runid="${project}-r${rep}-gemini${inst}"
  local attempt=0 st out base
  while :; do
    attempt=$((attempt + 1))
    local ws="$RUNS/$runid"; rm -rf "$ws"; mkdir -p "$ws"; cp -r "$CORPUS/$project/." "$ws/"
    base="$ws/work/agents/$runid/verifier"
    "$ROSTER" run reviewer --backend gemini --model "$MODEL" --workspace "$ws" --run-id "$runid" \
      --task-file "$PROMPT" --gemini-approval-mode yolo --close-on-exit >/dev/null 2>&1 || true
    local deadline=$(( $(date +%s) + 600 ))
    while :; do
      st="$(cat "$base/status" 2>/dev/null || echo running)"
      terminal_st "$st" && break
      (( $(date +%s) > deadline )) && { st=timeout; break; }
      sleep 8
    done
    out="$base/output.md"
    if [ -s "$out" ] && [ "$st" = done ]; then
      mkdir -p "$RESULTS/$project/rep$rep"; cp "$out" "$RESULTS/$project/rep$rep/gemini${inst}.md"
      echo "  OK $runid ($(wc -c < "$out")B, attempt $attempt)"; return 0
    fi
    if grep -qiE '429|quota|RESOURCE_EXHAUSTED|rate.?limit|exhausted' "$base/terminal.log" 2>/dev/null; then
      if (( attempt <= MAXRETRY )); then
        local backoff=$(( 30 * attempt ))
        echo "  rate-limited $runid (attempt $attempt, status=$st) -> backoff ${backoff}s"; sleep "$backoff"; continue
      fi
    fi
    echo "  FAIL $runid (status=$st after $attempt attempts)"; return 1
  done
}

for cell in "$@"; do
  project="${cell%%:*}"; rep="${cell##*:}"
  echo "=== gemini $project rep$rep ==="
  run_one "$project" "$rep" 1 || true
  sleep "$SPACING"
done
echo "=== gemini runs done ==="
find "$RESULTS" -name 'gemini*.md' | sort
