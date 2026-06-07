#!/usr/bin/env bash
# election.sh — ONE node of a leaderless, term-based, highest-id-wins leader election that
# coordinates ONLY through the hardened A2A messaging primitive (send all / recv). No
# orchestrator. See PREREG.md. A node autonomously: triggers an election, collects peers'
# candidacies via reliable broadcast, the global-max id declares itself COORDINATOR, the
# leader emits HEARTBEATs, and a follower that stops hearing them re-elects at the next term.
#
#   election.sh <workspace> <run-id> <self-role> <deadline-epoch> <trace-file>
#
# Self-role is like "n5"; the integer id is the numeric suffix. Peers are discovered from the
# run dir via `agent-roster peers` (every other node), so the node set is data, not a flag.
set -uo pipefail
ROSTER="${ROSTER_BIN:-/home/bgibs/projects/agent_roster/bin/agent-roster}"

WS="$1"; RUN="$2"; SELF="$3"; DEADLINE="$4"; TRACE="$5"
MYID="${SELF#n}"

HB_INTERVAL="${HB_INTERVAL:-1}"     # leader emits a heartbeat at least this often (s)
ELECT_WINDOW="${ELECT_WINDOW:-2}"   # candidate collects rivals for this long before declaring (s)
HB_TIMEOUT="${HB_TIMEOUT:-3}"       # follower re-elects if no heartbeat for this long (s)
SOLICIT_INTERVAL="${SOLICIT_INTERVAL:-1}"  # a losing candidate re-asks this often (closes the
                                    # liveness gap: a non-max candidate that MISSED the single
                                    # COORDINATOR broadcast must keep soliciting or it strands)

term=0; role="follower"; leader=""
declare -A maxid_for_term           # term -> max candidate id seen
candidate_since=0; last_solicit=0; last_hb_sent=0

now() { date +%s; }                 # integer epoch is enough at these timescales
trace() { # event
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%s.%N)" "$SELF" "$term" "$role" "${leader:-none}" "$1" >> "$TRACE"
}
bcast() { # body — broadcast to every peer ('all' is the <to> target, after the run id)
  "$ROSTER" send --workspace "$WS" --from "$SELF" --type inform "$RUN" all "$1" >/dev/null 2>&1 || true
}

note_candidate() { # term id
  local t="$1" id="$2" cur="${maxid_for_term[$1]:-0}"
  (( id > cur )) && maxid_for_term[$t]=$id
}

start_election() { # term
  term="$1"; role="candidate"; leader=""
  note_candidate "$term" "$MYID"
  candidate_since="$(now)"
  trace "start_election"
  bcast "ELECTION term=$term id=$MYID"
}

# Bootstrap: everyone opens term 1 as a candidate. The max id will win; the rest defer.
start_election 1
last_hb="$(now)"

while :; do
  (( $(now) >= DEADLINE )) && { trace "deadline"; break; }

  # Drain whatever the primitive delivered since our cursor (bounded wait doubles as our pacing).
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    body="$(printf '%s' "$line" | jq -r '.body' 2>/dev/null)"
    [[ -z "$body" || "$body" == "null" ]] && continue
    kind="${body%% *}"
    mt="$(printf '%s' "$body" | sed -n 's/.*term=\([0-9]\+\).*/\1/p')"
    mid="$(printf '%s' "$body" | sed -n 's/.*id=\([0-9]\+\).*/\1/p')"
    mlead="$(printf '%s' "$body" | sed -n 's/.*leader=\([0-9]\+\).*/\1/p')"
    [[ -z "$mt" ]] && continue
    case "$kind" in
      ELECTION)
        if (( mt > term )); then start_election "$mt"; fi          # someone opened a newer term
        if (( mt == term )); then
          note_candidate "$mt" "${mid:-0}"
          if [[ "$role" == "leader" ]]; then
            bcast "COORDINATOR term=$term id=$MYID leader=$MYID"    # re-announce to whoever is (re)asking
          elif [[ "$role" == "candidate" && "${mid:-0}" -lt "$MYID" ]]; then
            bcast "ELECTION term=$term id=$MYID"                    # answer a lower rival so it learns we outrank it
          fi
        fi
        ;;
      COORDINATOR)
        if (( mt >= term )); then
          term="$mt"; leader="${mlead:-$mid}"
          if [[ "$leader" == "$MYID" ]]; then role="leader"; else role="follower"; fi
          last_hb="$(now)"; trace "coordinator_seen"
        fi
        ;;
      HEARTBEAT)
        if (( mt >= term )) && [[ "${mlead:-}" == "${leader:-x}" || -z "${leader:-}" ]]; then
          term="$mt"; leader="${mlead:-$leader}"; role="follower"; last_hb="$(now)"
        fi
        ;;
    esac
  done < <("$ROSTER" recv --workspace "$WS" "$RUN" "$SELF" --json --wait --timeout 1 --max 100 2>/dev/null)

  # Candidate that has waited out the collection window declares iff it is the global max.
  if [[ "$role" == "candidate" ]] && (( $(now) - candidate_since >= ELECT_WINDOW )); then
    if (( MYID >= ${maxid_for_term[$term]:-0} )); then
      role="leader"; leader="$MYID"; trace "became_leader"
      bcast "COORDINATOR term=$term id=$MYID leader=$MYID"
      last_hb="$(now)"
    else
      # Non-max candidate: do NOT silently wait for a COORDINATOR we may have missed. Re-solicit
      # at the SAME term (the live leader re-announces on seeing our ELECTION) -- this recovers a
      # stranded candidate WITHOUT a term bump, so the correct (max) leader is preserved. Only if
      # we stay stuck far past several heartbeat windows do we assume the leader is also dead and
      # bump the term -- a conservative last resort, since a premature bump lets a non-max node
      # escalate and win.
      if (( $(now) - last_solicit >= SOLICIT_INTERVAL )); then
        last_solicit="$(now)"; bcast "ELECTION term=$term id=$MYID"
      fi
      if (( $(now) - candidate_since > 3 * HB_TIMEOUT )); then
        trace "candidate_stuck"; start_election $(( term + 1 )); last_hb="$(now)"
      fi
    fi
  fi

  if [[ "$role" == "leader" ]]; then
    # Gate the heartbeat to HB_INTERVAL. The loop spins fast when messages are flowing (recv
    # returns the instant one arrives), so an ungated per-iteration broadcast becomes a storm
    # that overwhelms a fork-per-message transport at higher N -- the failure we observed at N=7.
    if (( $(now) - last_hb_sent >= HB_INTERVAL )); then
      last_hb_sent="$(now)"; bcast "HEARTBEAT term=$term id=$MYID leader=$MYID"
    fi
  elif [[ "$role" == "follower" ]] && (( $(now) - last_hb > HB_TIMEOUT )); then
    trace "leader_lost"
    start_election $(( term + 1 ))                                  # failover: nobody is leading; re-elect
    last_hb="$(now)"
  fi
done

trace "exit"
