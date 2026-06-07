# Nerdy Stack — Interviewer Q&A (with model answers)

Companion to the "Nerdy Tech Stack" section of `../../NERDY_STUDY_PLAN.md`. The code review is
in TypeScript, but the senior engineer may probe the rest of the stack. Deep primers for
**GraphQL** and **gRPC** (zero-experience areas) are included with graduated questions + model answers.

---

# Stack Q&A — "they may probe beyond the TypeScript sample"

The code-review round is in TypeScript/React, but a senior interviewer often pivots to *"how
familiar are you with the rest of our stack?"* These are realistic probes per technology, each
with a 2–3 sentence talking-point to prep from. Match the senior register: name the tradeoff and
the alternative, don't just define the term. Sourced from `NERDY_STACK.md` and the "Nerdy Tech
Stack" section of `NERDY_STUDY_PLAN.md`.

---

## TypeScript/JavaScript

**Q:** Why TypeScript over plain JavaScript on a large, multi-team codebase?
**A:** Static types catch a whole class of bugs at compile time, make large refactors safe, and act
as living contracts between modules and teams — which is exactly what matters at Nerdy's scale. The
cost is build tooling and some annotation overhead, but you still ship plain JS (TS compiles down),
so you never leave the mainstream web ecosystem. The alternative — JS with JSDoc — gets you partway
but without enforced, refactor-aware contracts.

**Q:** What async/await pitfalls do you watch for in a Node/TypeScript service?
**A:** The big ones are floating promises (calling an async function without `await`, so errors
become unhandled rejections), `await` inside a loop that should be a `Promise.all`, and `.map(async …)`
returning unawaited promises. Because Node runs a single-threaded event loop, blocking CPU work on
the hot path stalls every request, so heavy work belongs on a queue or worker. I scan for missing
`await`s and empty `catch` blocks by reflex during review.

---

## React

**Q:** When is `useEffect` the right tool, and when is it a smell?
**A:** `useEffect` is for synchronizing with external systems — subscriptions, network, the DOM —
not for deriving data you can just compute during render. Storing derived state in state, or using
an effect to transform props, is the most common misuse and causes extra renders and stale-data
bugs. React's own "You Might Not Need an Effect" guidance is the rule of thumb I follow.

**Q:** Why React over Angular or Vue for a product like Nerdy?
**A:** React gives a mature ecosystem, first-class TypeScript support, reusable component patterns,
and the largest hiring pool — which matters when you have many learner, tutor, parent, and ops
surfaces. It's a library rather than a full framework, so you compose routing and data-fetching
(often via Next.js) to fit your needs. The tradeoff versus opinionated Angular is more decisions to
make, in exchange for more flexibility.

---

## MySQL

**Q:** When would you choose a relational database like MySQL over a NoSQL store?
**A:** When the data is structured and relationships and consistency matter — accounts, scheduling,
orders, tutoring metadata — relational gives you transactions, joins, constraints, and a mature
query language. NoSQL like DynamoDB wins for massive scale with simple access patterns or flexible
schemas, but you trade away joins and strong consistency. For most CRUD product data, MySQL on
RDS/Aurora is the pragmatic AWS-first default.

**Q:** A query is slow — how do you approach it?
**A:** I start by reading the `EXPLAIN` plan to see whether it's doing a full table scan versus
using an index, then add or adjust indexes on the columns in `WHERE`/`JOIN`/`ORDER BY`. Indexes
speed reads but cost write throughput and storage, so you index for real query patterns rather than
everything. I'd also check the app layer for N+1 query patterns — often the real fix is in *how* the
code queries, not the database.

---

## SQL Server

**Q:** Where would SQL Server realistically show up at an AWS-first company like Nerdy?
**A:** Usually in legacy or Microsoft-oriented systems — existing T-SQL models, stored-procedure-heavy
reporting, or integrations carried over from the Varsity Tutors side. It runs in AWS via RDS for SQL
Server or on EC2, so it coexists with an AWS-first stack instead of forcing an all-Microsoft world.
The engineering reality is you meet legacy systems where they are and migrate deliberately, not all
at once.

**Q:** MySQL and SQL Server are both in the stack — how do you reason about running both?
**A:** They're both mature relational engines; the choice is usually historical and ecosystem-driven
rather than one being technically superior. SQL Server brings rich T-SQL, stored procedures, and
enterprise reporting/tooling, while MySQL is lighter-weight and ubiquitous in web stacks. Running
both is common after acquisitions or organic growth — the cost is two sets of operational expertise,
so you'd consolidate over time where the payoff justifies it.

