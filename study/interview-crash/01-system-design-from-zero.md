# System design, from zero (2-day version)

**Goal of this doc:** give you a framework you never abandon, the vocabulary to not freeze, and two
worked designs you can pattern-match. That's the realistic, bar-clearing target from zero in 2 days.

**The mindset that fixes the nerves:** system design has *no single right answer*. The interviewer is
watching *how you reason*, not checking your design against a key. If you (1) clarify requirements,
(2) propose a sane structure, (3) find the bottleneck, and (4) name the tradeoff, you are doing
exactly what they want — even if a "better" design exists. You are being graded on the conversation.

---

## 1. The framework — memorize these 6 steps

When they say "design X," you always do these in order. Say the step names out loud as you go; it
signals structure and buys you thinking time.

> **R-A-D-A-R**: **R**equirements → **A**pproximate (scale) → **D**esign (API + data + boxes) →
> **A**ttack (scale the bottleneck) → **R**eview (tradeoffs & failures)

1. **Requirements (2–4 min).** Don't design yet. Ask:
   - **Functional:** what must it *do*? Pin 2–4 core features. ("Shorten a URL, redirect to original.")
   - **Non-functional:** how *well*? Scale, read/write ratio, latency, consistency vs availability.
   - **Out of scope:** say what you're *not* doing ("no analytics, no auth") so you're not judged on it.
   - *Phrase:* "Before I design, let me make sure I have the requirements right…"

2. **Approximate the scale (2–3 min).** Back-of-envelope so your design is sized correctly.
   - Users → requests/sec (QPS). Reads vs writes. Storage/year. (Numbers section below.)
   - *Phrase:* "Roughly 100M reads/day is ~1,200 QPS average, call it ~5,000 at peak. That's
     read-heavy, so I'll design the read path to scale hardest."

3. **Design the high level (5–8 min).** Three sub-steps, in order:
   - **API:** the 2–3 core endpoints. `POST /shorten {url} -> {shortCode}`, `GET /{shortCode} -> 302`.
   - **Data model:** the key tables/objects + the *access pattern* (what you look up by).
   - **The boxes:** draw client → load balancer → app servers → database, plus cache/CDN/queue where
     they earn their place. Talk through one request end to end.

4. **Attack the bottleneck (5–8 min).** Every system has one component that breaks first. Find it,
   then apply the standard moves (load balancer, cache, replica, shard, queue). This is where you
   *show range*. "The DB read path is the bottleneck — I'll add a cache in front and read replicas."

5. **Review: tradeoffs & failure modes (2–3 min).** Name what your choices cost, and what breaks:
   - Consistency vs availability, staleness from caching, the single points of failure.
   - "If the cache dies, reads fall through to the DB — slower but correct. The LB and replicas remove
     the obvious single points of failure."

If you get lost mid-interview, **say the next step name out loud** and it pulls you back on track.

---

## 2. The building blocks (vocabulary + when to reach for each)

This is the "don't freeze" vocabulary. For each: what it is, the one-line *why*, and the trigger.

- **DNS** — turns a domain into an IP. (You rarely design it; just know the request starts here.)

- **Load balancer (LB)** — sits in front of N identical servers and spreads traffic across them; does
  health checks and stops sending to dead ones. **Why:** lets you scale *horizontally* (add servers)
  and removes a single point of failure. **Trigger:** the moment you have more than one app server.
  *L4* = routes by IP/port (fast, dumb); *L7* = routes by HTTP content (path/header — smarter).

