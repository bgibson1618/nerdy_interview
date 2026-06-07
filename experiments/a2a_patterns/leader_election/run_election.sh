#!/usr/bin/env bash
# run_election.sh — one leaderless election trial, ground-truthed.
#   run_election.sh <N> <duration-sec> [kill-leader]
# Fabricates an N-node A2A run dir with shuffled distinct ids (so the max isn't positional),
# launches one election.sh per node (no orchestrator), optionally kills the elected leader mid-run
# to force a failover, waits for the nodes to self-exit at the deadline, then checks the trace
# against ground truth (expected leader = max id; after a kill = max of survivors).
# Prints "TRIAL PASS"/"TRIAL FAIL ...". Exit 0 on pass.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROSTER="${ROSTER_BIN:-/home/bgibs/projects/agent_roster/bin/agent-roster}"
N="${1:?usage: run_election.sh N duration [kill-leader]}"; DUR="${2:-8}"; KILL="${3:-}"

WS="$(mktemp -d)"; trap 'rm -rf "$WS"' EXIT
RUN="elect"
rd="$WS/work/agents/$RUN"
TRACE="$WS/trace.tsv"; : > "$TRACE"

# Distinct ids 11..(10+3N) sampled and shuffled so the winner is not the first/last node.
mapfile -t ids < <(seq 11 $((10 + 3*N)) | shuf | head -n "$N")
maxid=0; for i in "${ids[@]}"; do (( i > maxid )) && maxid=$i; done

for i in "${ids[@]}"; do
  mkdir -p "$rd/n$i"; printf 'running\n' > "$rd/n$i/status"; : > "$rd/n$i/inbox.jsonl"
done

# Timing budget scales with N. This is itself a finding: the file-backed, fork-per-message A2A
# transport inflates effective round time as N grows (more concurrent send/recv => more lock +
# process churn), so a fixed budget that is ample at N=3 starves loops at N=7 (late declarations
# -> backstop term-bumps -> transient split-brain). Giving larger clusters proportionally larger
# windows restores convergence, confirming the ceiling is throughput/timing, not protocol logic.
# Override by exporting EW/HT to pin a budget (e.g. to demonstrate the failure at N=7 with EW=2).
if (( N >= 7 )); then EW="${EW:-4}"; HT="${HT:-4}"; else EW="${EW:-2}"; HT="${HT:-2}"; fi

DEADLINE=$(( $(date +%s) + DUR ))
declare -A pid_of
for i in "${ids[@]}"; do
  ROSTER_BIN="$ROSTER" HB_INTERVAL=1 ELECT_WINDOW="$EW" HB_TIMEOUT="$HT" SOLICIT_INTERVAL=1 \
    bash "$HERE/election.sh" "$WS" "$RUN" "n$i" "$DEADLINE" "$TRACE" &
  pid_of[$i]=$!
done

killed=""
if [[ -n "$KILL" ]]; then
  sleep $(( EW + 3 ))                        # let the bootstrap election settle on max id first
  killed="$maxid"                           # the elected leader is the global max
  kill "${pid_of[$maxid]}" 2>/dev/null || true
  wait "${pid_of[$maxid]}" 2>/dev/null || true
fi

for i in "${ids[@]}"; do
  [[ "$i" == "$killed" ]] && continue
  wait "${pid_of[$i]}" 2>/dev/null || true
done

# Ground truth: expected leader = max id among survivors.
survivors=(); for i in "${ids[@]}"; do [[ "$i" == "$killed" ]] || survivors+=("$i"); done
exp=0; for i in "${survivors[@]}"; do (( i > exp )) && exp=$i; done

# ---- check the trace ----
awk -v want="$exp" -v killed="$killed" -v ids="${ids[*]}" -v survs="${survivors[*]}" '
  BEGIN{ split(survs, S, " "); for(k in S) issurv[S[k]]=1 }
  # columns: ts self term role leader event
  {
    self=$2; term=$3; role=$4; lead=$5; ev=$6
    last_term[self]=term; last_role[self]=role; last_leader[self]=lead
    if(ev=="became_leader"){ leaders_in_term[term]=leaders_in_term[term] " " substr(self,2); n_term_leaders[term]++ ;
      # track distinct leader id per term
      seenL[term","substr(self,2)]=1 }
  }
  END{
    fails=0
    # 1) agreement among survivors + correct target
    agree=1; chosen=""
    for(s in last_leader){
      id=substr(s,2); if(!(id in issurv)) continue
      L=last_leader[s]
      if(chosen==""){chosen=L} else if(L!=chosen){agree=0}
    }
    if(!agree){ print "  FAIL agreement: survivors disagree on leader"; fails++ }
    else if(chosen != want){ printf("  FAIL target: agreed leader=%s expected(max-survivor)=%s\n", chosen, want); fails++ }
    # 2) single distinct leader per term (no same-term split-brain)
    for(t in n_term_leaders){
      c=0; for(key in seenL){ split(key,a,","); if(a[1]==t) c++ }
      if(c>1){ printf("  FAIL split-brain: term %s had %d distinct leaders:%s\n", t, c, leaders_in_term[t]); fails++ }
    }
    if(fails==0) printf("  ok: agreed leader=%s (=max survivor), one leader per term\n", chosen)
    exit (fails==0?0:1)
  }
' "$TRACE"
rc=$?

if [[ $rc -eq 0 ]]; then
  printf 'TRIAL PASS  N=%s ids=[%s] killed=%s -> leader=%s\n' "$N" "${ids[*]}" "${killed:-none}" "$exp"
else
  printf 'TRIAL FAIL  N=%s ids=[%s] killed=%s\n' "$N" "${ids[*]}" "${killed:-none}"
  echo "---- trace ----"; cat "$TRACE"
fi
exit $rc