---

## OAuth

**Q:** Explain OAuth versus OpenID Connect — and authentication versus authorization.
**A:** OAuth is an *authorization* framework: it grants scoped, token-based access to a resource
without sharing a password ("let this app read your calendar"). OpenID Connect is a thin *identity*
layer on top that adds *authentication* — who the user is, via an ID token. Conflating the two is a
classic tell; OAuth alone authorizes access, OIDC adds login/identity.

**Q:** Why OAuth/OIDC for a product serving students, parents, tutors, staff, and partners?
**A:** You get standardized delegated access and federated login ("sign in with Google/Microsoft")
instead of every integration juggling raw passwords, which shrinks the attack surface. Scoped tokens
let you grant least privilege per client, and it plugs cleanly into SaaS identity providers and AWS
identity patterns. The tradeoff is more moving parts than plain session auth, so you reserve the full
flow for where delegation or federation actually buys you something.

---

## REST

**Q:** REST versus GraphQL versus gRPC — when do you reach for REST?
**A:** REST is the low-friction default for CRUD-heavy, browser-facing surfaces — users, bookings,
payments, content — because it rides standard HTTP infrastructure: caching, status codes, gateways,
logging, and OAuth middleware. GraphQL earns its keep when clients compose data from many domains
and you want to avoid overfetching; gRPC fits high-volume internal service-to-service calls. I'd
default to REST and reach for the others only when a specific pain justifies the added complexity.

**Q:** What separates a well-designed REST API from a sloppy one?
**A:** Resource-oriented URLs, correct verb semantics (GET is safe, PUT/DELETE are idempotent, POST
isn't), and meaningful status codes so clients can react programmatically rather than parsing prose.
Idempotency matters for retries — a client should be able to safely retry a PUT, or a payment with
an idempotency key, without double-applying it. Consistent error shapes and a versioning strategy
keep it maintainable as it evolves.

---

## Webhooks

**Q:** Webhooks versus polling — why use them, and what are the failure modes?
**A:** A webhook is an outbound HTTP callback fired when an event happens, so the consumer reacts
immediately instead of wastefully polling — it's the standard vendor/partner integration pattern for
payments, CRM, and the like, and it keeps systems decoupled. The hard parts are reliability and
trust: you need retries with backoff for failed deliveries, idempotent handlers because delivery is
at-least-once (duplicates and out-of-order arrivals happen), and a way to verify the sender. The
alternative, polling, is simpler but slower and wasteful at scale.

**Q:** How do you securely and reliably process an *incoming* webhook?
**A:** Verify the signature/HMAC on every payload so you know it genuinely came from the provider,
and reject anything that doesn't match. Make handlers idempotent by keying off the event ID, since
at-least-once delivery guarantees you'll see duplicates. Return a 2xx quickly and push the real work
onto a queue (SNS/SQS/EventBridge) so a slow handler doesn't cause the sender to time out and retry.


---

## GraphQL

> Prep note: You have zero hands-on GraphQL experience, and that's fine. You will NOT be asked to write a production resolver on the spot. You WILL be expected to (a) explain what GraphQL is and why it exists, (b) reason about its tradeoffs vs REST, and (c) show judgment about when it's the wrong tool. This section gets you to that bar. Be honest in the interview ("I haven't shipped GraphQL, but here's my mental model") — confident, accurate reasoning beats fake war stories.

### What you actually need to know (primer)

- **It's a typed query language for APIs, defined by a schema.** The schema is the contract between client and server. You declare *object types* with *fields*, built on scalars (`Int`, `Float`, `String`, `Boolean`, `ID`) plus `enum`, `interface`, `union`, and `input` types. Written in SDL (Schema Definition Language). Example: `type User { id: ID!, name: String!, sessions: [Session!]! }` — the `!` means non-null. Because the schema is typed and machine-readable, GraphQL gives you *introspection* (the API can describe itself), which powers autocomplete, docs, and tools like the GraphiQL/Apollo explorer.

- **The client asks for exactly the fields it wants, and gets back that exact shape.** You send a query; the JSON response mirrors it. Ask for `{ user { name } }` and you get just the name — not the whole user object. This "client-specified response shape" is the single most important idea in GraphQL and the root of most of its advantages.

- **Three operation types: queries, mutations, subscriptions.** A **query** reads data (like an HTTP GET). A **mutation** writes data — create/update/delete (like POST/PUT/PATCH/DELETE) — and can return the updated object in the same round trip. A **subscription** is a long-lived stream of server-pushed updates, normally over a WebSocket, for real-time features (live chat, a classroom whiteboard, "tutor is online"). Convention: mutations run sequentially, query fields resolve in parallel.

- **Resolvers are the functions that actually fetch each field's data.** The schema says *what* exists; resolvers say *how* to get it. Every field can have its own resolver, and they execute as a tree that matches the query's shape — e.g. resolve `user`, then for that user resolve `sessions`, then for each session resolve `tutor`. A resolver might hit a database, call a REST microservice, or read a cache. This is the bridge between the typed schema and your real backend.

- **One endpoint, not many.** A GraphQL API is typically a single URL (`POST /graphql`); the operation in the request body decides what happens. Contrast with REST, where each resource/shape gets its own URL (`/users/1`, `/users/1/sessions`, ...). One endpoint + client-chosen fields is the core structural difference from REST.

- **It directly solves over-fetching and under-fetching.** *Over-fetching* = a REST endpoint returns more than the screen needs (you call `/user/1` and get 30 fields to show a name and avatar). *Under-fetching* = one endpoint isn't enough, so the client makes several round trips and stitches the data together (get user, then get their sessions, then each session's tutor). GraphQL fixes both: one request, only the requested fields, with related/nested data fetched in the same call. This is especially valuable for **mobile** clients on slow or metered networks.

