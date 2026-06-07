#!/usr/bin/env bash
# bb_stress.sh — replicated shared-blackboard stress per PREREG.md. Runs T trials of each
# (S,K) config and tallies the pre-registered bar: 0 lost entries, 0 double-work, exactly one
# synthesis, final == ground truth, synthesis-after-completeness — every trial. Includes a
# speed-skew config to observe emergent load-balance.
#   bb_stress.sh [T]   (default T=5)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="${1:-5}"
PASS=0; FAIL=0; FAILED=()

run_cfg() { # S K [skew]
  local S="$1" K="$2" skew="${3:-}" t out rc
  for t in $(seq 1 "$T"); do
    out="$(timeout 40 bash "$HERE/run_blackboard.sh" "$S" "$K" $skew 2>&1)"; rc=$?
    if [[ $rc -eq 0 ]] && grep -q "TRIAL PASS" <<<"$out"; then
      PASS=$((PASS+1)); printf '  PASS  S=%s K=%s%-5s trial %s/%s  %s\n' "$S" "$K" "${skew:+ skew}" "$t" "$T" \
        "$(grep -o 'balance:\[.*\]' <<<"$out")"
    else
      FAIL=$((FAIL+1)); FAILED+=("S=$S K=$K $skew trial $t")
      printf '  FAIL  S=%s K=%s%s trial %s/%s\n' "$S" "$K" "${skew:+ skew}" "$t" "$T"
      printf '%s\n' "$out" | sed 's/^/        /'
    fi
  done
}

echo "== shared-blackboard stress: T=$T trials per config =="
echo "-- (S=6,  K=3) --";  run_cfg 6  3
echo "-- (S=10, K=4) --";  run_cfg 10 4
echo "-- (S=12, K=6) --";  run_cfg 12 6
echo "-- (S=10, K=4) speed-skew --"; run_cfg 10 4 skew
echo
echo "== $PASS passed, $FAIL failed =="
if (( FAIL > 0 )); then printf 'failed: %s\n' "${FAILED[*]}"; fi
[[ $FAIL -eq 0 ]]