- **App server (stateless service)** — runs your logic. **Keep it stateless** (no user session stored
  in the server's memory — push that to a shared cache/DB). **Why:** any server can handle any
  request, so you can add/remove them freely behind the LB. **This is the heart of horizontal scaling.**

- **Database** — durable source of truth. Two families:
  - **SQL (relational: Postgres, MySQL)** — tables, schema, JOINs, **ACID transactions**, strong
    consistency. **Reach for it by default**, especially when data is related and correctness matters
    (money, orders). Scales reads well via replicas; writes are harder (sharding).
  - **NoSQL (DynamoDB, Cassandra, MongoDB)** — flexible schema, **scales writes horizontally** by
    design, often *eventually* consistent. Reach for it at huge scale, simple access patterns, or
    when the data is a big bag of documents/key-values. **Say the tradeoff:** "NoSQL for write scale
    and flexible schema; I give up easy JOINs and strong consistency."

- **Cache (Redis, Memcached)** — fast in-memory key→value store in front of a slow resource.
  **Why:** reads from memory are ~100,000× faster than from disk/DB; absorbs read load.
  - **Cache-aside (the default pattern):** app checks cache → miss → read DB → write result to cache.
  - **Eviction:** **LRU** (drop least-recently-used) is the default when it's full.
  - **The cost (always name it):** **staleness** — cached data can be out of date. Mitigate with a
    **TTL** (expire after N seconds) or invalidate on write. **Trigger:** read-heavy + tolerates slight
    staleness.

- **CDN (CloudFront, etc.)** — geographically distributed cache for **static content** (images, JS,
  video) served from an edge near the user. **Why:** cuts latency and offloads your servers.
  **Trigger:** you're serving files/media to users in many places.

- **Message queue (Kafka, SQS, RabbitMQ)** — a buffer between producers and consumers; work is put on
  the queue and processed **asynchronously** later. **Why three things:** (1) **decouple** services,
  (2) **smooth spikes** (queue absorbs a burst the workers drain steadily), (3) **retry** failed work.
  **Trigger:** anything slow or spiky that doesn't need an instant answer — sending email, video
  encoding, fan-out, analytics. *Phrase:* "I'll do this off the request path via a queue so the user
  isn't blocked."

- **Blob / object storage (S3)** — cheap, durable storage for large files. **Why:** never store
  images/video as blobs *in your DB*; store them in S3 and keep the **URL** in the DB. **Trigger:**
  any user-uploaded file.

- **Replication** — keep copies of the DB. **Primary** takes writes; **read replicas** take reads.
  **Why:** scales *reads* and gives failover. **Cost:** **replication lag** — a replica can be
  momentarily behind (eventual consistency on the read path).

- **Sharding / partitioning** — split one big dataset across many DBs by a **shard key** (e.g.,
  `user_id % N`, or by hash). **Why:** the only way to scale *writes* and storage past one machine.
  **Cost:** cross-shard queries and JOINs get hard; a bad shard key creates **hot shards**.

- **Rate limiter** — caps requests per user/IP per window. **Why:** protect the system from abuse and
  overload. (Token-bucket is the classic algorithm; see the worked example.)

---

## 3. Scaling patterns (the "scalability section")

Most scalability questions are one of: *"how would you scale this?"* or *"what breaks at 100× traffic?"*
The answer is always **find the bottleneck, then apply a standard move.** Keep this ladder in your head:

**Vertical vs horizontal scaling**
- **Vertical** = bigger machine (more CPU/RAM). Simple, but a hard ceiling and a single point of
  failure. Good first answer for *small* growth.
- **Horizontal** = more machines behind a load balancer. **The real answer for scale.** Requires
  **stateless** services so any box can serve any request. Lead with this.

**The standard scaling ladder (apply in roughly this order):**
1. **Make app servers stateless + put them behind a load balancer.** Now you scale by adding boxes.
2. **Cache the hot reads** (cache-aside + TTL). Most systems are read-heavy; this is the biggest win.
3. **Add read replicas** for read load the cache misses; **CDN** for static assets.
4. **Move slow/spiky work off the request path with a queue** (async workers).
5. **Shard the database** when one primary can't hold the writes/storage. (Last resort — it's the
   most complex; do it only when replicas+cache aren't enough.)

**Read-heavy vs write-heavy (say which one you're dealing with — it dictates the moves):**
- **Read-heavy** (feeds, profiles, URL shortener): **cache + read replicas + CDN.** Reads are easy to
  scale because you can copy data freely.
- **Write-heavy** (analytics, logging, like-counters, chat): **queue to absorb the writes + shard the
  DB + sometimes NoSQL.** Writes are hard because every copy must agree. Often you **batch** writes or
  pre-aggregate.

**Bottleneck thinking (the meta-skill):** every component has a throughput limit. When asked to scale,
walk the request path and ask "what saturates first?" — usually the database. Then: cache in front of
it, replicas beside it, shard underneath it, queue around it. That's 90% of scalability answers.

**CAP theorem (intuitive version, don't overthink it):** when the network between your servers breaks
(a **P**artition — which *will* happen at scale), you must choose: **C**onsistency (everyone sees the
same data, even if that means erroring/waiting) **or** **A**vailability (always answer, even if the
data might be slightly stale). Banking → choose **C**. A social feed/like-count → choose **A** (a
slightly stale like count is fine). **The interview move:** say which you're choosing *and why it fits
the product.*

---

## 4. Numbers to know (back-of-envelope)

You don't need precision — you need to size the design and show you can reason about it.

**Latency ladder (orders of magnitude — memorize the shape, not the digits):**
- Read from **RAM/cache**: ~100 nanoseconds (≈ "instant")
- Read from **SSD**: ~100 microseconds (~1,000× slower than RAM)
- **Network round trip within a datacenter**: ~0.5 ms
- **Network round trip cross-country / cross-region**: ~50–150 ms
- *Takeaway you'll actually use:* cache/RAM is ~5 orders of magnitude faster than crossing a network
  to a DB. That's *why* caching is the biggest scaling lever.

**Throughput rules of thumb:**
- One modern app server: **~1,000s of requests/sec** for light work (more if cached, fewer if heavy).
- One SQL DB primary: **~1,000s of writes/sec** before you need replicas/sharding.
- A cache (Redis): **~100,000+ ops/sec.** (This is why you put it in front of the DB.)

**Estimating QPS from users:**
```
QPS (average) = daily active users × actions per user per day / 86,400 sec
Peak QPS      ≈ average × 2 to 5   (traffic isn't flat)
```
*Example:* 10M DAU × 10 actions = 100M/day ÷ 86,400 ≈ **1,160 QPS avg**, **~5,000 peak**.

**Estimating storage:**
```
storage/year = writes per day × bytes per record × 365
```
*Example:* 1M new rows/day × 1 KB × 365 ≈ **365 GB/year.** (Sizes whether one DB suffices.)

---

## 5. Worked example A — URL shortener (the canonical one)

This is the "hello world" of system design. Know it cold; many questions are variations.

**1. Requirements**
- Functional: `shorten(longURL) -> shortURL`; visiting `shortURL` redirects to `longURL`.
- Non-functional: **extremely read-heavy** (people click links far more than they create them);
  redirects must be **fast** (<100ms); high availability (a dead link service is very visible).
- Out of scope: custom aliases, analytics, expiration (mention you'd add later).

**2. Approximate**
- Say 100M new URLs/day is generous → ~1,160 writes/sec. Reads maybe 100× that → **read-heavy, design
  the read (redirect) path to scale hardest.**
- Storage: 100M/day × ~500 bytes × 365 ≈ ~18 TB/year → fits in a sharded DB; not crazy.

**3. Design**
- **API:**
  - `POST /shorten {longUrl} -> {shortUrl}`
  - `GET /{shortCode} -> 302 redirect to longUrl`
- **Data model:** one table `urls(short_code PK, long_url, created_at)`. You always look up **by
  short_code**, so it's the primary key — a single fast point lookup. (This access pattern is why even
  a key-value store works great here.)
- **The short code:** generate a unique 7-char code from `[a-zA-Z0-9]`. 62^7 ≈ 3.5 trillion codes —
  plenty. Two approaches, state the tradeoff:
  - **Counter + base62 encode** (take an auto-incrementing ID, encode to base62): guaranteed unique,
    short, but the counter is a write bottleneck/coordination point at scale.
  - **Random/hash then check-collision**: no central counter, but you must handle rare collisions
    (retry on duplicate). *I'd lead with base62 of a distributed ID generator.*
- **The boxes:** client → **LB** → stateless **app servers** → **DB**. Put a **cache (Redis)** in
  front of the DB keyed by `short_code` for the redirect path.

**4. Attack the bottleneck**
- The bottleneck is the **read/redirect path** (it's 100× the writes). Moves:
  - **Cache-aside on `short_code → long_url`** with a long TTL. Hot links live entirely in memory →
    sub-millisecond redirects, DB barely touched. *This is the single biggest win.*
  - **Read replicas** for cache misses.
  - **CDN / edge** can even serve very hot redirects.
  - Writes are 100× smaller and easy; if the URL table outgrows one DB, **shard by short_code hash.**

**5. Review (tradeoffs & failures)**
- Cache staleness is a non-issue here (a short_code→URL mapping never changes), so caching is "free" —
  call that out, it's a sharp observation.
- Single points of failure removed by the LB + replicas.
- "If I had more time: analytics via a queue (log each click async so it never slows the redirect),
  rate limiting on `POST /shorten` to stop abuse, and link expiration."

---

## 6. Worked example B — a read-heavy news feed (scaling tradeoffs)

This one exists to show the **read vs write scaling tradeoff** — exactly what a scalability section
probes. Keep it tighter than the shortener; the point is the fan-out tradeoff.

**1. Requirements:** users follow others; a user's home feed shows recent posts from people they
follow, newest first. Read-heavy (everyone scrolls); writes (posting) are rarer but **fan out** to
many followers.

**2. Approximate:** the interesting number is the **fan-out**: a post by someone with 1M followers
must reach 1M feeds. That asymmetry is the whole problem.

**3. Design — the core decision is *when* you do the fan-out work:**
- **Fan-out on write ("push"):** when you post, immediately write the post into every follower's
  precomputed feed (stored in a cache/feed table). **Reads are trivially fast** (just read your
  prebuilt feed). **Cost:** a post by a celebrity triggers millions of writes — a "fan-out storm."
- **Fan-out on read ("pull"):** store posts once; when a user opens the app, *query* the latest posts
  from everyone they follow and merge. **Writes are cheap.** **Cost:** reads are expensive
  (merge-on-the-fly), bad for active scrollers.
- **The real answer — hybrid (say this, it's the senior move):** push for normal users (fast feeds);
  **pull for celebrities** (don't fan-out to millions) and merge their recent posts in at read time.
  "I'd use fan-out-on-write for the common case and switch high-follower accounts to fan-out-on-read,
  to avoid the write storm."

**4. Attack the bottleneck:** feeds live in a **cache** (Redis lists per user); a **queue** does the
fan-out work asynchronously off the post request; posts and media in DB + **S3/CDN**.

**5. Review:** eventual consistency is fine here — a feed that's a few seconds behind is acceptable
(**choose Availability over Consistency**). The hybrid trades implementation complexity for surviving
the celebrity case.

---

## 7. What to say out loud (and what to avoid)

**Say:**
- "Let me clarify requirements first." (Always. Never skip to the design.)
- "This is read-heavy/write-heavy, so the bottleneck is the read/write path."
- "I'll use a cache here — faster reads, traded against staleness; for this case that's fine because…"
- "The tradeoff is X vs Y; I'm choosing X because the product needs…"
- "If I had more time, I'd add… (rate limiting / analytics via queue / monitoring)."

**Avoid:**
- Jumping straight to boxes before requirements. (#1 mistake.)
- Naming a technology without a reason. Never just "I'll use Kafka" — say *why* a queue helps here.
- Designing for infinite scale a small system doesn't need. Match the design to the numbers.
- Going silent. If you're thinking, narrate it: "I'm weighing SQL vs NoSQL here because…"

---

## One-page cheat sheet (re-read morning-of)

**Framework — RADAR:** Requirements (functional + non-functional + out-of-scope) → Approximate (QPS,
read/write ratio, storage) → Design (API → data model/access pattern → boxes) → Attack the bottleneck
→ Review (tradeoffs + failures).

**Building blocks:** LB (spread + health-check → horizontal scale) · stateless app servers · SQL
(default, ACID, related data) vs NoSQL (write-scale, flexible, eventual) · cache (read speed, cost =
staleness, cache-aside + TTL + LRU) · CDN (static at the edge) · queue (async, decouple, smooth
spikes, retry) · S3 (files; store the URL in the DB) · replication (scale reads, cost = lag) ·
sharding (scale writes, cost = hot shards + hard JOINs) · rate limiter.

**Scaling ladder:** stateless + LB → cache hot reads → read replicas + CDN → queue slow work → shard
the DB (last). Read-heavy = cache + replicas + CDN. Write-heavy = queue + shard (+ NoSQL).

**Numbers:** RAM ~100ns, SSD ~100µs, same-DC RTT ~0.5ms, cross-region RTT ~50–150ms. App server
~1,000s rps; SQL ~1,000s writes/s; Redis ~100k+ ops/s. QPS = DAU×actions/86,400; peak = ×2–5.

**CAP:** on a partition, pick Consistency (bank) or Availability (feed) — and say why it fits.

**Two designs:** URL shortener (read-heavy → cache the short_code lookup, base62 of an ID, shard by
hash). News feed (fan-out on write vs read → **hybrid**: push for normal users, pull for celebrities).
