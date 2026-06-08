# Live-coding playbook (2-day version)

**Format:** shared editor (CoderPad/Codility-style), you write running code while talking. **You
already code in JS/TS** — so this track is *method + pattern recognition + narration*, not learning
syntax. The interviewer is grading your **problem-solving process and communication** at least as much
as the final code. A working solution narrated silently scores *worse* than a half-solution where you
clearly reasoned aloud.

Examples are in JavaScript/TypeScript.

---

## 1. The loop — UMPIRE (say each step out loud)

Never start typing immediately. Run this loop visibly:

1. **U — Understand.** Restate the problem in your words. Ask about: input types, size/range, empty or
   null inputs, duplicates, sorted or not, negative numbers, expected output format. **Write down 1–2
   concrete examples** (including an edge case). *Phrase:* "Let me make sure I understand… so given
   `[2,7,11]` and target `9`, I return the indices `[0,1]`? And if no pair exists — return empty, or is
   it guaranteed?"
2. **M — Match.** "What kind of problem is this?" Map it to a pattern from the cheatsheet below.
   *Phrase:* "Looking for a pair that sums to a target — that's a hash-map / two-pointer pattern."
3. **P — Plan.** State your approach in plain English **before** coding. Often: state the brute force,
   give its complexity, then state the optimization. *Phrase:* "Brute force is nested loops, O(n²). I
   can do O(n) with a hash map storing complements as I go." **Get a nod before coding.**
4. **I — Implement.** Now code, narrating as you go. Write clean, named code; handle the edge cases you
   listed. If you get stuck on a detail, leave a `// TODO` and keep the structure moving.
5. **R — Review.** Trace your code by hand on your example *and* an edge case. Read it like a reviewer:
   off-by-one? null/empty? does the loop bound hold? "Let me trace `[3,3]`, target 6…"
6. **E — Evaluate.** State final **time and space complexity** and any tradeoff. *Phrase:* "O(n) time,
   O(n) space for the map. I could trade to O(1) space by sorting first, but that's O(n log n) time and
   loses the original indices."

**The single biggest scoring lever: narrate continuously.** Your reasoning is the signal. Silence reads
as "stuck / no process."

---

## 2. Pattern cheatsheet (recognize → reach)

Most interview problems are one of these. Learn the **trigger** (what in the prompt signals it) and the
**move**.

| Pattern | Trigger words in the prompt | The move | Typical cost |
|---|---|---|---|
| **Hash map / frequency** | "have you seen", "count", "pair that sums", "anagram", "duplicate" | store seen items / counts in a `Map` or object for O(1) lookup | O(n) time, O(n) space |
| **Two pointers** | **sorted** array, "pair/triplet", "remove in place", palindrome | one pointer at each end (or slow/fast), move inward | O(n) time, O(1) space |
| **Sliding window** | "longest/shortest **substring/subarray**", "contiguous", "at most K" | grow/shrink a window with two indices, track a running stat | O(n) time |
| **Binary search** | **sorted** + "find", "first/last position", "minimum that satisfies" | halve the search space each step | O(log n) |
| **BFS** | "shortest path", "level by level", grid/graph, "fewest steps" | queue, visit neighbors layer by layer, mark visited | O(V+E) |
| **DFS / recursion** | "all paths", "explore", tree/graph, "connected", "permutations" | recurse / explicit stack; mark visited | O(V+E) |
| **Backtracking** | "all combinations/permutations/subsets", "generate every…" | choose → recurse → un-choose | exponential (it's the nature) |
| **Stack** | "matching/balanced parentheses", "next greater", "undo", "evaluate expression" | push/pop; LIFO | O(n) |
| **Heap / top-K** | "K largest/smallest", "median", "most frequent" | min/max-heap of size K | O(n log k) |
| **Prefix sum** | "range sum", "subarray sums to K" | precompute cumulative sums | O(n) |
| **DP** (basic) | "min/max ways", "can you reach", "longest …", overlapping subproblems | memoize subresults / build a table | varies |

**When you don't recognize it:** start with **brute force**, get *something* working and correct, state
its complexity, *then* optimize. A correct brute force beats an elegant nothing. Interviewers routinely
accept brute force first and ask you to improve — so leading with it is a feature, not a weakness.

---

## 3. Complexity quick-reference

**Big-O of common operations:**
- Array index access: O(1) · push/pop end: O(1) · `unshift`/`splice` front: O(n) · `includes`/`indexOf`: O(n)
- Map/Set/object get/set/has: O(1) average · Object/Map iteration: O(n)
- Sort: O(n log n)
- Nested loop over n: O(n²)

**Growth intuition (why it matters):** O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ) < O(n!).
For n = 1,000,000: O(n) is fine, O(n log n) is fine, **O(n²) is a trillion ops — too slow.** If the
input is large, an O(n²) solution is a signal to find a hash-map or two-pointer improvement.

