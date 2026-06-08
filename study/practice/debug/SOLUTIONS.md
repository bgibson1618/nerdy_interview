# Debugging set 1 — answer key

Try each one first. Each entry: the **bug class**, what's wrong, and the fix. Learning the *class*
matters more than the specific fix — interviewers reuse the same handful of bug shapes.

| # | Function | Bug class | The bug → the fix |
|---|---|---|---|
| 1 | `sumArray` | **off-by-one (loop start)** | `let i = 1` skips index 0. → `let i = 0`. |
| 2 | `findMax` | **wrong initial value / edge case** | `max = 0` returns 0 for all-negative arrays. → init `max = nums[0]` (or `-Infinity`). |
| 3 | `average` | **off-by-one (wrong divisor)** | divides by `length - 1`. → divide by `nums.length`. |
| 4 | `isPalindrome` | **off-by-one (index)** | `j = s.length` is one past the end (`s[j]` is `undefined`). → `j = s.length - 1`. |
| 5 | `factorial` | **wrong initial value** | `result = 0` makes every product 0. → `result = 1` (multiplicative identity). |
| 6 | `fizzbuzz` | **condition order** | `% 15` is checked last, so multiples of 15 match `% 3` first and print "Fizz". → check `% 15` (or `%3 && %5`) **first**. |
| 7 | `countOccurrences` | **`=` vs `===`** | `if (nums[i] = target)` assigns (and mutates!), and is truthy for any non-zero target → counts everything. → `if (nums[i] === target)`. |
| 8 | `binarySearch` | **boundary `<` vs `<=`** | `while (low < high)` exits before checking the final 1-element window, missing values at the high end. → `while (low <= high)`. |
| 9 | `removeDuplicates` | **mutating while iterating** | `splice(i,1)` shifts the next element into `i`, but `i++` skips it → adjacent dups survive. → `i--` after splice, or build a new array, or use a `Set`. |
| 10 | `isPrime` | **off-by-one (loop bound)** | `i <= n` includes `i === n`, so `n % n === 0` marks every number non-prime. → `i < n` (better: `i * i <= n`). |
| 11 | `secondLargest` | **missing state update** | when a new max is found it forgets to push the old max down to `second`. → in the `n > largest` branch, set `second = largest` **before** `largest = n`. |
| 12 | `passingStudents` | **boundary `>` vs `>=`** | `s > passing` excludes a score exactly equal to the mark; the spec says equal passes. → `s >= passing`. |

## The bug-class checklist (scan for these in the interview)

When handed a buggy function, read it once for intent, then scan for the usual suspects — most planted
bugs are one of these:

1. **Off-by-one** — loop starts at 1, `<=` vs `<`, `length` vs `length - 1`, `mid` vs `mid - 1`.
2. **Wrong initial value** — sum/count starting at 1, product starting at 0, max starting at 0 instead
   of `-Infinity`/`nums[0]`.
3. **Boundary / comparison operator** — `>` vs `>=`, `<` vs `<=` at the exact edge value.
4. **`=` vs `===`** (assignment in a condition) and `==` coercion surprises.
5. **Condition order** — the most specific case (e.g. `% 15`) must be checked before the general ones.
6. **Edge cases** — empty array, single element, negatives, zero, duplicates, all-same.
7. **Mutating a collection while looping over it** — `splice`/`delete` inside a forward `for`.
8. **Wrong variable / swapped arguments** — `a` used where `b` was meant.
9. **Missing or premature `return`** — returning inside a loop too early; forgetting a return.

## How to debug out loud (this is graded, like live coding)

1. **State the intent** — "this should return the average." Know what *correct* looks like.
2. **Run / read the failing case** — "it got 6, expected 4 on `[2,4,6]`."
3. **Trace the failing input by hand**, narrating — "sum is 12, divided by… length-1 is 2 → 6. There's
   the bug, the divisor is wrong."
4. **Name the class** — "off-by-one in the divisor."
5. **Fix minimally**, then **re-run all cases** to confirm you didn't break another.
6. **Don't silently stare** — narrate the whole hunt; the reasoning is what they're scoring.
