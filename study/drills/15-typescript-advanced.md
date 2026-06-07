## Submission grading service — Advanced TypeScript (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// assessment/grading.ts — scores a student's submission against a course rubric.
// Pure module; the only untrusted input is the JSON body in parseSubmission.

type Brand<T, B> = T & { readonly __brand: B };
type StudentId = Brand<string, "StudentId">;

const ID_RE = /^stu_[a-z0-9]{8}$/;

// Validated constructor: the only honest way to mint a StudentId.
export function asStudentId(raw: string): StudentId {
  if (!ID_RE.test(raw)) throw new Error(`malformed student id: ${raw}`);
  return raw as StudentId;
}

// Every kind of question the platform knows how to grade.
type Question =
  | { kind: "multiple-choice"; id: string; choices: string[]; answer: number }
  | { kind: "short-answer"; id: string; expected: string; caseSensitive?: boolean }
  | { kind: "code"; id: string; tests: string[]; weight: number }
  | { kind: "true-false"; id: string; answer: boolean };

type Rubric = {
  totalPoints: number;
  passMark: number;
  questions: Question[];
};

type Submission = {
  student: StudentId;
  responses: Record<string, unknown>;
};

// Narrow an untrusted response down to an integer choice index.
function isChoiceResponse(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

// Parse the JSON body a client POSTs to /grade.
export function parseSubmission(body: string): Submission {
  const raw = JSON.parse(body) as unknown;
  return raw as unknown as Submission;
}

const KIND_WEIGHT = new Map<string, number>([
  ["multiple-choice", 1],
  ["short-answer", 1],
  ["code", 3],
]);

function weightFor(kind: string): number {
  return KIND_WEIGHT.get(kind)!;
}

function gradeOne(q: Question, response: unknown): number {
  switch (q.kind) {
    case "multiple-choice":
      return isChoiceResponse(response) && response === q.answer ? 1 : 0;
    case "short-answer": {
      const got = String(response);
      const want = q.expected;
      return (q.caseSensitive ? got === want : got.toLowerCase() === want.toLowerCase())
        ? 1
        : 0;
    }
    case "code":
      return q.tests.length > 0 ? q.weight : 0;
    default:
      return 0;
  }
}

export function gradeSubmission(rubric: Rubric, submission: Submission): number[] {
  return rubric.questions.map((q) => {
    const response = submission.responses[q.id];
    // @ts-expect-error mobile client wraps answers as { value: ... }
    const raw = response.value;
    return gradeOne(q, raw) * weightFor(q.kind);
  });
}

function pick<T = any>(obj: Record<string, T>, key: string): T {
  return obj[key];
}

export function summarize(rubric: Partial<Rubric>, scores: number[]): string {
  const earned = scores.reduce((a, b) => a + b, 0);
  const pct = (earned / rubric.totalPoints!) * 100;
  const verdict = pct >= rubric.passMark! ? "PASS" : "FAIL";
  return `${earned} pts · ${pct.toFixed(1)}% · ${verdict}`;
}

// HTTP-layer wiring.
export function handleGrade(body: string, rubric: Rubric): string {
  const submission = parseSubmission(body);
  const scores = gradeSubmission(rubric, submission);
  const source = pick<string>({ source: "api" }, "source");
  return `[${source}] ${summarize(rubric, scores)}`;
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security / trust boundary):** `parseSubmission` (line ~43) does `JSON.parse(body) as unknown` then `raw as unknown as Submission`. The double-cast launders a raw, attacker-controlled JSON blob straight into a trusted, *branded* `Submission` — so `submission.student` is typed `StudentId` while at runtime it's any string the client sent. *Why it slips past review:* the validated `asStudentId` constructor exists right above, so a skimmer assumes ids are validated somewhere; the cast reads like a harmless "I know the shape." *Fix:* validate at the boundary (zod/io-ts or a hand-written guard) and run `student` through `asStudentId` — never `as unknown as` across a trust boundary.

2. **Blocker (Soundness):** `gradeOne` (line ~58) switches on `q.kind` only the three seeded variants are graded; the `default: return 0` catch-all silently scores the fourth (`true-false`) variant — and any future `kind` — as **0** instead of grading it. *Why it slips past review:* the `default` looks like defensive coding, and because it makes the function total the compiler is happy — nothing signals that a real case is unhandled. (Drop the catch-all and the function instead *fails* to compile under `strict`: with `strictNullChecks`, a `: number` function that can fall off the end is a `TS2366` error — the good outcome you actually want. That's the safety the `default` quietly throws away.) Downstream, the silent `0` also collides with the missing `weightFor` entry (finding 4) to produce `NaN`. *Fix:* remove the catch-all and add `default: return assertNever(q)` (a `never`-typed helper) so adding a variant becomes a compile error rather than a silent `0`.

3. **Blocker (Runtime crash the types hide):** In `gradeSubmission` (line ~78) the `// @ts-expect-error` suppresses a genuine "object is of type 'unknown'" error on `response.value`. For any question the student didn't answer, `responses[q.id]` is `undefined`, so `response.value` throws `Cannot read properties of undefined`; for flat primitive answers it reads `undefined` and mis-grades silently. *Why it slips past review:* `@ts-expect-error` "compiles clean" precisely *because* the error it hides is real, and the comment makes it sound like a vetted legacy-shape workaround. *Fix:* delete the directive, narrow `response` with a guard (or normalize the wire format), and only then read it.

4. **Should-fix (Correctness):** `weightFor` (line ~54) does `KIND_WEIGHT.get(kind)!`. The map has no `"true-false"` entry, so `.get` returns `undefined`; the `!` silences it and the `undefined` multiplies into the score as `NaN`. *Why it slips past review:* the `!` looks like a confident "this key always exists," and the three seeded keys make the map look complete. *Fix:* return a real default (`?? 0`) or, better, make the map total over the union (see finding 7).

5. **Should-fix (Correctness):** `summarize` (line ~89) takes `Partial<Rubric>` and then asserts `rubric.totalPoints!` / `rubric.passMark!` — but those fields are *required* for this computation. A partial rubric divides by `undefined`, producing `NaN%` in user-facing output, and `pct >= undefined!` is always `false` → spurious "FAIL". *Why it slips past review:* `Partial<T>` looks like polite "accept whatever the caller has," and the `!`s make the required-ness invisible. *Fix:* take the precise type it needs — `Pick<Rubric, "totalPoints" | "passMark">` (or the full `Rubric`) — and drop the assertions.

6. **Nit (Generics):** `pick<T = any>` (line ~85) defaults the type parameter to `any`, so at call sites where `T` can't be inferred the return is `any` and all downstream checking is erased (e.g. `handleGrade`'s `source`, which only happens to be a string). *Why it slips past review:* `<T = any>` looks like a reasonable convenience default. *Fix:* default to `unknown` (forcing callers to narrow), or constrain `T` and let inference do the work.

7. **Nit (API design / lost exhaustiveness):** `weightFor(kind: string)` (line ~53) widens the discriminant to `string`, which is *why* the missing `"true-false"` weight (finding 4) was never a compile error. *Why it slips past review:* a `string` key on a `Map<string, number>` looks idiomatic. *Fix:* type the param `Question["kind"]` and back it with `const KIND_WEIGHT: Record<Question["kind"], number>` — adding a variant then fails to compile until you give it a weight.

8. **Praise (Type safety):** `isChoiceResponse` (line ~37) is a *correct* user-defined type guard — it actually inspects the value (`typeof v === "number" && Number.isInteger(v)`) before narrowing `unknown` to `number`, and it's used to gate the multiple-choice comparison. This is the honest inverse of the `as unknown as Submission` cast in finding 1: same goal (turn `unknown` into a known type) done with a runtime check instead of a lie to the compiler. Keep this pattern and make the boundary parse in finding 1 look like it.

**Senior framing to say out loud:** "I'd block merge on three things: the `as unknown as Submission` cast is a trust-boundary hole that defeats the branded `StudentId`, the non-exhaustive `gradeOne` silently `NaN`s real grades, and the `@ts-expect-error` will throw on the first unanswered question. The `Partial`-rubric and `Map.get!` `NaN`s are fast-follows in the same family. The through-line is that every bug is a spot where someone talked the compiler out of a true complaint — so the fix is uniform: replace the casts and `!`s with the kind of runtime guard the file already has in `isChoiceResponse`, and turn on `noImplicitReturns`."
</details>
