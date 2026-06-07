## Tutoring-session service review — TypeScript type-safety (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
import { createHash } from "node:crypto";

/**
 * TutoringSessionService — scheduling, billing, and event ingestion for the
 * live-tutoring backend. Sessions are held in-process and mirrored onto an
 * event stream that the billing worker replays.
 */

// A validated, server-issued user id. The brand stops raw request strings from
// being passed anywhere a trusted id is expected.
type UserId = string & { readonly __brand: "UserId" };

export function isUserId(value: unknown): value is UserId {
  return typeof value === "string" && /^usr_[a-z0-9]{12}$/.test(value);
}

type SessionStatus =
  | { kind: "scheduled"; startsAt: number }
  | { kind: "active"; startedAt: number }
  | { kind: "completed"; durationMin: number }
  | { kind: "cancelled"; reason: string };

interface TutoringSession {
  id: string;
  tutorId: UserId;
  studentId: UserId;
  subject: string;
  ratePerHour: number;
  status: SessionStatus;
}

interface CreateSessionInput {
  tutorId: UserId;
  studentId: UserId;
  subject: string;
  ratePerHour: number;
}

const sessions = new Map<string, TutoringSession>();
let nextId = 1000;

function makeSessionId(seed: string): string {
  const h = createHash("sha1").update(seed + nextId++).digest("hex");
  return "ses_" + h.slice(0, 12);
}

// POST /sessions — create a session from the request body.
export function createSession(body: unknown): TutoringSession {
  const input = body as CreateSessionInput;
  const session: TutoringSession = {
    id: makeSessionId(input.studentId),
    tutorId: input.tutorId,
    studentId: input.studentId,
    subject: input.subject,
    ratePerHour: input.ratePerHour,
    status: { kind: "scheduled", startsAt: Date.now() },
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): TutoringSession {
  return sessions.get(id)!;
}

// Decode a lifecycle event that arrives as JSON text on the stream.
function decodeSessionEvent(raw: string) {
  return JSON.parse(raw);
}

export function applySessionEvent(raw: string): void {
  const event = decodeSessionEvent(raw);
  const session = getSession(event.sessionId);
  if (event.type === "started") {
    session.status = { kind: "active", startedAt: event.at };
  } else if (event.type === "completed") {
    // a zero-minute completion is an upstream data error — drop it
    if (event.durationMin == 0) return;
    session.status = { kind: "completed", durationMin: event.durationMin };
  } else if (event.type === "cancelled") {
    session.status = { kind: "cancelled", reason: event.reason };
  }
  notifyStudent(event.studantId, event.type);
}

// Minutes we can bill for in the current status.
function billableMinutes(status: SessionStatus): number {
  switch (status.kind) {
    case "scheduled":
      return 0;
    case "active":
      return Math.floor((Date.now() - status.startedAt) / 60000);
    case "completed":
      return status.durationMin;
  }
}

export function invoiceTotal(id: string): number {
  const session = getSession(id);
  const minutes = billableMinutes(session.status);
  return Math.round((minutes / 60) * session.ratePerHour * 100) / 100;
}

function notifyStudent(studentId: UserId, eventType: string): void {
  // fire-and-forget; wired to the notifications service elsewhere
  void [studentId, eventType];
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security):** `createSession` does `const input = body as CreateSessionInput` — an `as` cast that *launders* the raw request body into trusted, branded types. No validation runs, so a caller can set `tutorId`/`studentId` to any string (or `ratePerHour` to a negative number) and it's stored as a trusted `UserId`. It slips because the cast makes the file type-check cleanly and reads like deliberate, idiomatic code. Fix: validate the body (zod/io-ts) or mint each id through the `isUserId` guard this module already exports — never assert your way from `unknown` to a branded type.

2. **Blocker (Crash):** `getSession` returns `sessions.get(id)!`. `Map.get` is `T | undefined`; the non-null `!` erases the `undefined`. An unknown or evicted id returns `undefined` *typed as* `TutoringSession`, and the first property access at a call site (`session.status`, `session.ratePerHour`) throws `Cannot read properties of undefined`. It slips because `!` silences the one diagnostic that would have flagged it. Fix: return `TutoringSession | undefined` and handle the miss (typed NotFound / explicit null) at each caller.

3. **Should-fix (Type-safety):** `decodeSessionEvent` has no return annotation, so `JSON.parse` hands back `any`. Every downstream read of `event` in `applySessionEvent` (`event.type`, `event.sessionId`, `event.durationMin`, `event.at`) is unchecked and that `any` propagates outward. It slips because there's no `any` keyword anywhere — it leaks implicitly out of `JSON.parse`. Fix: parse into `unknown`, model the event as a discriminated union, and narrow via a schema or type guards before use.

4. **Should-fix (Correctness):** `notifyStudent(event.studantId, ...)` — `studantId` is a typo for `studentId`. Because `event` is `any` (see #3), the misspelling compiles and resolves to `undefined` at runtime, so every notification is addressed to `undefined`. It slips for exactly one reason: the leaked `any` removed the property-name checking that would have caught the typo on a typed object. Fix: once `event` is a validated union type, the compiler flags the misspelling immediately.

5. **Blocker (Correctness):** `billableMinutes` is annotated `: number`, but the `switch` omits the `"cancelled"` case, so a cancelled session falls through and returns `undefined`. `invoiceTotal` then computes `(undefined / 60) * rate` → `NaN`, emitting NaN invoices. It slips because `noImplicitReturns` is **not** part of `strict`, so TypeScript accepts the missing return path. Fix: handle `cancelled`, and add `default: { const _exhaustive: never = status; return _exhaustive; }` so any future status variant fails the build instead of silently returning `undefined`.

6. **Should-fix (Validation):** `if (event.durationMin == 0) return;` uses loose `==` on an `any` value. Coercion means `"0"`, `""`, `false`, and `[]` all equal `0`, so legitimate completed events get silently dropped — and the field was never validated as a number to begin with. It slips because `== 0` looks innocuous and the `any` hides that `durationMin` may arrive as a string off the wire. Fix: validate `durationMin` as a number, then use `===` (or `<= 0`).

7. **Nit (Maintainability):** module-level `let nextId = 1000`, mutated inside `makeSessionId`, is shared mutable state. It isn't safe across concurrent requests or workers, resets to 1000 on every restart (id-collision risk), and makes the function non-deterministic to test. It slips because it's a tiny convenience that works fine in a single-process dev run. Fix: use a UUID/ULID or crypto-random id and drop the counter.

8. **Praise (Type design):** the branded `type UserId = string & { readonly __brand: "UserId" }` paired with the `isUserId` type guard is exactly right — it makes "validated id" a distinct, unforgeable type and provides a runtime check to mint one. Call out the irony: the module built the safe tool here and then bypassed it with the `as` cast in #1. Keep the brand; route every external id through `isUserId`.

**Senior framing to say out loud:** "I'd block on three: the `as CreateSessionInput` cast (untrusted input becomes a trusted branded type with zero validation), the `sessions.get(id)!` crash, and the `billableMinutes` fall-through that NaNs real invoices — those are a security hole and a money bug. I'd raise the leaked `any` from `JSON.parse` and the `studantId` typo it hides as must-fix-before-merge, since they're the root of the downstream unsoundness, and flag the `== 0` coercion in the same breath. The mutable `nextId` is a lint-level nit I'd leave inline — and I'd genuinely credit the branded `UserId` + guard as the pattern to copy, right after noting we undercut it with the cast."
</details>
