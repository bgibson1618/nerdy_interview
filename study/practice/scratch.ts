// Scratchpad — edit this file and it re-runs on save when you run `npm run practice`.
// This file deliberately uses an `enum` and a constructor parameter property —
// the two things that broke `node file.ts`. If you see output below, your env is good.

enum Size {
  Small,
  Large,
}

class Box {
  // `public readonly size` is a "parameter property" — node's strip-only mode can't do this; tsx can.
  constructor(public readonly size: Size) {}
  describe(): string {
    return `a ${Size[this.size]} box`;
  }
}

console.log(new Box(Size.Large).describe());

// ---- your scratch space below ----
// Try a problem from the live-coding playbook here, e.g. two-sum:

function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) return [seen.get(complement)!, i];
    seen.set(nums[i], i);
  }
  return [];
}

console.log(twoSum([2, 7, 11, 15], 9)); // -> [ 0, 1 ]
