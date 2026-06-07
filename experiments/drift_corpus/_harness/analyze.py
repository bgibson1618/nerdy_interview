#!/usr/bin/env python3
"""Analyze blinded drift-judge scores into per-condition metrics.

Inputs:
  --scores  judge scores JSON (array of {bid, stated_verdict, drift_scores[], false_positives[], real_unplanted[]})
  --manifest judge_inbox/manifest.tsv  (blind_id -> project/rep/condition)
  --keys    _answerkey dir (per-project ground truth: drift ids, tiers, classes)
Outputs: prints a summary table; writes a markdown section if --out given.
"""
import argparse, csv, json, os, statistics as st
from collections import defaultdict

GROUND_VERDICT = "SIGNIFICANT DRIFT"  # both projects have 12 injected drifts

def load_keys(keydir):
    keys = {}
    for proj in ("taskflow-api", "pulse-dashboard"):
        d = json.load(open(os.path.join(keydir, f"{proj}.json")))
        tier = {x["id"]: x["tier"] for x in d["drifts"]}
        cls = {x["id"]: x["class"] for x in d["drifts"]}
        keys[proj] = {"ids": [x["id"] for x in d["drifts"]], "tier": tier, "cls": cls,
                      "n": len(d["drifts"])}
    return keys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--keys", required=True)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    keys = load_keys(a.keys)
    man = {r["blind_id"]: r for r in csv.DictReader(open(a.manifest), delimiter="\t")}
    scores = json.load(open(a.scores))

    # per-report record
    reps = []  # dict: bid, project, rep, cond, backend, inst, caught(set), partial(set), missed(set), fp(int), verdict
    for s in scores:
        bid = s["bid"]; m = man[bid]; proj = m["project"]
        cond = m["condition"]; backend = cond.rstrip("0123456789"); inst = cond[len(backend):]
        caught = {d["id"] for d in s["drift_scores"] if d["verdict"] == "caught"}
        partial = {d["id"] for d in s["drift_scores"] if d["verdict"] == "partial"}
        missed = {d["id"] for d in s["drift_scores"] if d["verdict"] == "missed"}
        reps.append(dict(bid=bid, project=proj, rep=m["rep"], cond=cond, backend=backend, inst=inst,
                         caught=caught, partial=partial, missed=missed,
                         fp=len(s.get("false_positives", [])),
                         unplanted=len(s.get("real_unplanted", [])),
                         verdict=s["stated_verdict"]))

    def recall(rec, lenient=False):
        n = keys[rec["project"]]["n"]
        return (len(rec["caught"]) + (0.5*len(rec["partial"]) if lenient else 0)) / n

    def tier_recall(recs, tier):
        # fraction of tier-T drifts caught, pooled across given reports' projects
        num = den = 0
        for rec in recs:
            k = keys[rec["project"]]
            tids = [i for i in k["ids"] if k["tier"][i] == tier]
            den += len(tids); num += len(rec["caught"] & set(tids))
        return num/den if den else float("nan")

    # ---- single-backend conditions ----
    def agg(recs):
        return dict(
            n=len(recs),
            recall=st.mean(recall(r) for r in recs),
            recall_len=st.mean(recall(r, True) for r in recs),
            fp=st.mean(r["fp"] for r in recs),
            verdict_acc=st.mean(1.0 if r["verdict"] == GROUND_VERDICT else 0.0 for r in recs),
            t_obv=tier_recall(recs, "obvious"), t_mod=tier_recall(recs, "moderate"), t_sub=tier_recall(recs, "subtle"),
        )

    claude_singles = [r for r in reps if r["backend"] == "claude"]      # 12 individual claude reviews
    codex_singles  = [r for r in reps if r["backend"] == "codex"]       # 4 codex reviews
    gemini_singles = [r for r in reps if r["backend"] == "gemini"]      # 0 for now

    cells = sorted({(r["project"], r["rep"]) for r in reps})

    # ---- same-backend panel (3x claude per cell): union / consensus ----
    def panel_for_cell(cell, members):
        proj, rep = cell
        recs = [r for r in reps if (r["project"], r["rep"]) == cell and r["cond"] in members]
        if not recs:
            return None
        ids = keys[proj]["ids"]
        # caught-vote count per id
        votes = {i: sum(1 for r in recs if i in r["caught"]) for i in ids}
        union = {i for i in ids if votes[i] >= 1}
        cons = {i for i in ids if votes[i] >= 2}
        # FP: union = any member FP; consensus approximated as max single (we lack per-FP ids) -> report union FP and mean FP
        fp_union = sum(r["fp"] for r in recs)  # upper bound (may double count)
        fp_mean = st.mean(r["fp"] for r in recs)
        n = keys[proj]["n"]
        return dict(proj=proj, rep=rep, union_recall=len(union)/n, cons_recall=len(cons)/n,
                    union_caught=union, cons_caught=cons, fp_union=fp_union, fp_mean=fp_mean,
                    members=[r["cond"] for r in recs])

    def panel_agg(member_conds, label):
        per_cell = [panel_for_cell(c, set(member_conds)) for c in cells]
        per_cell = [p for p in per_cell if p]
        if not per_cell:
            return None
        return dict(label=label, n=len(per_cell),
                    union_recall=st.mean(p["union_recall"] for p in per_cell),
                    cons_recall=st.mean(p["cons_recall"] for p in per_cell),
                    fp_union=st.mean(p["fp_union"] for p in per_cell),
                    fp_mean=st.mean(p["fp_mean"] for p in per_cell),
                    per_cell=per_cell)

    psame = panel_agg(["claude1","claude2","claude3"], "P-same (3x claude)")

    # panel tier recall (union) for subtle
    def panel_tier(per_cell, tier, mode="union"):
        num=den=0
        for p in per_cell:
            k=keys[p["proj"]]
            tids=[i for i in k["ids"] if k["tier"][i]==tier]
            caught = p["union_caught"] if mode=="union" else p["cons_caught"]
            den+=len(tids); num+=len(set(tids)&caught)
        return num/den if den else float("nan")

    out = []
    def p(s=""): out.append(s); print(s)

    p("# Drift-detection results (claude+codex; gemini pending)\n")
    p(f"Reports scored: {len(reps)}  | cells: {len(cells)}  | ground-truth verdict: {GROUND_VERDICT}\n")
    p("## Single-backend (mean over individual reviews)")
    p("| condition | n | recall(strict) | recall(lenient) | FP/report | verdict-acc | obvious | moderate | subtle |")
    p("|---|---|---|---|---|---|---|---|---|")
    for label, recs in [("S-claude", claude_singles), ("S-codex", codex_singles), ("S-gemini", gemini_singles)]:
        if not recs:
            p(f"| {label} | 0 | — | — | — | — | — | — | — |"); continue
        g = agg(recs)
        p(f"| {label} | {g['n']} | {g['recall']:.2f} | {g['recall_len']:.2f} | {g['fp']:.2f} | {g['verdict_acc']:.2f} | {g['t_obv']:.2f} | {g['t_mod']:.2f} | {g['t_sub']:.2f} |")

    if psame:
        p("\n## Same-backend panel control: P-same (3x claude), aggregated per cell")
        p("| aggregation | n cells | recall | FP (sum/report basis) | subtle recall |")
        p("|---|---|---|---|---|")
        p(f"| union (any-of-3) | {psame['n']} | {psame['union_recall']:.2f} | {psame['fp_union']:.2f} | {panel_tier(psame['per_cell'],'subtle','union'):.2f} |")
        p(f"| consensus (>=2of3) | {psame['n']} | {psame['cons_recall']:.2f} | {psame['fp_mean']:.2f} | {panel_tier(psame['per_cell'],'subtle','consensus'):.2f} |")

    # raw per-report dump
    p("\n## Per-report (joined to condition)")
    p("| bid | project | rep | cond | recall | caught | partial | missed | FP | verdict |")
    p("|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(reps, key=lambda x:(x["project"],x["rep"],x["cond"])):
        n=keys[r["project"]]["n"]
        p(f"| {r['bid']} | {r['project']} | {r['rep']} | {r['cond']} | {recall(r):.2f} | {len(r['caught'])} | {len(r['partial'])} | {len(r['missed'])} | {r['fp']} | {r['verdict']} |")

    if a.out:
        open(a.out, "w").write("\n".join(out) + "\n")
        print(f"\n[wrote {a.out}]")

if __name__ == "__main__":
    main()
