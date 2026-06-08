# Worked design — session reminder notifications (Nerdy / Varsity Tutors)

*Corrected version of the reminder system we worked through. Follows **RADAR**. "First pass said X →
corrected to Y" marks the common traps. Re-read artifact for the morning of. Pairs with
`04-worked-booking-design.md` — they're deliberately opposite regimes (see the end).*

**The prompt:** remind both the student and the tutor before every 1:1 session — once **24 hours
before** and once **10 minutes before** — over **email and push**. Send once. Don't remind for
cancelled sessions.

---

## R — Requirements

- **Functional:** two reminders (24h, 10min) to **both** parties, on **two channels** (email + push);
  **no reminder for a cancelled session**; a **rescheduled** session moves its reminders.
- **Non-functional — name the regime, it's the whole framing:** this is the **opposite of booking** —
  **asynchronous and eventually consistent.** The honest correctness model is **at-least-once delivery
  + idempotent**, so the user *sees* it once — **not** exactly-once, which is impossible across your DB
  and a third-party provider. Prioritize **fault isolation**: a reminder failure must never cascade
  into booking.
- **Out of scope (say it):** SMS, an in-app notification center, marketing sends.

## A — Approximate

- Sessions cluster hard at **:00 / :30, evenings and Sunday afternoons** → **sharp bursts** (tens of
  thousands due at once) followed by long quiet stretches. Design for the burst; scale *down* in the
  troughs. The spike shape — not the daily average — is the thing to engineer around.

## D — Design (high level)

**Materialize the work at session-creation time** (the right core call — don't scan the sessions table
every second). When a session is booked, write its reminder rows into a **Reminders** table:

```
reminder(id, session_id, send_at, recipient_id, recipient_kind['student'|'tutor'],
         channel_targets{email, push_token},
         email_sent BOOL, push_sent BOOL, attempts INT, status['pending'|'done'|'dead'])
-- one row per (session, offset, recipient): 2 offsets × 2 recipients = 4 rows/session.
-- per-recipient rows keep each delivery independently retryable. INDEX (status, send_at).
```

```
                 ┌───────────── every ~minute ─────────────┐
   Sessions ──►  │ Poller: claim due rows (SKIP LOCKED) ──► enqueue send-jobs │
   (booking)     └──────────────────────────────────────────┘
                                     │
                                 [ QUEUE ]  ◄── absorbs the burst
                                     │
                      autoscaling Worker pool (drains at a steady, rate-limited pace)
                                     │
                        Email provider / Push provider  (idempotency key per job)
```

The poll is cheap because of the `(status, send_at)` index — it touches only due rows, never the whole
table. The poller **enqueues**; the **workers send**. That split is what lets you scale the send side
independently and absorb spikes.

### Corrected from the first pass
- *First pass: a single worker `SELECT`ed due rows and sent them directly.* → The spike **needs many
  workers**, and naive `SELECT … WHERE send_at<=NOW()` makes two workers grab the **same** rows and
  double-send. Fix: claim rows **atomically** (below) and put a **queue** between poll and send.
- *First pass: "send only once" via the sent flags.* → That's **at-least-once, not exactly-once** (a
  worker can crash after sending, before flipping the flag). Fix: **idempotency key + dedup**, and
  don't delete the row the instant it's done (that discards your dedup memory).
- *First pass: geographic DBs (`US_EAST`/`US_CENTRAL`) to handle the spike.* → Geo solves **latency**,
  not a **temporal burst** — each region still bursts at its own local :00. The burst is absorbed by
  the **queue + autoscaling workers**, not by more DBs.

## A — Attack the bottleneck (the :00 spike + correctness)

**1. Claim due reminders atomically** — the multi-worker version of the booking atomic claim
(this is `flock` / the booking `WHERE status='OPEN'` a third time — now used to *distribute work*):

```sql
SELECT * FROM reminders
 WHERE send_at <= NOW() AND status = 'pending'
 ORDER BY send_at
 LIMIT :batch
 FOR UPDATE SKIP LOCKED;     -- each worker/poller grabs a DISJOINT batch; no row sent twice
```

**2. Absorb the burst with the queue + autoscaling workers.** 10k jobs land at 5:00pm; the queue holds
them; the worker pool drains at a sustainable rate and **autoscales on queue depth**, then scales to
near-zero in the quiet stretches.

**3. Rate-limit to the provider.** Email/push providers throttle or drop a 10k blast — the worker pool
is where you token-bucket your send rate to stay under their limit.

**4. Jitter the trigger.** Since everything clusters at :00, fire the "10-min" reminder anywhere in a
10→9-min window. Spreading the *trigger* flattens the spike before it forms — the cheapest win here.

**5. Idempotency on send.** Each job carries an idempotency key per `(reminder_id, channel)`; the
provider de-dupes a retry, so at-least-once delivery still means the user **sees it once**.

## R — Review (tradeoffs & failure modes)

- **At-least-once + idempotent, eventually consistent** — the correct model for this problem. A
  reminder going out a minute late, or a deduped retry, is fine; a *missed* reminder is the real
  failure, which is why the poll sweeps `send_at <= NOW()` (overdue included) rather than `=`.
- **Fault isolation (your strong point):** the Reminders subsystem is decoupled from booking — its
  failure can't cascade into the booking path. That isolation is worth the extra moving parts.
- **Per-channel retry:** when a partially-sent row is re-claimed (email yes, push no), the worker must
  **skip the done channel** and retry only the failed one.
- **Cap retries / dead-letter:** an `attempts` counter with a ceiling (then `status='dead'`) so a
  permanently bad push token doesn't retry every minute forever.
- **One poller:** run *exactly one* scheduler (single cron / leader-elected), or two pollers enqueue
  everything twice. (`SKIP LOCKED` + idempotency save you even then, but cleaner to run one.)
- **Precision tradeoff:** a 1-minute poll means a reminder can fire up to ~1 min late — fine for a
  reminder; state it as a deliberate choice.
- **The genuinely hard part (name it):** your DB and the email/push provider are **two systems with no
  shared transaction** — identical in shape to DB+Stripe in booking. You can't be exactly-once across
  them; you get there with **idempotency keys + at-least-once + a reconcile/dead-letter** path.

---

## The one-liners to say out loud

- "I'll **materialize reminder rows at booking time** with a `send_at` and poll a narrow indexed range —
  no full-table scan."
- "Multiple workers claim due rows with **`FOR UPDATE SKIP LOCKED`** so no reminder is sent twice — it's
  the same atomic-claim primitive as the booking write, used here to split work."
- "The :00 spike is absorbed by a **queue + autoscaling workers**, **rate-limited** to the provider, with
  **jitter** to flatten the burst — not by geo-sharding, which solves latency, not a time spike."
- "This is **at-least-once + idempotent**: a key per `(reminder, channel)` means a retry still shows the
  user one message."
- "It's **decoupled** from booking, so a reminder outage can't take down the booking path."

## The regime contrast (the actual skill)

| | Booking (`04`) | Reminders (`05`) |
|---|---|---|
| Timing | **synchronous** (user waiting) | **asynchronous** (background) |
| Consistency | **strong** | **eventual** |
| Correctness model | **exactly-once** atomic claim | **at-least-once + idempotent** |
| Queue used for? | only post-booking **side effects** | the **core** fan-out (right tool here) |
| Same primitives | atomic claim, idempotency | atomic claim (SKIP LOCKED), idempotency |

Same toolkit, opposite settings. Walking in able to say *which regime a problem is in, and why* is the
judgment the interview is really testing.
