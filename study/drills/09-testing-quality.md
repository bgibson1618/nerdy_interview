## PR #418: `billing.test.ts` — Test quality (timed ~12 min)
Review this **test file** as if it's a PR. The thing under review is the TESTS — are they actually testing anything? Talk through your passes, severity-tag findings, *then* read the key.

```ts
// billing.test.ts — unit tests for the course-billing module
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyCoupon,
  canAccessCourse,
  enrollStudent,
  formatReceipt,
  redeemCoupon,
} from './billing'
import * as repo from './enrollmentRepo'

describe('applyCoupon', () => {
  it('applies a percentage discount', () => {
    const result = applyCoupon(100, { code: 'SAVE20', type: 'percent', amount: 20 })
    expect(result).toBe(80)
  })

  it('ignores an expired coupon and charges full price', () => {
    // expired coupons must never discount — billing-critical
    applyCoupon(100, { code: 'OLD50', type: 'percent', amount: 50, expiresAt: '2020-01-01' })
  })

  it('caps any discount at the item price and rejects a malformed coupon', () => {
    // edge: discount exceeds price -> floored at 0, never negative
    expect(applyCoupon(10, { code: 'OVER', type: 'flat', amount: 999 })).toBe(0)
    // error: negative amount is invalid -> original price preserved
    expect(applyCoupon(10, { code: 'BAD', type: 'percent', amount: -50 })).toBe(10)
  })
})

describe('canAccessCourse', () => {
  const activeUser = {
    id: 'u1',
    role: 'student',
    subscription: { status: 'active', expiresAt: '2999-01-01' },
  }
  const paidCourse = { id: 'c1', requiresSubscription: true }

  it('lets an active subscriber into a paid course', () => {
    expect(canAccessCourse(activeUser, paidCourse)).toBe(true)
  })

  it('lets an admin into a paid course', () => {
    const admin = { ...activeUser, role: 'admin' }
    expect(canAccessCourse(admin, paidCourse)).toBe(true)
  })

  it('lets anyone into a free course', () => {
    const freeCourse = { id: 'c2', requiresSubscription: false }
    const guest = { id: 'u9', role: 'student', subscription: null }
    expect(canAccessCourse(guest, freeCourse)).toBe(true)
  })
})

describe('enrollStudent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('saves the enrollment for a valid student', async () => {
    const saveSpy = vi.spyOn(repo, 'save').mockResolvedValue({ id: 'e1' } as any)
    await enrollStudent('s1', 'c1')
    expect(saveSpy).toHaveBeenCalled()
  })

  it('returns the created enrollment record', () => {
    const rec = { id: 'e2', studentId: 's2', courseId: 'c1' }
    vi.spyOn(repo, 'save').mockResolvedValue(rec as any)
    expect(enrollStudent('s2', 'c1')).resolves.toEqual(rec)
  })

  it('does not enroll a student who is already enrolled', async () => {
    vi.spyOn(repo, 'exists').mockResolvedValue(true)
    try {
      const result = await enrollStudent('s3', 'c1')
      expect(result).toBeNull()
    } catch (e) {
      // already-enrolled guard threw, as expected
    }
  })
})

describe('coupon redemption limits', () => {
  const ledger: string[] = []

  it('records the first redemption of a code', () => {
    redeemCoupon('SAVE20', ledger)
    expect(ledger).toContain('SAVE20')
  })

  it('blocks a second redemption of the same code', () => {
    const blocked = redeemCoupon('SAVE20', ledger)
    expect(blocked).toBe(false)
  })
})

describe('formatReceipt', () => {
  it('stamps the receipt with the current time and amount', () => {
    const receipt = formatReceipt({ studentId: 's1', amount: 80 })
    expect(receipt.amount).toBe(80)
    expect(receipt.issuedAt).toBe(new Date().toISOString())
  })

  it('matches the expected receipt shape', () => {
    const receipt = formatReceipt({ studentId: 's1', amount: 80 })
    expect(receipt).toMatchSnapshot()
  })
})
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Coverage / false confidence):** `canAccessCourse` is tested with three cases (`lets an active subscriber…`, `lets an admin…`, `lets anyone into a free course`) and **every one asserts `true`**. The deny path is never exercised — an expired subscriber, an inactive `status`, or a `subscription: null` student hitting a *paid* course should return `false`, and nothing checks that. You could delete the entire subscription/expiry check in the implementation and the suite stays green. Slips past review because three green `it()` blocks *look* like the branch is covered. — Fix: add cases for expired / inactive / missing subscription on a paid course, each asserting `false`.

2. **Blocker (Async correctness):** `returns the created enrollment record` does `expect(enrollStudent('s2','c1')).resolves.toEqual(rec)` with **no `await` and no `return`**, and the test fn isn't `async`. `.resolves` produces a promise that settles *after* the test has already passed; the assertion — and any rejection — is silently dropped. It reads like a normal assertion, which is exactly why it slips. — Fix: `await expect(enrollStudent('s2','c1')).resolves.toEqual(rec)` (or `return` the expectation).

3. **Blocker (Error masking):** `does not enroll a student who is already enrolled` wraps its body in `try { … } catch (e) {}` with an **empty catch**. If `enrollStudent` wrongly enrolls a duplicate, `expect(result).toBeNull()` throws — and the catch swallows it, so the test passes anyway. The single behavior it claims to verify is structurally incapable of failing. Reviewers skim the reassuring comment and move on. — Fix: drop the try/catch and assert directly: `await expect(enrollStudent('s3','c1')).rejects.toThrow(/already enrolled/)`.

4. **Should-fix (Empty test):** `ignores an expired coupon and charges full price` **calls `applyCoupon` but never asserts anything**. It passes as long as the call doesn't throw — even if an expired coupon happily applies its 50% discount. The confident title makes it read as covered when it proves nothing. — Fix: `expect(applyCoupon(100, { …expiresAt: '2020-01-01' })).toBe(100)`.

5. **Should-fix (Mock theater):** `saves the enrollment for a valid student` stubs `repo.save` to always resolve, then asserts only `expect(saveSpy).toHaveBeenCalled()`. No check on the **arguments** or the returned record, so passing the wrong `studentId`/`courseId`, or skipping validation before the call, still passes. You're asserting that you called your own stub. — Fix: `expect(saveSpy).toHaveBeenCalledWith('s1', 'c1')` and assert the resolved enrollment value.

6. **Should-fix (Test isolation):** the `coupon redemption limits` block shares a describe-scoped `ledger`. `blocks a second redemption of the same code` only passes because the *previous* test pushed `'SAVE20'` into `ledger`. Run it in isolation, with `.only`, or under randomized order and it fails — order-dependent shared mutable state. — Fix: rebuild state per test in `beforeEach`, or seed the ledger explicitly inside the test that needs it.

7. **Should-fix (Flakiness):** `stamps the receipt…` asserts `receipt.issuedAt === new Date().toISOString()`, recomputing the clock *at assert time*. If the millisecond rolls over between `formatReceipt()` and the assertion, it fails intermittently — a classic flake (it's also semi-tautological: clock vs. clock). — Fix: freeze time with `vi.useFakeTimers()` / `vi.setSystemTime(...)` and assert against the fixed value.

8. **Nit (Snapshot hygiene):** `matches the expected receipt shape` snapshots a receipt containing the volatile `issuedAt`. The first run bakes a specific timestamp into the `.snap`; later runs mismatch, and the reflexive "fix" is `-u`, which rubber-stamps whatever was produced. A snapshot over nondeterministic output verifies nothing. — Fix: assert specific fields, or use a property matcher — `expect(receipt).toMatchSnapshot({ issuedAt: expect.any(String) })`.

9. **Praise (Test design):** `caps any discount at the item price and rejects a malformed coupon` is the model to copy — clean arrange/act/assert, asserts on the **real return value**, no mocks, and deliberately covers both an **edge** (discount `999` > price `10` → floored to `0`, never negative) and an **error case** (negative `amount` → original price preserved). Deterministic and would actually catch a regression. Hold every other test in this file to this bar.

**Senior framing to say out loud:** "My headline is three blockers, each of which lets a real bug ship green: an access-control deny path with zero coverage, an un-awaited `.resolves` that never executes, and a try/catch that swallows its only assertion. The middle tier — the empty expired-coupon test, mock-only `toHaveBeenCalled`, order-dependent shared state, and a wall-clock flake — is death-by-a-thousand-cuts false confidence rather than real verification. The `applyCoupon` cap-and-reject test is exactly the standard I want, so I'd block on the three correctness issues, fix the isolation/flake ones before merge, and file the snapshot nit."
</details>
