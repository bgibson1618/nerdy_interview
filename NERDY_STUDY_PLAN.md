# Weekend Study Plan — Nerdy Code-Review Interview (Mon 2026-06-08)

*Prepared Fri 2026-06-05. Weekend = Sat 6/6 + Sun 6/7, with a light Monday-morning warm-up.*

## Confirmed: format & stack
You answered the two questions that shape everything:

- **Format — you review THEIR code.** They share a code sample/PR; you read it live, find bugs / design issues / edge cases, and discuss improvements with a senior engineer. *(This was "Scenario A" in the earlier draft — now confirmed, so the plan leans into it.)*
- **Stack — JavaScript / TypeScript + React.** Your drills, checklist, and resources below target JS/TS and React idioms and bug classes.

**Two things to keep in your back pocket:**
1. **They may still ask about your own project.** Even in a "review our code" round, senior interviewers often pivot to "tell me about something you built." ~80% of the prep overlaps anyway, so a *secondary* "defend your work" section is kept below — don't skip it. ([Exponent](https://www.tryexponent.com/blog/how-to-ace-a-code-review), [SmithSpektrum](https://www.smithspektrum.com/blog/code-review-interview-format-2026))
2. **Their stack matches your strength.** Per `NERDY_STACK.md`, Nerdy runs JS/TS + React — the language you're strongest in — so the sample is most likely in your wheelhouse. (Even if a snippet shows up in something else, the review *framework* transfers across languages.)

---

## What you're actually being tested on
At senior level they are **not** checking "can you write correct code under pressure." They're checking whether **the team can trust your judgment**: do you catch the issues that matter, ignore the noise, communicate respectfully, and make sound tradeoff decisions. **Communication is graded as heavily as the bugs you find.** ([Exponent](https://www.tryexponent.com/blog/how-to-ace-a-code-review), [SmithSpektrum](https://www.smithspektrum.com/blog/code-review-interview-format-2026))