- **The N+1 problem is the classic GraphQL gotcha — know it cold.** Naïve resolvers fire one query for a list, then one *more* query per item in that list: fetch 10 sessions (1 query), then fetch each session's tutor individually (10 queries) = 11 ("N+1"). Under load this hammers your database. The standard fix is a **DataLoader** (per-request batching + caching): instead of resolving each tutor immediately, it collects all the requested tutor IDs in one tick of the event loop, issues a single batched query (`WHERE id IN (...)`), and caches results so duplicate IDs aren't re-fetched. Alternatives: resolve via SQL joins, or precompute. Just naming "N+1" and "DataLoader batching" signals real understanding.

- **Where a company like Nerdy would actually use it.** Nerdy (Varsity Tutors) is a learning marketplace with web + native mobile apps backed by many services — student/tutor profiles, scheduling and tutor availability, live session data, course catalog, messaging, reviews, billing/subscriptions. A GraphQL layer (often a "gateway" or BFF — backend-for-frontend) lets one flexible API aggregate all of those so each screen fetches exactly what it needs in one round trip, without the client juggling a dozen REST endpoints or the backend shipping a new endpoint for every UI change. Mobile bandwidth savings and faster product iteration are the practical wins; **subscriptions** fit live-classroom / real-time tutoring features. Expect them to run GraphQL in front of, not instead of, internal microservices that may still speak REST/gRPC to each other.

### Graduated interview questions + model answers

**Q1 (basic) — "What is GraphQL, in your own words?"**
*Model answer / talking points:* "GraphQL is a typed query language and runtime for APIs. Instead of many fixed REST endpoints, you expose a single endpoint backed by a schema that describes every type and field available. The client sends a query asking for exactly the fields it wants, and the response comes back in that same shape as JSON." Add the one-line hook: "The defining idea is that the *client* decides what data it gets, not the server." If you want a bonus point: "It was created at Facebook around 2012 and open-sourced in 2015, originally to let mobile apps fetch exactly what a screen needed in one request."

**Q2 (basic→intermediate) — "What's the difference between a query, a mutation, and a subscription? And what's a resolver?"**
*Model answer / talking points:* "A **query** reads data — think GET. A **mutation** changes data — create, update, or delete — like POST/PUT/DELETE, and it can return the changed object so the client doesn't need a second request. A **subscription** is a real-time stream: the server pushes updates to the client over a persistent connection, usually a WebSocket — good for live features. A **resolver** is the server-side function behind a field; the schema declares what fields exist, and each resolver knows how to actually fetch that field's value — from a database, another service, or a cache. The resolvers execute as a tree mirroring the query." Beginner-safe framing: "Schema = the menu; resolvers = the kitchen that makes each dish."

