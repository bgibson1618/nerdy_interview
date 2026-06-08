# Interview crash plan — 2-day sprint

*Built 2026-06-08. Interview profile changed: this round is **general coding logic + OOP + a
scalability section + system design**, with the JS/TS+React tech-stack focus de-emphasized.
Format: **live coding in a shared editor**. System design is the known gap (starting near zero).*

> The older `study/drills/*` and `NERDY_STUDY_PLAN.md` were built for a JS/TS+React **code-review**
> round. They're now **secondary** — keep them only as backup in case the interviewer still pivots to
> "review our code" or "tell me about a project you built." Don't spend the 2 days there.

---

## The honest target (read this first)

You will **not** become a system-design expert in 2 days from zero — and you don't need to. At this
level, the interviewer is grading **structured thinking and tradeoff awareness**, not a perfect
design. The achievable, anxiety-killing goal:

1. **A framework you never abandon** (so you always know your next sentence).
2. **Enough vocabulary to not freeze** (load balancer, cache, queue, replica, shard — and *why* each).
3. **2–3 designs you can pattern-match** (URL shortener, a read-heavy feed, a rate limiter).

That combination earns most of the partial credit a near-zero candidate can get, and it reads as
"this person reasons about systems" — which is the actual bar.

## Priority order (by return-on-time)

| Rank | Track | Why this order | File |
|---|---|---|---|
| 1 | **OOP essentials** | Most learnable in 2 days; directly tested in live coding (SOLID + a "design these classes" task). Fast, durable wins. | `02-oop-essentials.md` |
| 2 | **Live-coding method** | You already code in JS/TS — this is *pattern recognition + thinking aloud*, not learning syntax. | `03-live-coding-playbook.md` |
| 3 | **System design + scalability** | Your gap. Framework + vocab + 2 worked examples. Capped on purpose, but made confidence-building. | `01-system-design-from-zero.md` |

**Why SD is ranked third even though it's the scary one:** it has the *lowest* ceiling per hour from
zero, and OOP/coding have the *highest*. You de-risk the interview most by banking the easy points
first, then spending the rest on SD's framework so you never go blank. (SD is *first* in the daily
schedule below, though — it benefits from a night of spacing between reading and practicing.)

---

## The 2-day schedule

**Day 1 — learn the spines**
- **Morning (longest block):** System design — read `01-system-design-from-zero.md` end to end. Goal:
  memorize the **6-step framework** and what each building block *does*. Don't try to retain the
  worked examples yet — just read them once.
- **Midday:** OOP — read `02-oop-essentials.md`. The 4 pillars + SOLID + composition-over-inheritance.
  Write the small TS snippets yourself; don't just read them.
- **Afternoon:** Live coding — read `03-live-coding-playbook.md`. Learn the **UMPIRE** talk-aloud loop
  and the **pattern cheatsheet**. Then solve **3 problems out loud** (timer on, narrate everything).
- **Evening (light):** Re-read *only* the SD 6-step framework + the "numbers to know." Try to recite
  the 6 steps from memory. Sleep — spacing does real work on the SD material overnight.

**Day 2 — make it automatic**
- **Morning:** SD — work the **2 examples yourself**, out loud, drawing boxes on paper, *before*
  re-reading the solutions. Then compare. Drill the 6 steps until they're reflex.
- **Midday:** OOP — do the **"design a parking lot"** OOD problem out loud in TS (in the file). Re-skim
  the patterns; be able to name Strategy/Factory/Observer and when each applies.
- **Afternoon:** Live coding — **4–6 timed problems**, talking aloud the whole time, using the
  "I'm stuck" recovery script at least once on purpose so it's rehearsed.
- **Evening (light):** Read the **one-page cheat sheet** at the bottom of each file. No new material.

**Morning of the interview**
- Re-read the cheat sheets only (SD 6 steps + numbers + phrases; OOP SOLID + pillars; UMPIRE loop).
- One easy coding problem to warm up your hands and voice. Then stop. You're ready.

---

## The three things that win every section

1. **Think out loud, always.** Silence is graded as "no signal." Narrate your reasoning, your
   assumptions, and your tradeoffs — in coding *and* design. Your reasoning is the product.
2. **Clarify before you build.** Restate the problem, ask about scale/edge cases/constraints, state
   your assumptions. Jumping straight to a solution is the #1 junior tell in every section.
3. **Name tradeoffs explicitly.** "I'd use a cache here — faster reads, at the cost of staleness; for
   this read-heavy case that's the right trade." That one sentence pattern carries OOP, coding, *and*
   system design.

---

## Files in this folder
- `01-system-design-from-zero.md` — framework, building blocks, scaling patterns, numbers, 2 worked
  examples, what to say out loud. **Your gap — the most important read.**
- `02-oop-essentials.md` — 4 pillars, SOLID, composition vs inheritance, key patterns, a worked OOD
  problem (parking lot) in TypeScript.
- `03-live-coding-playbook.md` — the UMPIRE talk-aloud loop, the pattern cheatsheet, complexity
  quick-reference, worked problems with narration, the "I'm stuck" recovery script.
