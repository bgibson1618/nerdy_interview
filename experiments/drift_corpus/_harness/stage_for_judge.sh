#!/usr/bin/env bash
# Blind-stage harvested reviewer reports for judging: copy each to a hash-ordered blind id
# (R001..), so the judge can't infer the condition from filename or order. Writes manifest.tsv
# mapping blind id -> project/rep/condition (orchestrator-only; never given to the judge).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS="$HERE/results"
INBOX="$HERE/judge_inbox"
rm -rf "$INBOX"; mkdir -p "$INBOX"
MAN="$INBOX/manifest.tsv"
printf 'blind_id\tproject\trep\tcondition\tsrc\n' > "$MAN"

# hash-order the reports so blind ids don't track path order
i=0
while read -r _hash file; do
  i=$((i + 1)); bid="$(printf 'R%03d' "$i")"
  rel="${file#"$RESULTS"/}"            # project/repN/cond.md
  project="${rel%%/*}"; rest="${rel#*/}"
  rep="${rest%%/*}"; rep="${rep#rep}"
  cond="${rest##*/}"; cond="${cond%.md}"
  cp "$file" "$INBOX/$bid.md"
  printf '%s\t%s\t%s\t%s\t%s\n' "$bid" "$project" "$rep" "$cond" "$rel" >> "$MAN"
done < <(find "$RESULTS" -name '*.md' ! -name '*FALLBACK*' -print0 \
          | xargs -0 -I{} sh -c 'printf "%s %s\n" "$(md5sum "{}" | cut -c1-12)" "{}"' \
          | sort)

echo "staged $i reports -> $INBOX"
# emit the (blind_id, project) pairs the judge workflow needs, as JSON (NO condition leaked)
python3 - "$MAN" <<'PY'
import csv, json, sys
rows=list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
print(json.dumps([{"bid":r["blind_id"],"project":r["project"]} for r in rows]))
PY