**Space:** count extra memory you allocate (the hash map, the recursion stack, the output usually
doesn't count). A recursive solution uses O(depth) stack space — mention it.

---

## 4. Worked problem — Two Sum (with full narration)

**Prompt:** given an array of integers and a target, return the indices of the two numbers that add to
the target.

**Narrate:**
> "*Understand* — input is an int array and a target int; I return two indices. Can there be multiple
> answers? I'll assume exactly one. Negatives allowed? I'll handle them — my approach doesn't care.
> Example: `[2,7,11,15]`, target `9` → `[0,1]`.
> *Match/Plan* — I'm looking for a pair summing to a value; brute force is nested loops, O(n²). Better:
> one pass with a hash map of `value → index`. For each number, check if its **complement**
> (`target - num`) is already in the map. O(n) time, O(n) space.
> *Implement* —"
```ts
function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>();      // value -> index
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) return [seen.get(complement)!, i];
    seen.set(nums[i], i);                       // store AFTER checking, so we don't match an element with itself
  }
  return [];                                    // no pair found
}
```
> "*Review* — trace `[3,3]`, target 6: i=0 store {3:0}; i=1 complement 3 is in map → return `[0,1]`. ✓
> Note I store *after* the check so a single `3` can't pair with itself. Empty array → returns `[]`.
> *Evaluate* — O(n) time, O(n) space. The brute force was O(n²); the map trades space for speed."

That narration — examples, brute-force-then-optimize, the off-by-one defense, the trace, the final
complexity — *is* what's being scored. The 8 lines of code are almost incidental.

---

## 5. Worked problem — valid parentheses (stack pattern)

**Prompt:** given a string of `()[]{}`, return whether brackets are balanced and correctly nested.

> "*Match* — 'matching/balanced brackets' → **stack**. Push openers; on a closer, the top of the stack
> must be its matching opener, else it's invalid. At the end the stack must be empty."
```ts
function isValid(s: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch);
    } else {                                   // it's a closer
      if (stack.pop() !== pairs[ch]) return false;  // top must match (pop of empty is undefined ≠ opener)
    }
  }
  return stack.length === 0;                   // leftover openers = unbalanced
}
```
> "*Review* — `"([)]"`: push `(`, push `[`, then `)` pops `[` ≠ `(` → false. ✓ `"()"`: push `(`, `)`
> pops `(` match, stack empty → true. ✓ Edge: `"]"` → pop of empty is `undefined` ≠ `[` → false. ✓
> *Evaluate* — O(n) time, O(n) space."

---

## 6. The "I'm stuck" recovery script (rehearse this once)

Getting stuck is normal and *recoverable* — freezing silently is what tanks you. When stuck:

1. **Say it, don't hide it.** "Let me think about this for a second" — buys time honestly.
2. **Go back to a concrete example** and solve it *by hand*. The manual steps often reveal the
   algorithm. "Let me just trace what I'd do on paper for `[1,2,3]`…"
3. **Fall back to brute force.** Get *anything* correct on the board, state its complexity, then improve.
   Working-but-slow >> elegant-but-blank.
4. **Think aloud about the bottleneck.** "The slow part is this repeated lookup — could a hash map make
   it O(1)?" The interviewer often nudges you when they hear the right thread.
5. **Use them — it's collaborative.** "I'm between a heap and sorting here — do you have a preference for
   where to take it?" Asking is a *plus*, not a minus; pairing well is part of the grade.

**Never:** go silent for 60 seconds, erase everything in a panic, or insist on a wrong path after a hint.

---

## One-page cheat sheet (re-read morning-of)

**UMPIRE:** Understand (restate + examples + edge cases) → Match (which pattern) → Plan (brute force +
complexity, then optimize — *out loud, before coding*) → Implement (narrate) → Review (trace an example
+ an edge case) → Evaluate (state time/space + tradeoff).

**Pattern triggers:** count/pair/seen → **hash map** · sorted + pair → **two pointers** · longest
contiguous substring → **sliding window** · sorted + find → **binary search** · shortest path/levels →
**BFS** · all paths/explore → **DFS** · all combos/permutations → **backtracking** · balanced brackets/
next-greater → **stack** · K largest/most frequent → **heap** · range sum → **prefix sum** · min/max
ways + overlapping → **DP**.

**Costs:** O(n²) is too slow for large n → look for a hash-map/two-pointer/binary-search win. Map/Set
ops O(1); sort O(n log n); recursion costs O(depth) stack.

**The three habits:** clarify + examples before coding · narrate continuously · brute force first if
unsure, then optimize. When stuck: say it, trace by hand, fall back to brute force, use the interviewer.
