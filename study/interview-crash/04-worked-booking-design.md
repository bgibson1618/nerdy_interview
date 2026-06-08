# Worked design — tutor session booking (Nerdy / Varsity Tutors)

*This is the corrected version of the booking design we worked through together. It's the one to
re-read the morning of. It follows the **RADAR** framework from `01-system-design-from-zero.md`. Where
it says "first pass said X → corrected to Y," that's a mistake worth remembering — they're the common
traps on this exact problem.*

**The prompt:** students browse/search tutors and open time slots; when a student picks a slot they
enter payment and reserve it. The system must **never double-book** a slot, and a repeated booking
attempt by the same student must **not charge them twice.**

---

## R — Requirements

- **Functional:** browse/search tutors + open slots → select a slot → pay → the slot is reserved to
  that student. No double-booking. Idempotent payment (a retry by the same user doesn't re-charge).
- **Non-functional:** **read-heavy** (students browse many tutors per booking); **durability and
  correctness of a confirmed booking is the top priority** — a lost or doubled booking is a
  trust-breaking, visible failure. On a network partition, **choose consistency over availability** at
  the booking moment.
- **Out of scope (say it):** cancellations/refunds, reviews, the live session itself, payouts to tutors.

## A — Approximate

- Reads ≫ writes — browsing dwarfs booking. (We assumed ~10×; realistically more like 100×. Either way:
  **design the read path for scale and the write path for correctness.**)
- **Sharp temporal peaks** — after-school, Sunday evenings, exam season, SAT prep. Capacity and
  autoscaling must target the peak, not the average.
- The interesting number isn't raw QPS — it's **contention**: many students can converge on the *same
  popular tutor's same slot* at once. That's the whole problem.

## D — Design (high level)

```
client ──REST──► Load balancer ──► stateless App servers ──┬──► MySQL PRIMARY  (all writes / the claim)
                                                           ├──► MySQL REPLICAS (browse + search reads)
                                                           ├──► Cache (Redis)  (hot search/browse reads)
                                                           └──► Queue ──► workers (post-booking side effects)
                                                   Payment provider (Stripe) ◄── synchronous, on the booking path
```

- **Data store: MySQL.** Relational fits (sessions, tutors, students, bookings are related) and we need
  **ACID transactions** for a durable, correct booking. Postgres would also work; its object-relational
  extras aren't needed here.
- **Client ↔ app server: REST over a load balancer.** (GraphQL would be an *alternative API style here* —
  not a second layer. *First pass said GraphQL sat between the app server and MySQL → corrected: the app
  server talks to MySQL with **SQL** via a driver/ORM. GraphQL is a client↔server API, not a DB
  protocol.*)
- **Read scaling: replicas + cache.** Read replicas behind the app tier absorb peak browsing; a Redis
  cache fronts the hottest search/browse reads. (*First pass said "no caches, stale data hurts UX" →
  corrected below: stale reads are safe here, so caching is your biggest scale lever, not a hazard.*)

## A — Attack the bottleneck: the atomic claim (the heart of it)

The bottleneck is **concurrent booking of one slot**. The fix is the database version of the roster's
`flock` claim — a **single conditional write where correctness lives in the `WHERE` clause:**

```sql
-- Step 1: try to HOLD the slot (the atomic claim). Runs on the PRIMARY.
UPDATE sessions
   SET status = 'PENDING', held_by = :userId, hold_expires = NOW() + INTERVAL 5 MINUTE
 WHERE id = :sessionId
   AND (status = 'OPEN' OR (status = 'PENDING' AND hold_expires < NOW()));
-- check affected_rows:  1 = you won the hold   |   0 = someone else holds it → tell the user "just taken"
```

Why this one statement carries the design:
- **`WHERE status = 'OPEN'` is the compare-and-set.** The row lock guarantees exactly one concurrent
  `UPDATE` matches; the loser matches **0 rows** and is rejected. That's `flock`, in SQL — read-find-
  mark-write made atomic by the database.
- **The claim runs on the PRIMARY, the single source of truth.** So even if a stale replica told the
  loser "OPEN," the primary rejects them. *This is why stale reads are harmless* (see Review).
- **Expiry is in the predicate** (`OR (PENDING AND hold_expires < NOW())`), so an abandoned hold is
  reclaimable without depending on a sweeper job running on time. (A background sweeper that flips
  expired holds back to `OPEN` is a nice cleanup belt-and-suspenders, but correctness doesn't need it.)

### The full booking sequence (order matters — this is where double-charges hide)

1. **Atomic hold** (the `UPDATE` above) — *before any money moves.* Never charge before you know the
   student owns the slot. Hold lasts ~5 min (an airline-seat-style reservation) so they have time to pay.
2. **Charge with an idempotency key** (reuse the hold token as the key). Stripe returns the *original*
   result on a retry with the same key → a repeated attempt **never double-charges.**
3. **Confirm** — a second conditional write that only the holder can make:
   ```sql
   UPDATE sessions SET status = 'BOOKED'
    WHERE id = :sessionId AND status = 'PENDING' AND held_by = :userId AND hold_expires > NOW();
   ```
   A duplicate confirm is a harmless no-op that returns the existing booking. Wrap "charge succeeded →
   confirm" so a confirmed booking is durable (ACID).
4. **Enqueue side effects** — confirmation email, calendar invite, receipt, session-room provisioning,
   analytics. These are eventual and belong on the **queue**, off the request path.

### What the queue is (and isn't) for

*First pass put **all writes** on a queue to "smooth spikes" → corrected:* the **booking/claim/payment
is synchronous** — the student is staring at a spinner and needs an authoritative "you got it / it's
taken" *now*, and you can't charge a card against a write that hasn't happened yet. Async-queuing the
claim fights both the payment flow and the consistency goal. **The queue is for the *side effects after*
a confirmed booking**, which are fine to be eventually consistent. (A *per-tutor serialization* queue —
all claims for one tutor processed single-file — is a legitimate alternative to the conditional `UPDATE`,
but it's heavier and adds latency; the atomic `UPDATE` is simpler and enough.)

## R — Review (tradeoffs & failure modes)

- **Stale reads are fine — by design.** A replica or cache can show a slot as `OPEN` that's actually
  taken; the student clicks, and the **atomic claim on the primary rejects them** with "just taken."
  Mildly annoying, *far* better than a double-booking — and it's the reason caching the browse/search
  path is **safe**. The real rule isn't "no caches," it's **tolerate stale reads everywhere; enforce
  correctness only at the atomic write.** That unlocks cache + replicas as your peak-traffic scaling
  levers. (*This corrects the first pass's "no caches" stance, which was inconsistent with accepting
  replica lag — same staleness, rejected in one place and allowed in the other.*)
- **Durability:** the confirm write is an ACID transaction on the primary → a confirmed booking survives
  crashes. Correctness/durability is prioritized over write latency, exactly as required.
- **The genuinely hard part (name it even if you don't fully solve it):** the booking lives in MySQL but
  the charge lives in **Stripe — two systems, no shared transaction.** If the charge succeeds but the
  confirm write fails, you have an orphaned charge. Resolution: the hold + idempotency key + a
  **reconciliation** step (retry the confirm, or auto-refund the orphan). Saying this out loud signals
  senior range.
- **Partition behavior:** reads stay available (replicas/cache); the **write/claim path chooses
  consistency** — if it can't reach the primary, it fails the booking rather than risk a double-book.
  (CAP can be chosen *per operation*: AP for browse, CP for claim.)

---

## The one-liners to say out loud (this is what's graded)

- "Reads are cheap to scale and writes must be correct, so I'll **scale the read path with replicas +
  cache and make the booking a single atomic claim**."
- "The claim is a **conditional `UPDATE … WHERE status='OPEN'`** on the primary — the database guarantees
  exactly one concurrent writer wins. It's a compare-and-set."
- "I **hold the slot first, then charge with an idempotency key, then confirm** — so I never charge
  before the slot is secured and a retry never double-charges."
- "**Stale reads are acceptable** because the atomic claim re-validates on the primary; that's *why* I
  can cache the browse path."
- "Booking is **synchronous and consistent**; only the **after-effects** (email, calendar, receipt) go
  on a queue."
- "DB and payment are two systems with no shared transaction, so I'd add **reconciliation** for the
  charge-succeeded-but-confirm-failed case."

## The transferable lesson (sets up the reminders problem)

This system is **synchronous + strongly consistent** at the moment that matters. The session-reminder
system is the **opposite regime — asynchronous, queue-driven, eventually consistent** — where
*at-least-once + idempotent* is the right correctness model instead of a strict atomic claim. Same
toolkit, opposite settings. Being able to say *which* regime a problem is in, and why, is the skill.
