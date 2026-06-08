# Live-agent shared-blackboard (stigmergy) demo — result

Three **real, heterogeneous** roster agents — `alice` (claude), `bob` (codex),
`cleo` (gemini-3-flash) — built a shared stack fact-sheet coordinating **only through the
blackboard**: no orchestrator, **no `--peers`, zero messages exchanged**. Pure stigmergy.

## Board outcome
```
shards_total=6 open=0 claimed=0 done=6 synthesis=done solved=yes
```
Synthesis (executive summary) written by: **alice**

## Who claimed which section (emergent division, no negotiation)
```
[1] TypeScript structural typing  <-  alice
[2] React reconciliation and hooks  <-  alice
[3] MySQL InnoDB MVCC and isolation  <-  cleo
[4] gRPC streaming and deadlines  <-  alice
[5] GraphQL N+1 and dataloader  <-  cleo
[6] OAuth 2.0 Authorization Code + PKCE  <-  alice
```

## The fact-sheet the agents built (Level-1 sections)
### [1] TypeScript structural typing — by alice
TypeScript uses structural typing, meaning type compatibility is determined by the shape of a type (its members) rather than by explicit declarations or names. If two types have the same structure, they are considered compatible, regardless of their nominal identity. This contrasts with nominal typing found in languages like Java or C#, and it underpins TypeScript interfaces, duck typing, and flexible object assignment.

### [2] React reconciliation and hooks — by alice
React reconciliation is the diffing process React uses to compare a new virtual DOM tree against the previous one and apply the minimal set of real DOM updates. The algorithm relies on element type and key props to decide whether to reuse, update, or remount components, which is why stable keys in lists are important. Hooks such as useState and useEffect let function components hold state and run side effects across renders, and they must be called unconditionally at the top level so React can match them positionally between renders.

### [3] MySQL InnoDB MVCC and isolation — by cleo
MySQL InnoDB uses Multi-Version Concurrency Control to handle simultaneous data access without locking most read operations. It relies on undo logs and transaction IDs to provide consistent snapshots based on the configured isolation level, such as REPEATABLE READ. This mechanism ensures high performance and ACID compliance in multi-user environments.

### [4] gRPC streaming and deadlines — by alice
gRPC supports four call types: unary, server streaming, client streaming, and bidirectional streaming, all multiplexed over a single HTTP/2 connection. Streaming lets either side send a sequence of messages over one logical call, which suits real-time feeds, large transfers, and long-lived exchanges. Deadlines (or timeouts) let a client specify the maximum time a call may take, and they propagate across service hops so downstream calls are cancelled when the budget is exhausted, preventing resource leaks and cascading latency.

### [5] GraphQL N+1 and dataloader — by cleo
The N+1 problem in GraphQL occurs when a query for a list of items triggers separate database lookups for each item's related fields. The Dataloader utility addresses this by batching and caching requests, collapsing multiple individual queries into a single efficient operation. This optimization is crucial for maintaining performance in complex, nested API structures.

### [6] OAuth 2.0 Authorization Code + PKCE — by alice
The OAuth 2.0 Authorization Code grant lets a client obtain an access token by first receiving a short-lived authorization code via the user agent, then exchanging it for tokens at the token endpoint using a back-channel request. PKCE (Proof Key for Code Exchange) hardens this flow against authorization code interception by having the client generate a random code verifier, send its hashed code challenge on the authorization request, and present the original verifier during the token exchange. Originally designed for mobile and native public clients, PKCE is now recommended for all clients, including confidential and single-page web apps.

## Level-2 synthesis (only postable once every section was done)
Together these sections trace a modern full-stack web application from language to network edge. TypeScript structural typing shapes safe, flexible code on both client and server, while React reconciliation and hooks drive efficient, stateful user interfaces. The data and service tier rests on MySQL InnoDB MVCC for concurrent ACID storage, with gRPC streaming and deadlines linking internal services and GraphQL with Dataloader batching taming N+1 queries at the API boundary. Spanning the whole stack, OAuth 2.0 Authorization Code with PKCE secures user authorization, showing how type safety, rendering, persistence, transport, API design, and security each address a distinct layer of the same system.

## Stigmergy confirmation — were any A2A messages sent?
A2A inbox lines across all agents: **0** (expected 0 — they never messaged; they
coordinated entirely by reading/writing the shared board).

## Per-agent self-reports
### alice
```

## Synthesis
- Ran `./bb synth alice` → received `OK`, so I won synthesis rights.
- Read all posted sections via `./bb sections` (sections 3 and 5 were contributed by peer agents).
- Wrote and posted the executive summary via `./bb final alice ...`.

## One-line report
Claimed sections 1, 2, 4, 6; yes, I wrote the synthesis (executive summary).
```
### bob
```
Claimed sections: none; synthesis: not written.
```
### cleo
```
- **Section 3: MySQL InnoDB MVCC and isolation**: MySQL InnoDB uses Multi-Version Concurrency Control to handle simultaneous data access without locking most read operations. It relies on undo logs and transaction IDs to provide consistent snapshots based on the configured isolation level, such as REPEATABLE READ. This mechanism ensures high performance and ACID compliance in multi-user environments.
- **Section 5: GraphQL N+1 and dataloader**: The N+1 problem in GraphQL occurs when a query for a list of items triggers separate database lookups for each item's related fields. The Dataloader utility addresses this by batching and caching requests, collapsing multiple individual queries into a single efficient operation. This optimization is crucial for maintaining performance in complex, nested API structures.

## Synthesis Status
Another agent was assigned the synthesis task.

## Final Summary
I claimed section ids 3 and 5, and I did not write the synthesis.
```