### Know your audience: Nerdy / Varsity Tutors
- **Stack signals (authoritative — see `NERDY_STACK.md`):** **TypeScript/JavaScript + React** on the front end; **MySQL** and **SQL Server** for data; **OAuth, REST, Webhooks, gRPC, and GraphQL** across their APIs; **AWS-first** infrastructure; heavy **"AI-native"** positioning (they're rebuilding learning around AI). ([Nerdy Engineering](https://careers.nerdy.com/engineering))
- **Process:** recruiter screen → HireVue-style video → technical (this round) + behavioral/culture fit. Avg ~10-day loop. ([Glassdoor](https://www.glassdoor.com/Interview/Varsity-Tutors-Interview-Questions-E431872.htm))
- **Stack alignment — lean into it.** Your strength is **JS/TS + React**, which *is* their stack — there's no language gap to manage. Two implications:
  - Expect the sample in **JS/TS (likely React, or a Node/TypeScript service)**. Review with full fluency — language idioms, type safety, async pitfalls, and React patterns are all fair game to comment on. The 6-pass framework and core bug classes (off-by-one, null handling, race conditions, missing validation, plaintext secrets, untested paths) still anchor every review.
  - **Practice primarily in JS/TS + React** (the drills below already do). Skim the **MySQL / SQL Server** and **API-protocol** notes in the tech-stack section so you can speak to data and integration concerns if the sample touches them.
- **Tailoring move:** they care about **scalable, secure, AI-leveraged** systems. As you review, naturally surface **security, scale/performance, and "where would AI/automation help here"** — it speaks their language.

---

## The mental model to bring: review in passes (don't dive into nits)
Leading with style nits is the #1 "junior" tell. Senior reviewers go **top-down by severity**. Run these passes **out loud**:

1. **Context** — "What is this change trying to do? Who uses it? What could go wrong?" Restate intent; ask clarifying questions before judging. *(Spend 60–90s here before any comment — name the entry point and the inputs/outputs.)*
2. **Correctness** — Does it do what it intends? Edge cases, off-by-one, null/empty, concurrency/races, error paths, boundary inputs.
3. **Design** — Is this the right approach? Could it be simpler? Does it fit the existing architecture? Is it over-engineered for a speculative future?
4. **Safety** — Security (input validation, authz at the right layer, secrets, injection/XSS, sensitive-data exposure/logging), failure modes, data integrity, idempotency.
5. **Maintainability** — Naming, readability, tests (do they actually fail when the code breaks?), docs, comments that explain *why* not *what*.
6. **Nits** — Style/formatting. Flag lightly, prefix `Nit:`, and say automated linters should own most of this.

This mirrors **Google's reviewer guide** — the canonical reference and your single best read this weekend. ([What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html))

**Memorize three principles** (great to say out loud):
- *"There's no perfect code, only better code."* Approve when it improves overall health — don't block on personal preference.
- *"Comments should explain why, not what."*
- *"Solve today's problem, not a speculative future one."* (Flag over-engineering.)

---

## How to communicate (this is half your score)
- **Severity-tag every comment** so the engineer knows what's blocking vs. taste:
  `Blocker` (must fix) · `Should-fix` · `Question` · `Nit` · `Praise`.
- **Explain the risk, then propose an alternative.** "If two requests hit this at once, the counter races — could we use the DB sequence instead?"
- **Ask, don't assert,** when unsure: "Is this path reachable with an empty list?" It signals collaboration and avoids being wrong loudly.
- **Be specific and actionable.** Not "this is confusing" → "renaming `data` to `pendingUsers` makes the loop on line 12 read clearly."
- **Praise the good stuff.** Calling out a clean abstraction is a senior behavior, not flattery.
- **Separate must-fix from preference**, and say when you'd approve: "These two are blockers; the rest are nits — I'd approve after the input validation."
- **Think aloud constantly.** Silent reading tells them nothing. Narrate your passes — your *reasoning* is what's graded, not a silent verdict.

---

## The weekend schedule

### Friday night (~45 min) — orient, don't cram
- Skim **Google's reviewer guide** intro + "What to look for." ([link](https://google.github.io/eng-practices/review/reviewer/looking-for.html))
- Read **Exponent: How to Ace a Code Review** end-to-end. ([link](https://www.tryexponent.com/blog/how-to-ace-a-code-review))
- Write the **6-pass framework** above on an index card / sticky note you'll keep on-screen Monday.
- Skim the **JS/TS bug-class checklist** below; star the 5 classes you feel shakiest on.

### Saturday (~3.5 hrs) — build the muscle
1. **(45 min) Study.** Finish the Google guide ([standard](https://google.github.io/eng-practices/review/reviewer/standard.html)) + read the [18F code-review interview guide](https://guides.18f.gov/eng-hiring/interviews/code-review/) (the *interviewer's* rubric — gold).
2. **(45 min) Drill #1 — the planted-bug exercise below.** It's already in JS. Timed, out loud, severity-tagged. Then check the answer key and self-grade with the rubric.
3. **(60 min) Drill #2 — real PR review.** Pick a **merged** PR in an active **TypeScript / React** repo, review it *before* reading the discussion, write your comments, then compare against the real reviewers'. This is the single most-recommended practice technique. Repos to mine: `microsoft/TypeScript`, `vercel/next.js`, `facebook/react`, `nestjs/nest`, `trpc/trpc`. *(Nerdy is React-heavy, so prioritize a React or Node/TS PR.)* ([AlgoCademy](https://algocademy.com/blog/mastering-the-code-review-interview-a-comprehensive-guide/), [IGotAnOffer](https://igotanoffer.com/en/advice/google-code-review-interview))
4. **(30 min) TS refresher + retro.** Skim the TS Handbook *Narrowing* and *Do's and Don'ts*; note your blind spots from the drills (usually edge cases, error handling, tests).

### Sunday (~2.5 hrs) — sharpen + prep the "defend your work" pivot
1. **(30 min) Generate your own drill.** Ask an AI to produce a ~150-line **TypeScript** file with **8 planted defects of mixed severity** (1 security blocker, 2 correctness bugs, an async/await bug, edge cases, a design smell, missing tests, a nit). Review it timed, then ask for the key. Repeat once. Best stack-specific rep you can manufacture fast.
2. **(45 min) Security + checklist pass.** Read the [Augment 40-question checklist](https://www.augmentcode.com/guides/code-review-checklist-40-questions-before-you-approve) and skim [OWASP Top 10](https://owasp.org/www-project-top-ten/). Memorize the security questions in the checklist below — security is where Nerdy (AWS-first) and most interviewers expect a senior to shine.
3. **(45 min) "Defend your own work" prep (secondary, but likely).** Prepare:
   - A 2-minute architecture walkthrough (problem → approach → key tradeoffs).
   - For each major decision: **what you chose, what you rejected, and why.**
   - **Known weaknesses + what you'd do with more time** (admitting these is a senior signal).
   - Where you used AI in the build and how you validated its output (Nerdy loves this).
   - Use the practice question bank below.
4. **(30 min) Mock it live.** One real-time mock with a friend or an AI as interviewer — voice on, screen-share a code file, review it talking the whole time. Reproduces the pressure of narrating while reading. Self-grade with the rubric.

### Monday morning (~20 min) — warm up, don't learn
- Re-read your index card (the 6 passes + severity tags + your phrase cheat-list).
- Do one quick 10-minute planted-bug rep to get your "review voice" going.
- Prep your environment: quiet room, good mic, screen-share tested, water nearby.

---

## Reusable checklist (keep this on-screen Monday)

**Correctness**
- [ ] Off-by-one / boundary (`<=` vs `<`), empty input, null/undefined
- [ ] Edge cases & invalid input handled
- [ ] Concurrency / race conditions / shared state
- [ ] Error paths: are failures caught, surfaced, and recoverable?

**Design**
- [ ] Simpler way to do this? Over-engineered for a future that may not come?
- [ ] Fits existing architecture & patterns? Right layer?
- [ ] Clear interface/API; good separation of concerns

**Security** (OWASP-aligned)
- [ ] All external input validated/sanitized at the boundary (XSS, SQLi, injection)
- [ ] AuthZ enforced server-side, not just UI
- [ ] No secrets/keys/tokens in source or logs
- [ ] Sensitive data encrypted in transit/at rest, not over-logged or over-returned
- [ ] Safe defaults; least privilege

**Tests**
- [ ] Meaningful unit/integration coverage for the change
- [ ] Tests would actually **fail** if the code broke; clear assertions
- [ ] Edge cases covered, not just the happy path

**Readability / Maintainability**
- [ ] Names communicate intent without being verbose
- [ ] Comments explain *why*; dead/TODO comments cleaned up
- [ ] Function/class size reasonable; not deeply nested

**Performance** (only when it matters)
- [ ] N+1 queries, unnecessary loops/allocations, missing indexes, blocking I/O on hot path

### JS/TS-specific gotchas (your edge — scan for these by reflex)
**JavaScript**
- [ ] **async/await:** floating promise (missing `await`); `await` in a loop that should be `Promise.all`; `.map(async …)` returning unawaited promises; unhandled rejection
- [ ] **Equality/truthiness:** `==` vs `===`; falsy traps (`0`, `''`, `NaN`); `if (x)` when `x` can legitimately be `0`/`false`/`''`; `null` vs `undefined`
- [ ] **Mutation:** mutated inputs/props/state; in-place `sort`/`reverse`/`splice`; shared-reference bugs
- [ ] **Numbers:** float comparison; `parseInt` without a radix; `NaN` propagation
- [ ] **`this` / binding:** arrow vs function; context lost in callbacks
- [ ] **Error handling:** empty `catch`; throwing strings; not `await`ing inside `try` so the `catch` never fires

**TypeScript**
- [ ] `any` leaking through; `as` casts hiding real type errors; non-null `!` on something that can actually be null
- [ ] Loose/wrong types (`string` where a union belongs); unchecked index access; `enum` vs union-literal choices

**React (if it appears)**
- [ ] Wrong `useEffect` deps array; missing cleanup; stale closures
- [ ] `key` using array index; derived state stored in state; needless re-renders
- [ ] Mutating state directly instead of replacing it; XSS via `dangerouslySetInnerHTML`

**▶ Worked exercises:** [`study/exercises/js-ts-react-gotchas.md`](study/exercises/js-ts-react-gotchas.md) — 30 *buggy-snippet → why-it-slips-past-review → fix* drills across these gotcha classes. Do a handful out loud before Monday.

> Rule of thumb: real reviews catch 60–90% of bugs; the best ones stay **under ~400 LOC** and resist nitpicking — only ~15% of review comments address real defects, so aim your attention at logic/security/design, not formatting. ([Augment](https://www.augmentcode.com/guides/code-review-checklist-40-questions-before-you-approve))

---

## Self-grading rubric (score each mock review, /5 each → /35)
- [ ] Oriented (named intent + entry point) **before** critiquing
- [ ] Found the top correctness issue
- [ ] Prioritized — blockers before nits, with severity tags
- [ ] Comments specific & actionable
- [ ] Asked at least one clarifying question
- [ ] Communicated kindly / collaboratively (and praised one thing)
- [ ] Ended with a crisp summary + "I'd approve after X"

**Target 30/35 by Sunday night.** If you keep losing points on the same row, that's your Sunday re-drill.

---

## Drill #1 — Planted-bug exercise (do this first, timed ~12 min)
Review this as if it's a PR. Talk through your 6 passes, severity-tag findings, *then* read the key.

```js
// userService.js  — "Add user signup + fetch"
const users = [];

async function createUser(req, res) {
  const { email, password, age } = req.body;
  const user = {
    id: users.length + 1,
    email: email,
    password: password,
    age: age,
    createdAt: new Date(),
  };
  users.push(user);
  await sendWelcomeEmail(email);
  res.send({ id: user.id, email: user.email });
}

function getUser(req, res) {
  const id = req.query.id;
  for (var i = 0; i <= users.length; i++) {
    if (users[i].id == id) {
      return res.send(users[i]);
    }
  }
  res.status(404).send('not found');
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security):** Password stored in **plaintext**. Must hash (bcrypt/argon2) and never store raw.
2. **Blocker (Bug):** `i <= users.length` is an **off-by-one** — `users[users.length]` is `undefined`, so `undefined.id` throws. Should be `i < users.length`.
3. **Blocker (Security):** `getUser` returns the **whole user object including the password**. Whitelist returned fields.
4. **Should-fix (Correctness/Design):** `id = users.length + 1` collides after deletions and **races** under concurrent requests. Use a real DB sequence/UUID.
5. **Should-fix (Validation):** No validation of `email`, `password` strength, or `age`. Untrusted input goes straight into state.
6. **Should-fix (Error handling):** `await sendWelcomeEmail` has **no try/catch** — a mail failure rejects the request *after* the user was created (inconsistent state, unhandled rejection). Consider creating first, emailing async, and handling failure.
7. **Should-fix (Design/Scale):** In-memory `users` array — not persistent, lost on restart, not safe across instances. Fine for a toy; flag it in review.
8. **Nit:** `==` loose equality (string `id` from query vs number) works by coincidence; parse/validate the id. Use `let/const` not `var`. `email: email` → shorthand `email`.
9. **Praise:** Good that `createUser` returns a minimal projection (`{id, email}`) rather than the whole object — call out the good habit (then note `getUser` should do the same).

**Senior framing to say out loud:** "Two security blockers and one crash bug; I'd block on those. The id-generation and persistence are design concerns I'd raise but they may be out of scope for this PR. The rest are nits a linter should own."
</details>

**▶ More drills:** [`study/drills/`](study/drills/) — **16 planted-bug static drills** built on this same pattern: TS type-safety, React hooks, SQL, GraphQL, gRPC, OAuth, async/concurrency, error-handling, **test quality**, a web-security grab-bag, REST design, Node gotchas, caching, SQL Server/T-SQL, advanced TS, and React perf+a11y. Plus **8 PR review drills** you review in the real GitHub **Pull requests** tab (keys in [`study/drills/pr-review-keys.md`](study/drills/pr-review-keys.md)). See [`study/drills/README.md`](study/drills/README.md) for the index. A good Sunday loop: a static drill cold (timed, out loud) → a PR in the GitHub UI → self-grade against the key → repeat across areas, prioritizing GraphQL/gRPC and anything you fumble.

---

## "Defend your own work" question bank (secondary prep — they often pivot here)
Rehearse crisp 60–90s answers:
- Walk me through the architecture in two minutes.
- Why this framework/datastore/pattern over the alternatives? What did you reject?
- Where's the weakest part of this code? What would you fix first with another week?
- How does this scale to 100× traffic? Where does it break?
- How did you handle errors / failure / retries / idempotency?
- What's your testing strategy? What's *not* covered and why?
- Where did you use AI, and how did you verify it didn't introduce bugs?
- Walk me through a bug you hit and how you debugged it.
- If a teammate inherited this, what would confuse them?

**Senior signals:** admit tradeoffs and limitations openly, reason about scale/failure unprompted, and show you optimize for the *next* engineer.

### Smart questions to ask *them* (shows seniority)
- "What does a great code review look like on your team — what do reviewers optimize for?"
- "How do you balance review thoroughness against shipping velocity?"
- "How are you using AI in the engineering workflow today, and where's it going?"
- "What's the biggest source of tech debt or scaling pain right now?"

---

## Anti-patterns that read as "junior" (avoid)
- Starting with style nits instead of correctness/design.
- Silent reading — not narrating your thinking.
- Asserting bugs confidently when you're unsure (ask instead).
- Nitpicking everything with no severity signal (reviewer can't tell what matters).
- Demanding "perfect" code / blocking on preference.
- Ignoring tests and security.
- Getting defensive when *they* critique *your* code — treat it as a collaboration.

---

## Resource list (all verified, prioritized)

**Tier 1 — read this weekend**
- **Google Engineering Practices — Code Review (reviewer guide):** the canonical reference. [Intro](https://google.github.io/eng-practices/review/) · [What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html) · [The Standard](https://google.github.io/eng-practices/review/reviewer/standard.html) · [GitHub repo](https://github.com/google/eng-practices)
- **Exponent — How to Ace a Code Review Interview:** interview-specific tactics. [link](https://www.tryexponent.com/blog/how-to-ace-a-code-review)
- **18F — Code Review Interview Guide:** the *interviewer's* rubric — read it to know how you're scored. [link](https://guides.18f.gov/eng-hiring/interviews/code-review/)

**Tier 2 — checklists & deeper prep**
- **Augment — Code Review Checklist (40 questions):** distilled from Google/Microsoft/AWS/OWASP. [link](https://www.augmentcode.com/guides/code-review-checklist-40-questions-before-you-approve)
- **Conventional Comments:** the severity-label + phrasing convention to tag findings cleanly. [link](https://conventionalcomments.org/)
- **AlgoCademy — Mastering the Code Review Interview:** structure + how to practice on open-source. [link](https://algocademy.com/blog/mastering-the-code-review-interview-a-comprehensive-guide/)
- **IGotAnOffer — Google Code Review Interview:** framework + examples (applies broadly). [link](https://igotanoffer.com/en/advice/google-code-review-interview)
- **SmithSpektrum — The Code Review Interview Format (2026):** what this format assesses. [link](https://www.smithspektrum.com/blog/code-review-interview-format-2026)
- **OWASP Top 10:** the security vocabulary to drop naturally. [link](https://owasp.org/www-project-top-ten/)
- **Software Engineering at Google — Ch. 9 (Code Review):** the "why" behind the practices. [link](https://abseil.io/resources/swe-book/html/ch09.html)

**Tier 2 — JS/TS specific (your stack)**
- **You Don't Know JS Yet:** coercion, `this`, and async chapters — the canonical "why JS behaves this way." [link](https://github.com/getify/You-Dont-Know-JS)
- **TypeScript Handbook:** [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) · [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html) · [Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- **MDN:** [Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) · [async/await](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Promises) · [Equality comparisons](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Equality_comparisons_and_sameness)
- **react.dev (if React shows up):** [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) · [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)
- **Practice material:** [exercism.org TypeScript track](https://exercism.org/tracks/typescript) (read & critique others' published solutions); live reps via [Pramp](https://www.pramp.com/) or [interviewing.io](https://interviewing.io/).

**Tier 3 — Nerdy-specific**
- **InterviewQuery — Varsity Tutors SWE guide** (stack + process). [link](https://www.interviewquery.com/interview-guides/varsity-tutors-llc-software-engineer)
- **Glassdoor — Varsity Tutors interviews.** [link](https://www.glassdoor.com/Interview/Varsity-Tutors-Interview-Questions-E431872.htm)
- **Nerdy Engineering careers page** (AI-native framing, AWS-first). [link](https://careers.nerdy.com/engineering)

---

## Nerdy Tech Stack — What, Alternatives & Why It Fits

This stack comes from `NERDY_STACK.md`; the "why Nerdy would pick it" notes below are informed inference, not confirmed internal architecture.

**▶ Likely interviewer questions for every technology below — each with a senior-depth primer, six graduated questions + model answers (incl. the classic gotcha/failure-mode), and one-liners:** [`study/exercises/stack-interview-qa.md`](study/exercises/stack-interview-qa.md). Covers TS/JS, React, MySQL, SQL Server, OAuth, REST, Webhooks, GraphQL, and gRPC at the same depth. The review is in TypeScript, but the engineer may probe anything here.

### TypeScript/JavaScript
- **What it is:** JavaScript is the browser's native language and also runs on servers through Node.js; TypeScript adds static types, interfaces, generics, and safer tooling while still compiling to JavaScript.
- **Main alternatives:** Plain JavaScript with JSDoc, Flow, Dart, Kotlin/JS, Elm, ReScript, ClojureScript, or backend languages such as Java, Go, Python, Ruby, and C#.
- **Why it fits Nerdy:** For a large web education product, JS/TS fits browser-first product work, React, API clients, analytics, and shared tooling. TypeScript gives a scaled team better refactoring safety and clearer contracts than plain JS without leaving the mainstream web ecosystem.

### React
- **What it is:** React is a JavaScript/TypeScript library for building component-based user interfaces that update as application state changes.
- **Main alternatives:** Angular, Vue, Svelte/SvelteKit, Solid, server-rendered Rails/Django/Laravel templates, and React-based frameworks such as Next.js at the architecture level.
- **Why it fits Nerdy:** Nerdy likely has many learner, tutor, parent, and operations surfaces; React gives teams a mature ecosystem, strong TypeScript support, reusable component patterns, and a large hiring pool for complex web workflows.

### MySQL
- **What it is:** MySQL is a relational database for structured data, SQL queries, transactions, indexes, constraints, replication, and operational tooling.
- **Main alternatives:** PostgreSQL, SQL Server, Oracle Database, MariaDB, Amazon Aurora PostgreSQL/MySQL, and NoSQL stores such as DynamoDB.
- **Why it fits Nerdy:** MySQL is a pragmatic fit for web-product data such as accounts, scheduling, orders, and tutoring metadata where relational consistency matters. In an AWS-first environment, RDS or Aurora MySQL-compatible options make it operationally familiar and scalable.

### SQL Server
- **What it is:** SQL Server is Microsoft's relational database engine, with T-SQL, transactions, indexing, stored procedures, reporting features, and mature enterprise tooling.
- **Main alternatives:** MySQL, PostgreSQL, Amazon Aurora, Oracle Database, and analytical platforms such as Redshift, Snowflake, BigQuery, or Databricks for warehouse workloads.
- **Why it fits Nerdy:** SQL Server is plausible where legacy Varsity Tutors systems, Microsoft-oriented integrations, reporting workflows, or existing T-SQL models already exist. It can run in AWS through RDS for SQL Server or EC2, so it can coexist with a broader AWS-first stack.

### OAuth
- **What it is:** OAuth is an authorization framework for granting scoped access with tokens instead of sharing passwords; for login, it is commonly paired with OpenID Connect for identity claims.
- **Main alternatives:** Session-only username/password auth, API keys, SAML, LDAP/Kerberos, mutual TLS, proprietary token schemes, and passkeys depending on the use case.
- **Why it fits Nerdy:** A product serving students, parents, tutors, staff, partners, and APIs benefits from standardized delegated access and federated login. OAuth/OIDC also fits common SaaS identity providers and AWS-friendly identity patterns better than custom auth alone.

### REST
- **What it is:** REST is an HTTP, resource-oriented API style using URLs, verbs such as GET/POST/PATCH/DELETE, status codes, and standard web infrastructure.
- **Main alternatives:** GraphQL, gRPC, WebSockets, Server-Sent Events, SOAP, and JSON-RPC.
- **Why it fits Nerdy:** REST is the low-friction default for CRUD-heavy product surfaces such as users, bookings, payments, content, and admin workflows. It works cleanly with browsers, TypeScript clients, OAuth middleware, API gateways, caching, logging, and AWS edge/security tooling.

### Webhooks
- **What it is:** Webhooks are outbound HTTP callbacks sent when events happen, letting another system react asynchronously without polling.
- **Main alternatives:** Polling, scheduled batch exports, synchronous API calls, internal event buses such as EventBridge/SNS/SQS/Kafka, WebSockets, and Server-Sent Events.
- **Why it fits Nerdy:** Nerdy likely integrates with payment, CRM, support, marketing, analytics, and learning-operation systems. Webhooks are a standard vendor/partner integration pattern because they are faster and less wasteful than polling while keeping systems decoupled.

### gRPC
- **What it is:** gRPC is a high-performance RPC framework using Protocol Buffers contracts and HTTP/2 for strongly typed service calls and streaming.
- **Main alternatives:** REST, JSON-RPC, GraphQL, message queues/event streams, Apache Thrift, and Avro-based RPC.
- **Why it fits Nerdy:** For internal platform, personalization, or AI-adjacent services, gRPC can provide strict contracts, generated clients, efficient serialization, and reliable service-to-service calls. It is better suited to internal high-volume RPC than browser-facing APIs.

### GraphQL
- **What it is:** GraphQL is an API query language and runtime where clients request exactly the fields they need from a typed schema.
- **Main alternatives:** REST endpoints, Backend-for-Frontend services, gRPC for internal calls, OData, and client-side aggregation across multiple APIs.
- **Why it fits Nerdy:** Complex learner, parent, tutor, class, scheduling, content, and personalization views can require data from many backend domains. GraphQL can reduce overfetching and frontend orchestration while giving React teams a typed contract, though it is best reserved for complex read composition rather than every simple API.

---

## One-line game plan
**Lead with intent and severity, not nits. Narrate every pass. Find the security + correctness blockers first, raise design tradeoffs as questions, praise the good, and know when you'd approve.** You review in JS/TS by reflex — and that's exactly Nerdy's stack (JS/TS + React), so review with full fluency. Do 3–4 timed reps this weekend and you'll walk in fluent.

Good luck Monday.
