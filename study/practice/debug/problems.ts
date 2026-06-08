// ============================================================================
// DEBUGGING SET 1 — each function has ONE planted bug (a couple have a related
// second symptom). They are LOGIC / general-coding bugs, NOT type errors:
// everything compiles clean (`npm run check:practice` passes), but some tests
// below FAIL at runtime.
//
// HOW TO USE:
//   1. Run it:  npx tsx study/practice/debug/problems.ts   (or `npm run debug`)
//   2. Read each ✗ failure: what was expected vs what it got.
//   3. Trace the failing input by hand, find the bug, fix the FUNCTION in place.
//   4. Re-run until every line is ✓.  Don't edit the test harness at the bottom.
//
// Try to name the BUG CLASS each time (off-by-one, wrong init, boundary <=/<,
// = vs ===, condition order, edge case, mutate-while-iterating, ...). The
// answer key is in SOLUTIONS.md — only peek after you've tried.
// ============================================================================

// 1. Should return the sum of all numbers in the array.
function sumArray(nums: number[]): number {
  let total = 0;
  for (let i = 1; i < nums.length; i++) {
    total += nums[i];
  }
  return total;
}

// 2. Should return the largest number in the array (numbers may be negative).
function findMax(nums: number[]): number {
  let max = 0;
  for (const n of nums) {
    if (n > max) max = n;
  }
  return max;
}

// 3. Should return the average (mean) of the numbers.
function average(nums: number[]): number {
  let total = 0;
  for (const n of nums) total += n;
  return total / (nums.length - 1);
}

// 4. Should return true if the string reads the same forwards and backwards.
function isPalindrome(s: string): boolean {
  let i = 0;
  let j = s.length;
  while (i < j) {
    if (s[i] !== s[j]) return false;
    i++;
    j--;
  }
  return true;
}

// 5. Should return n! (n factorial). factorial(5) = 120.
function factorial(n: number): number {
  let result = 0;
  for (let i = 1; i <= n; i++) {
    result *= i;
  }
  return result;
}

// 6. Should return ["1","2","Fizz",...]: "Fizz" for /3, "Buzz" for /5,
//    "FizzBuzz" for /15, else the number as a string. (1-indexed up to n.)
function fizzbuzz(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else if (i % 15 === 0) out.push("FizzBuzz");
    else out.push(String(i));
  }
  return out;
}

// 7. Should return how many times `target` appears in `nums`.
function countOccurrences(nums: number[], target: number): number {
  let count = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] = target) count++;
  }
  return count;
}

// 8. Should return the index of `target` in a sorted array, or -1 if absent.
function binarySearch(sorted: number[], target: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid] === target) return mid;
    if (sorted[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

// 9. Should remove duplicate values, keeping first occurrences, in place.
//    removeDuplicates([1,1,1,2]) -> [1,2]
function removeDuplicates(nums: number[]): number[] {
  for (let i = 0; i < nums.length; i++) {
    if (nums.indexOf(nums[i]) !== i) {
      nums.splice(i, 1);
    }
  }
  return nums;
}

// 10. Should return true if n is prime. (n < 2 is not prime.)
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

// 11. Should return the second-largest number in the array.
//     secondLargest([2,1,4,3,5]) -> 4
function secondLargest(nums: number[]): number {
  let largest = -Infinity;
  let second = -Infinity;
  for (const n of nums) {
    if (n > largest) {
      largest = n;
    } else if (n > second) {
      second = n;
    }
  }
  return second;
}

// 12. Should count how many scores are passing. A score EQUAL to the passing
//     mark counts as passing. passingStudents([60,59,70,60], 60) -> 3
function passingStudents(scores: number[], passing: number): number {
  let count = 0;
  for (const s of scores) {
    if (s > passing) count++;
  }
  return count;
}

// ============================================================================
// TEST HARNESS — do not edit. Run the file; fix functions until all are ✓.
// ============================================================================
let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}  → expected ${e}, got ${a}`);
  }
}

check("sumArray([1,2,3,4])", sumArray([1, 2, 3, 4]), 10);
check("findMax([-5,-2,-9])", findMax([-5, -2, -9]), -2);
check("average([2,4,6])", average([2, 4, 6]), 4);
check("isPalindrome('racecar')", isPalindrome("racecar"), true);
check("isPalindrome('a')", isPalindrome("a"), true);
check("factorial(5)", factorial(5), 120);
check("fizzbuzz(15)[14]", fizzbuzz(15)[14], "FizzBuzz");
check("countOccurrences([1,2,2,3,2],2)", countOccurrences([1, 2, 2, 3, 2], 2), 3);
check("binarySearch([1,3,5,7,9],5)", binarySearch([1, 3, 5, 7, 9], 5), 2);
check("binarySearch([1,3,5,7,9],9)", binarySearch([1, 3, 5, 7, 9], 9), 4);
check("removeDuplicates([1,1,1,2])", removeDuplicates([1, 1, 1, 2]), [1, 2]);
check("isPrime(7)", isPrime(7), true);
check("isPrime(2)", isPrime(2), true);
check("secondLargest([2,1,4,3,5])", secondLargest([2, 1, 4, 3, 5]), 4);
check("passingStudents([60,59,70,60],60)", passingStudents([60, 59, 70, 60], 60), 3);

console.log(`\n${passed} passed, ${failed} failed`);
