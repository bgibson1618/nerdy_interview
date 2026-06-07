#!/usr/bin/env bash
# blackboard.sh — a shared, multi-level knowledge store with flock-atomic operations. The
# stigmergy substrate for the shared-blackboard A2A pattern (PREREG.md): agents coordinate ONLY
# by reading/writing this board — no orchestrator, no direct messages. Two levels above the raw
# input: Level-1 partials (one per shard) and a single Level-2 synthesis that may be produced
# only once every shard is done. Every write is a flock-guarded read-modify-write, the same
# exactly-once discipline board.sh and the A2A inbox are built on.
#
#   blackboard.sh seed            <board> <shardN> <payload-per-line-file>
#   blackboard.sh claim-shard     <board> <worker>      -> "<id>\t<payload-json>" or EMPTY
#   blackboard.sh post-partial    <board> <id> <worker> <partial-json>
#   blackboard.sh claim-synthesis <board> <worker>      -> OK (won it) | NOPE (not ready / taken)
#   blackboard.sh post-final      <board> <worker> <final-json>
#   blackboard.sh state           <board>               -> counts + solved=yes|no
#   blackboard.sh dump            <board>
set -euo pipefail
cmd="${1:?seed|claim-shard|post-partial|claim-synthesis|post-final|state|dump}"
board="${2:?board path}"; shift 2 || true
lock="$board.lock"
now() { date +%s.%N; }

case "$cmd" in
  seed)
    n="${1:?shard count}"; payloads="${2:?payload file (one compact-JSON payload per line)}"
    : > "$board"
    i=0
    while IFS= read -r pl; do
      i=$((i+1))
      jq -nc --argjson id "$i" --argjson payload "$pl" \
        '{kind:"shard",id:$id,status:"open",worker:null,payload:$payload,partial:null,claim_ts:null,done_ts:null}' >> "$board"
    done < "$payloads"
    [[ "$i" == "$n" ]] || { echo "seed: expected $n payloads, got $i" >&2; exit 2; }
    jq -nc '{kind:"synthesis",status:"open",worker:null,final:null,claim_ts:null,done_ts:null}' >> "$board"
    ;;

  claim-shard)
    worker="${1:?worker}"
    exec 9>>"$lock"; flock 9
    id="$(jq -r 'select(.kind=="shard" and .status=="open")|.id' "$board" | head -1)"
    if [[ -z "$id" ]]; then echo "EMPTY"; exit 0; fi
    ts="$(now)"; tmp="$(mktemp)"
    jq -c --argjson id "$id" --arg w "$worker" --arg ts "$ts" \
      'if .kind=="shard" and .id==$id then .status="claimed"|.worker=$w|.claim_ts=$ts else . end' "$board" > "$tmp"
    mv "$tmp" "$board"
    payload="$(jq -c --argjson id "$id" 'select(.kind=="shard" and .id==$id)|.payload' "$board")"
    printf '%s\t%s\n' "$id" "$payload"
    ;;

  post-partial)
    id="${1:?id}"; worker="${2:?worker}"; partial="${3:?partial json}"
    exec 9>>"$lock"; flock 9
    ts="$(now)"; tmp="$(mktemp)"
    jq -c --argjson id "$id" --arg w "$worker" --argjson p "$partial" --arg ts "$ts" \
      'if .kind=="shard" and .id==$id then .status="done"|.worker=$w|.partial=$p|.done_ts=$ts else . end' "$board" > "$tmp"
    mv "$tmp" "$board"
    ;;

  claim-synthesis)
    worker="${1:?worker}"
    exec 9>>"$lock"; flock 9
    # Stigmergic gate: only claimable once EVERY shard is done and the slot is still open.
    open_or_claimed="$(jq -r 'select(.kind=="shard" and .status!="done")|.id' "$board" | head -1)"
    syn_status="$(jq -r 'select(.kind=="synthesis")|.status' "$board")"
    if [[ -n "$open_or_claimed" || "$syn_status" != "open" ]]; then echo "NOPE"; exit 0; fi
    ts="$(now)"; tmp="$(mktemp)"
    jq -c --arg w "$worker" --arg ts "$ts" \
      'if .kind=="synthesis" then .status="claimed"|.worker=$w|.claim_ts=$ts else . end' "$board" > "$tmp"
    mv "$tmp" "$board"
    echo "OK"
    ;;

  post-final)
    worker="${1:?worker}"; final="${2:?final json}"
    exec 9>>"$lock"; flock 9
    ts="$(now)"; tmp="$(mktemp)"
    jq -c --arg w "$worker" --argjson f "$final" --arg ts "$ts" \
      'if .kind=="synthesis" then .status="done"|.worker=$w|.final=$f|.done_ts=$ts else . end' "$board" > "$tmp"
    mv "$tmp" "$board"
    ;;

  state)
    jq -rs '
      (map(select(.kind=="shard"))) as $s
      | "shards_total=\($s|length) open=\($s|map(select(.status=="open"))|length) claimed=\($s|map(select(.status=="claimed"))|length) done=\($s|map(select(.status=="done"))|length) "
        + (map(select(.kind=="synthesis"))[0] | "synthesis=\(.status) solved=\(if .status=="done" then "yes" else "no" end)")
    ' "$board" ;;

  dump) cat "$board" ;;
  *) echo "unknown: $cmd" >&2; exit 2 ;;
esac
