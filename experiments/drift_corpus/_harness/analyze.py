#!/usr/bin/env python3
"""Round-aware analysis of blinded drift-judge scores into per-condition metrics.

Conditions: S-claude / S-codex / S-gemini (single-backend, mean over individual reviews),
P-same (3x claude per cell) and P-cross (claude1+codex1+gemini1 per cell), each under
union (any) and consensus (>=2) aggregation. Reported per round (easy/hard) and overall.

Usage: analyze.py --scores judge_scores.json --manifest manifest.tsv --keys _answerkey [--out FILE]
"""
import argparse, csv, json, os, statistics as st

ROUND = {"taskflow-api": "easy", "pulse-dashboard": "easy", "ledger-api": "hard", "ingestd": "hard"}

def load_keys(keydir):
    keys = {}
    for proj in ROUND:
        p = os.path.join(keydir, f"{proj}.json")
        if not os.path.exists(p): continue
        d = json.load(open(p))
        keys[proj] = {"ids": [x["id"] for x in d["drifts"]],
                      "tier": {x["id"]: x["tier"] for x in d["drifts"]},
                      "n": len(d["drifts"])}
    return keys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True); ap.add_argument("--manifest", required=True)
    ap.add_argument("--keys", required=True); ap.add_argument("--out", default=None)
    a = ap.parse_args()
    keys = load_keys(a.keys)
    man = {r["blind_id"]: r for r in csv.DictReader(open(a.manifest), delimiter="\t")}
    scores = json.load(open(a.scores))

    reps = []
    for s in scores:
        m = man[s["bid"]]; proj = m["project"]
        if proj not in keys: continue
        cond = m["condition"]; backend = cond.rstrip("0123456789")
        caught = {d["id"] for d in s["drift_scores"] if d["verdict"] == "caught"}
        partial = {d["id"] for d in s["drift_scores"] if d["verdict"] == "partial"}
        reps.append(dict(bid=s["bid"], project=proj, round=ROUND[proj], rep=m["rep"],
                         cond=cond, backend=backend, caught=caught, partial=partial,
                         fp=len(s.get("false_positives", [])), unplanted=len(s.get("real_unplanted", [])),
                         verdict=s["stated_verdict"]))

    def recall(rec):
        return len(rec["caught"]) / keys[rec["project"]]["n"]
    def tier_recall(recs, tier):
        num = den = 0
        for r in recs:
            k = keys[r["project"]]; t = [i for i in k["ids"] if k["tier"][i] == tier]
            den += len(t); num += len(r["caught"] & set(t))
        return (num / den) if den else float("nan")
    def good_verdict(rec):  # ground truth verdict for an injected project is SIGNIFICANT DRIFT
        return 1.0 if rec["verdict"] == "SIGNIFICANT DRIFT" else 0.0

    cells = sorted({(r["project"], r["rep"]) for r in reps})

    def single(recs):
        if not recs: return None
        return dict(n=len(recs), recall=st.mean(recall(r) for r in recs),
                    fp=st.mean(r["fp"] for r in recs), unpl=st.mean(r["unplanted"] for r in recs),
                    vacc=st.mean(good_verdict(r) for r in recs),
                    tsub=tier_recall(recs, "subtle"), tmod=tier_recall(recs, "moderate"), tobv=tier_recall(recs, "obvious"))

    def panel(member_conds, cellset):
        per_cell = []
        for (proj, rep) in cellset:
            recs = [r for r in reps if (r["project"], r["rep"]) == (proj, rep) and r["cond"] in member_conds]
            if len(recs) < 2: continue
            ids = keys[proj]["ids"]
            votes = {i: sum(1 for r in recs if i in r["caught"]) for i in ids}
            union = {i for i in ids if votes[i] >= 1}; cons = {i for i in ids if votes[i] >= 2}
            per_cell.append(dict(proj=proj, n=keys[proj]["n"], union=union, cons=cons,
                                 fp_union=sum(r["fp"] for r in recs), fp_mean=st.mean(r["fp"] for r in recs)))
        if not per_cell: return None
        def tr(which, tier):
            num=den=0
            for p in per_cell:
                k=keys[p["proj"]]; t=[i for i in k["ids"] if k["tier"][i]==tier]
                den+=len(t); num+=len(set(t)&p[which])
            return (num/den) if den else float("nan")
        return dict(ncells=len(per_cell),
                    union_recall=st.mean(len(p["union"])/p["n"] for p in per_cell),
                    cons_recall=st.mean(len(p["cons"])/p["n"] for p in per_cell),
                    fp_union=st.mean(p["fp_union"] for p in per_cell), fp_mean=st.mean(p["fp_mean"] for p in per_cell),
                    union_sub=tr("union","subtle"), cons_sub=tr("cons","subtle"))

    out=[]
    def P(s=""): out.append(s); print(s)

    for rnd in ["easy", "hard", "ALL"]:
        sel = (lambda r: True) if rnd == "ALL" else (lambda r, rnd=rnd: r["round"] == rnd)
        rr = [r for r in reps if sel(r)]
        if not rr: continue
        cset = sorted({(r["project"], r["rep"]) for r in rr})
        P(f"\n## Round: {rnd}   (reports={len(rr)}, cells={len(cset)})")
        P("### Single-backend (mean over individual reviews)")
        P("| cond | n | recall | subtle | moderate | obvious | FP/rep | unplanted/rep | verdict |")
        P("|---|---|---|---|---|---|---|---|---|")
        for be in ["claude", "codex", "gemini"]:
            g = single([r for r in rr if r["backend"] == be])
            if not g: P(f"| S-{be} | 0 | — | — | — | — | — | — | — |"); continue
            P(f"| S-{be} | {g['n']} | {g['recall']:.2f} | {g['tsub']:.2f} | {g['tmod']:.2f} | {g['tobv']:.2f} | {g['fp']:.2f} | {g['unpl']:.2f} | {g['vacc']:.2f} |")
        # panels limited to this round's cells
        def panel_round(members):
            return panel(members, cset)
        P("\n### Panels (per-cell aggregation)")
        P("| panel | aggregation | recall | subtle-recall | FP basis |")
        P("|---|---|---|---|---|")
        for label, members in [("P-same (3x claude)", {"claude1","claude2","claude3"}),
                               ("P-cross (cl+cx+gm)", {"claude1","codex1","gemini1"})]:
            pa = panel_round(members)
            if not pa: P(f"| {label} | — | (incomplete) | | |"); continue
            P(f"| {label} | union (any) | {pa['union_recall']:.2f} | {pa['union_sub']:.2f} | {pa['fp_union']:.2f} |")
            P(f"| {label} | consensus (>=2) | {pa['cons_recall']:.2f} | {pa['cons_sub']:.2f} | {pa['fp_mean']:.2f} |")

    # per-report dump for the hard round (the discriminating one)
    P("\n## Per-report — HARD round")
    P("| bid | project | rep | cond | recall | caught | partial | FP | unpl | verdict |")
    P("|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted([x for x in reps if x["round"]=="hard"], key=lambda x:(x["project"],x["rep"],x["cond"])):
        P(f"| {r['bid']} | {r['project']} | {r['rep']} | {r['cond']} | {recall(r):.2f} | {len(r['caught'])} | {len(r['partial'])} | {r['fp']} | {r['unplanted']} | {r['verdict']} |")

    if a.out:
        open(a.out,"w").write("\n".join(out)+"\n"); print(f"\n[wrote {a.out}]")

if __name__ == "__main__":
    main()