**Q3 (intermediate) — "How does GraphQL differ from REST? When is that difference an advantage?"**
*Model answer / talking points:* "Structurally: REST has many endpoints, each returning a fixed payload; GraphQL has one endpoint and the client specifies the response shape. The big practical advantage is killing **over-fetching** and **under-fetching** — instead of downloading fields you don't need, or making three round trips to assemble one screen, you make a single request for exactly what you need, including nested related data. You also get a strongly typed, self-documenting schema with introspection, which makes tooling and frontend/backend collaboration smoother. Where it shines: complex, data-rich UIs and mobile clients, and aggregating multiple backend services behind one flexible API." Show balance: "REST still wins on simplicity and HTTP-native caching — I'd weigh both."

**Q4 (intermediate→advanced) — "What is the N+1 problem in GraphQL and how do you solve it?"**
*Model answer / talking points:* "It comes from per-field resolvers. Say you query a list of 10 tutoring sessions and each session's tutor. The list resolver runs one query, then the tutor resolver runs once per session — that's 1 + 10 = 11 database calls, and it scales with the list size, which crushes the DB under load. The standard fix is a **DataLoader**: it batches all the individual tutor-ID lookups that happen in one event-loop tick into a single query like `SELECT * FROM tutors WHERE id IN (...)`, and caches per request so repeated IDs aren't fetched twice. Other options are resolving with SQL joins or denormalizing/precomputing. The key insight is that GraphQL's flexible nesting makes N+1 easy to introduce, so you design resolvers with batching in mind." This is the single highest-value answer to nail — it proves you understand GraphQL's real-world failure mode, not just the happy path.

**Q5 (tradeoffs) — "What are the downsides or hidden costs of GraphQL compared to REST?"**
*Model answer / talking points:* Name several concretely:
  - **Caching is harder.** REST leans on HTTP caching (URLs, `Cache-Control`, CDNs) almost for free. GraphQL's single POST endpoint with arbitrary query bodies doesn't cache at the HTTP layer the same way, so you push caching into the client (Apollo/Relay normalized cache) or add persisted queries / server-side caching.
  - **Server complexity & performance footguns** — resolvers, schema design, and N+1 require deliberate engineering (DataLoader, etc.).
  - **Security/abuse surface:** a client can craft expensive deeply-nested or recursive queries, so you need **query depth limiting, complexity analysis, timeouts, and persisted/allow-listed queries**; rate-limiting is also trickier than per-endpoint REST.
  - **Weaker fit for some things:** file uploads, binary data, and simple status/health endpoints are more natural over plain REST. Error handling is also different — GraphQL often returns HTTP 200 with an `errors` array rather than HTTP status codes.
  - **Learning curve & tooling buy-in** for the whole team. "So it's a real tradeoff: more frontend flexibility in exchange for more backend responsibility."

**Q6 (judgment) — "When would you NOT use GraphQL?"**
*Model answer / talking points:* "I'd avoid it when its strengths don't apply and its costs do:
  - **Simple APIs** with a few resources and one known client — REST is less overhead and easier to cache.
  - **CRUD or internal service-to-service** APIs where shapes are stable and predictable — GraphQL adds a layer for little benefit; REST or gRPC is often better.
  - **Cacheability is the priority** — public, read-heavy, CDN-cached content maps cleanly to REST URLs.
  - **File uploads / binary / streaming downloads**, or webhooks and simple health checks — more natural over plain HTTP.
  - **Small team / tight timeline** without GraphQL experience — the schema, resolver, and caching machinery may not pay for itself yet.
The honest summary: GraphQL earns its keep when you have many clients (especially mobile), complex and evolving data needs, or you're aggregating multiple services. If you don't have those pressures, REST is usually simpler and cheaper." Ending on "right tool for the problem" judgment is exactly what the *when-NOT* question is testing.

### One-liners to have ready
- "Client decides the response shape — that's the whole point."
- "Schema is the menu, resolvers are the kitchen."
- "N+1 is the classic trap; DataLoader batching is the classic fix."
- "GraphQL trades easy HTTP caching for query flexibility."
- "It's usually a gateway in front of microservices, not a replacement for them."


---

## gRPC

> Audience: a candidate with **zero hands-on gRPC**. Goal: sound informed, reason about tradeoffs, and not get caught flat if Nerdy probes it. You don't need to have shipped gRPC — you need an accurate mental model and honest framing ("I haven't used it in production, but here's how I understand it and when I'd reach for it").

### What you actually need to know (the primer)

