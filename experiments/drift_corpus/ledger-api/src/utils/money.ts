// Money helpers. All amounts in this codebase are integer minor units; the
// only operation that can produce a fraction is applying a fee rate, so this is
// the single place rounding happens.

// Compute a fee in minor units by applying `bps` (basis points; 1 bp = 0.01%)
// to `amount`, rounding to the nearest whole minor unit using HALF_EVEN
// (banker's rounding): exact halves round to the nearest EVEN integer, which
// avoids the upward bias of round-half-up across many transfers.
//
//   feeRaw = amount * bps / 10000
//
// Examples (amount, bps -> fee):
//   10000, 250  -> 250        (exact)
//   2,     2500 -> 0          (0.5 rounds to even 0)
//   6,     2500 -> 2          (1.5 rounds to even 2)
export function computeFee(amount: number, bps: number): number {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('amount must be a non-negative integer (minor units)');
  }
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error('bps must be a non-negative integer');
  }
  const numerator = amount * bps;
  const denominator = 10000;
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  const twice = remainder * 2;

  if (twice < denominator) {
    return quotient; // below the half -> round down
  }
  if (twice > denominator) {
    return quotient + 1; // above the half -> round up
  }
  // Exactly half: round to even.
  return quotient + 1;
}

// The amount actually credited to the destination after a fee is withheld.
export function netToDestination(amount: number, fee: number): number {
  return amount - fee;
}
