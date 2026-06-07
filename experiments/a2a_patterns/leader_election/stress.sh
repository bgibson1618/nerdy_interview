#!/usr/bin/env bash
# stress.sh — replicated leader-election stress per PREREG.md. Runs T trials of each
# (N, mode) config and tallies the pre-registered pass bar: 100% agreement, correct target
# (max survivor), one leader per term (no same-term split-brain), correct failover.
#   stress.sh [T]    (default T=5)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="${1:-5}"
PASS=0; FAIL=0; FAILED_TRIALS=()

run_cfg() { # N mode
  local N="$1" mode="$2" t out rc nodur killdur
  # Duration scales with N: the transport inflates round time as N grows (see run_election.sh).
  if (( N >= 7 )); then nodur=15; killdur=26; else nodur=9; killdur=16; fi
  for t in $(seq 1 "$T"); do
    if [[ "$mode" == kill ]]; then
      out="$(timeout $((killdur+10)) bash "$HERE/run_election.sh" "$N" "$killdur" kill 2>&1)"; rc=$?
    else
      out="$(timeout $((nodur+10)) bash "$HERE/run_election.sh" "$N" "$nodur" 2>&1)"; rc=$?
    fi
    if [[ $rc -eq 0 ]] && grep -q "TRIAL PASS" <<<"$out"; then
      PASS=$((PASS+1)); printf '  PASS  N=%s %-7s trial %s/%s  %s\n' "$N" "$mode" "$t" "$T" "$(grep -o 'leader=[0-9]*' <<<"$out" | tail -1)"
    else
      FAIL=$((FAIL+1)); FAILED_TRIALS+=("N=$N $mode trial $t")
      printf '  FAIL  N=%s %-7s trial %s/%s\n' "$N" "$mode" "$t" "$T"
      printf '%s\n' "$out" | sed 's/^/        /'
    fi
  done
}

echo "== leader-election stress: T=$T trials per config =="
for N in 3 5 7; do
  echo "-- N=$N, steady-state (no failure) --"; run_cfg "$N" steady
  echo "-- N=$N, leader-kill failover --";       run_cfg "$N" kill
done
echo
echo "== $PASS passed, $FAIL failed =="
if (( FAIL > 0 )); then printf 'failed: %s\n' "${FAILED_TRIALS[*]}"; fi
[[ $FAIL -eq 0 ]]