- **What it is.** gRPC is a high-performance **RPC (Remote Procedure Call)** framework open-sourced by Google. Instead of thinking in URLs and verbs like REST, you call a **method on a remote service as if it were a local function** (`client.GetUser(req)`), and gRPC handles serialization, transport, and wiring. The "g" is just Google's framework name, not "Google-only" — it's a CNCF project used industry-wide.

- **Protocol Buffers (protobuf) / the IDL.** You define your API once in a `.proto` file — an **Interface Definition Language**. It declares `message` types (the data shapes) and `service` definitions (the methods, with their request/response types). Example:
  ```proto
  syntax = "proto3";
  service UserService {
    rpc GetUser (GetUserRequest) returns (User);
  }
  message GetUserRequest { string id = 1; }
  message User { string id = 1; string name = 2; }
  ```
  The `= 1`, `= 2` are **field tags** (stable wire identifiers), not values. Protobuf is a **binary**, schema-driven serialization format — much smaller and faster to encode/decode than JSON, but **not human-readable** on the wire.

- **Code generation / typed clients.** You run the protobuf compiler (`protoc`, or build-tool plugins) against the `.proto` and it **generates strongly-typed client and server stubs** in many languages (Go, Java, Python, C++, TypeScript/Node, C#, etc.). This is a major selling point: the `.proto` is a **single source of truth / contract**, and both sides get type-safe code for free. No hand-writing request/response models or guessing JSON field names.

- **Runs on HTTP/2.** gRPC uses **HTTP/2** as its transport, and that's where a lot of its performance and feature set come from: a **single long-lived connection** carries many concurrent requests (**multiplexing**, no head-of-line blocking at the HTTP/1.1 level), **binary framing**, **header compression (HPACK)**, and **bidirectional streaming**. Contrast with typical REST over HTTP/1.1, which is one request/response per connection turn.

- **Four call types.** This is a favorite interview detail:
  1. **Unary** — one request, one response (the "normal" RPC, closest to REST).
  2. **Server streaming** — one request, a **stream** of responses (e.g. "subscribe to a feed", live progress, large result sets).
  3. **Client streaming** — a **stream** of requests, one response (e.g. uploading chunks, then a summary).
  4. **Bidirectional streaming** — both sides stream independently over the same connection (e.g. real-time chat, live collaboration, telemetry). All built on HTTP/2 streams.

- **How it differs from REST.** REST is an architectural style over HTTP using resources/URLs + verbs (GET/POST/...) and usually JSON; it's **human-readable, browser-native, cacheable, and loosely coupled**. gRPC is a **contract-first binary RPC**: faster and more compact, with **first-class streaming**, **strict typed contracts**, and **multi-language codegen** — at the cost of being **opaque on the wire**, **not directly callable from a browser** (without a proxy), and **less ad-hoc/curl-friendly**.

- **Performance characteristics.** Generally **lower latency and higher throughput** than JSON/REST because: binary protobuf is compact and cheap to (de)serialize, HTTP/2 multiplexes and compresses headers, and connections are reused. The wins are most visible in **high-volume, low-latency, service-to-service** traffic — not in a one-off call where network round-trip dominates. (Always frame perf claims as "depends on payload size, language, and load" — don't overclaim.)

- **Where a company like Nerdy would actually use it.** The honest, high-signal answer: **internal service-to-service communication** inside the backend — e.g. a scheduling/matching service talking to a user service, a billing service, a sessions/streaming service — where you control both ends, want typed contracts across teams/languages, and care about latency and throughput. It is **not** a natural fit for the **browser-facing / public API**, because browsers can't speak raw gRPC. For browser or third-party clients you'd expose **REST/JSON or GraphQL** at the edge (or use **gRPC-Web** through a proxy like Envoy). So a realistic pattern: **REST/GraphQL at the edge, gRPC between microservices internally.**

### Graduated interview questions + model answers

**1. (Basic) What is gRPC, and what's the role of Protocol Buffers?**
*Model answer / talking points:* "gRPC is a high-performance RPC framework — you call a method on a remote service as if it were local, and the framework handles transport and serialization. You define the API in a `.proto` file using Protocol Buffers, which is both the **interface definition language** and a **binary serialization format**. From that one `.proto`, a compiler generates typed client and server code in many languages, so the schema is a shared contract. The data on the wire is compact binary protobuf rather than JSON." *(Shows the core mental model: contract-first, codegen, binary.)*

**2. (Basic→mechanism) Why does gRPC use HTTP/2, and what does that give you?**
*Model answer / talking points:* "HTTP/2 gives gRPC a few things HTTP/1.1 doesn't: **multiplexing** many requests over one long-lived connection without head-of-line blocking, **binary framing**, **header compression**, and **streaming in both directions**. That's what makes gRPC efficient for chatty service-to-service traffic and what enables its streaming call types. Reusing one connection also avoids repeated connection setup overhead." *(If pushed: HTTP/2's stream concept is what the four call types are built on.)*

**3. (Knowledge depth) Walk me through the four kinds of gRPC calls. When would you use streaming?**
*Model answer / talking points:* "Unary is one-request/one-response — the default, like a normal REST call. Server streaming is one request and a stream of responses — good for subscriptions, live progress, or paging through a big result set. Client streaming is a stream of requests and one response — good for uploading chunks and getting a summary back. Bidirectional streaming is both sides streaming at once over the same connection — good for real-time things like chat, live collaboration, or continuous telemetry. I'd reach for streaming when data is **continuous or large** and I don't want to make the caller poll repeatedly." *(Concrete examples are what sell this.)*

**4. (Tradeoffs) gRPC vs REST — what are the real tradeoffs, and what do you give up by choosing gRPC?**
*Model answer / talking points:* "gRPC's wins: it's **faster and more compact** (binary protobuf + HTTP/2), gives you **typed contracts and codegen** across languages, and has **first-class streaming**. What you give up: it's **not human-readable** on the wire, so it's harder to debug with curl or a browser; it's **not directly callable from browsers** without gRPC-Web and a proxy; HTTP-level **caching and the broad tooling/ecosystem** around REST/JSON are weaker; and you take on the **build-time codegen step** and schema management. REST is simpler, more universal, and easier for ad-hoc/public consumption. So it's: **performance + strict contracts vs. ubiquity + simplicity.**" *(Naming what you give up signals maturity.)*

**5. (Judgment) When would you NOT use gRPC?**
*Model answer / talking points:* "I'd avoid it for **public or browser-facing APIs**, because browsers and third-party developers expect REST/JSON (or GraphQL) and can't speak raw gRPC. I'd avoid it where **human-readability and easy debugging/curl-ability** matter more than raw speed, or for **simple, low-volume CRUD** where REST's simplicity wins and gRPC's perf advantage is negligible. I'd also think twice if the **team has no gRPC/protobuf experience and no need for it** — the tooling, proxies (e.g. Envoy for gRPC-Web), and schema discipline add operational overhead that has to be justified. And where **HTTP caching at the edge** is a big lever, REST fits better." *(The "why not" is the question Nerdy is most likely to use to separate buzzword from understanding.)*

**6. (Applied / company-specific) Where in a platform like Nerdy's would gRPC fit, and where wouldn't it?**
*Model answer / talking points:* "I'd expect gRPC **internally, service-to-service** — say between a tutor-matching/scheduling service, a user/identity service, a billing service, and a live-session service — where Nerdy controls both ends, wants **typed contracts shared across teams and languages**, and cares about latency and throughput. Streaming could fit **live tutoring/session** features (real-time events, presence, telemetry). I would **not** put raw gRPC on the **browser/public edge** — I'd keep REST/GraphQL there for the web and mobile clients, optionally bridging with **gRPC-Web** through a proxy. So the shape is: **REST/GraphQL at the edge, gRPC between microservices.** I want to be upfront that I haven't run gRPC in production myself, but that's the architecture I'd reason from." *(Honest framing + a concrete, plausible architecture is the strongest possible answer for a zero-experience candidate.)*

### Two terms worth being able to define if asked
- **gRPC-Web:** a variant + proxy layer (commonly via Envoy) that lets **browser** JavaScript talk to gRPC services, since browsers can't use raw gRPC/HTTP-2 framing directly. This is the standard answer to "but how does the frontend call gRPC?"
- **Field tags / `proto3`:** the numbers in a `.proto` (`name = 2;`) are **wire field identifiers** that must stay stable for backward compatibility; `proto3` is the current protobuf syntax version. Knowing this signals you understand **schema evolution** (you add fields with new tags; you don't reuse or renumber old ones).

### One-sentence honesty framing to keep ready
"I haven't used gRPC hands-on in production, but I understand it as a **contract-first, binary RPC framework over HTTP/2** that shines for **internal, high-throughput, typed service-to-service** communication — and I'd keep REST/GraphQL at the public/browser edge." *(Confident, accurate, and doesn't overclaim experience.)*
