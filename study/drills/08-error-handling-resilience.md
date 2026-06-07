## `enrollmentBilling.ts` — charge & receipt service — Error handling & resilience (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// enrollmentBilling.ts
// Charges a guardian for a course seat, records the enrollment, and emails a receipt.
// Dependencies: Payments API (POST /charge) and Notify API (POST /send).

import fetch from "node-fetch";
import { recordEnrollment } from "./db";

const PAYMENTS_URL = process.env.PAYMENTS_URL ?? "https://payments.internal/charge";
const NOTIFY_URL = process.env.NOTIFY_URL ?? "https://notify.internal/send";
const PAYMENTS_KEY = process.env.PAYMENTS_API_KEY;

export interface EnrollRequest {
  guardianId: string;
  courseId: string;
  amountCents: number;
  email: string;
}

export interface EnrollResult {
  ok: boolean;
  receiptId?: string;
  error?: string;
}

class PaymentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PaymentError";
  }
}

async function chargeGuardian(req: EnrollRequest): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(PAYMENTS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${PAYMENTS_KEY}`,
        },
        body: JSON.stringify({
          guardianId: req.guardianId,
          courseId: req.courseId,
          amountCents: req.amountCents,
        }),
      });

      if (!res.ok) {
        throw new PaymentError("charge rejected", res.status);
      }

      const data = (await res.json()) as { receiptId: string };
      return data.receiptId;
    } catch (err) {
      lastErr = err;
      // transient blip against the payments provider — retry
    }
  }

  throw new PaymentError(`charge failed after retries: ${lastErr}`, 500);
}

async function sendReceipt(email: string, receiptId: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(NOTIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: email, receiptId }),
      signal: controller.signal,
    });
  } catch (err) {
    // best-effort receipt email
  } finally {
    clearTimeout(timer);
  }
}

export async function enroll(req: EnrollRequest): Promise<EnrollResult> {
  try {
    const receiptId = await chargeGuardian(req);

    try {
      await recordEnrollment(req.guardianId, req.courseId, receiptId);
    } catch (err) {
      // don't fail the enrollment over a logging hiccup
    }

    await sendReceipt(req.email, receiptId);
    return { ok: true, receiptId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function makeEnrollHandler() {
  return async (httpReq: any, httpRes: any) => {
    const body = httpReq.body as EnrollRequest;
    const result = await enroll(body);

    if (!result.ok) {
      return httpRes.status(500).json({ error: result.error });
    }
    return httpRes.status(200).json(result);
  };
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Correctness / Idempotency):** The retry loop (lines 35–60) re-POSTs a **non-idempotent charge with no idempotency key**, so a transient failure double-charges the guardian. The happy path returns on first success (line 55); the `catch` (line 56) only runs on failure, and reviewers equate "it threw" with "nothing was charged." But a `200` lost to a dropped connection, or `res.json()` (line 54) throwing on a flaky body *after the charge already committed*, both land in that catch and re-charge on the next iteration — *fix:* send a stable `Idempotency-Key` header derived from the request (e.g. `${guardianId}:${courseId}:${amountCents}` or a caller-supplied request id) so the provider dedupes.
2. **Blocker (Security / Info leak):** The handler returns `result.error` straight to the HTTP client (line 106); `enroll` populates it from `(err as Error).message` (line 96), and line 62 interpolates the raw upstream error into that message — so internal URLs, provider detail, and stack-ish text leak to the caller. Returning `error.message` *feels* helpful and is everywhere, so it slips — *fix:* log the real error server-side with a correlation id and return a generic `{ error: "Enrollment failed", correlationId }` to the client.
3. **Blocker (Reliability / Timeout):** The charge `fetch` (lines 37–48) has **no timeout / `signal`**, so a stalled Payments API hangs the call indefinitely, and with the 5-iteration loop (line 35) that's up to 5× unbounded. Under load these pin sockets and exhaust the connection pool → cascading outage. It slips because dev/staging dependencies respond instantly and never hang in testing — *fix:* wrap with `AbortController` + a timeout (you already do exactly this in `sendReceipt`).
4. **Should-fix (Error handling / Retry policy):** All errors are retried identically, including a `PaymentError` carrying a **4xx** (lines 50–51, 56) such as `402` card-declined or `400` bad-amount. A decline will never succeed, so 5 retries just delay the inevitable failure — and, combined with #1, can multiply side effects. The `catch` is generic and the status is captured but never inspected, so it reads as fine — *fix:* rethrow immediately on 4xx; only retry 5xx / network errors.
5. **Should-fix (Resilience / Backoff):** Retries fire back-to-back with **no delay, backoff, or jitter** (lines 35, 56–59). Against a degraded provider this is a retry storm that piles on load exactly when the dependency is weakest (thundering herd). The loop "has a cap of 5," so it reads as bounded and safe — *fix:* exponential backoff with jitter between attempts, ideally fronted by a circuit breaker.
6. **Should-fix (Data integrity / Silent loss):** A failed `recordEnrollment` is swallowed (lines 87–91) and the request **still returns `{ ok: true }`** (line 94). The guardian is charged and emailed a receipt, but no enrollment row exists — silent data loss that resurfaces as "I paid and have no access." The comment (line 90) mislabels a critical persistence step a "logging hiccup," which is how it got waved through; the nested try/catch reads like defensive hygiene — *fix:* treat the write as part of the unit of work — fail loudly and reconcile/refund or enqueue a durable retry, at minimum alert + dead-letter.
7. **Nit (Observability):** `catch (err) {}` in `sendReceipt` (lines 76–77) discards the error with no log or metric, so receipt emails can fail silently forever. It's genuinely best-effort, which is exactly why the empty catch feels intentional — *fix:* `logger.warn({ err, email }, "receipt send failed")` and/or bump a counter so the failure rate is visible.
8. **Nit (Diagnostics / Lost context):** `` `charge failed after retries: ${lastErr}` `` (line 62) stringifies the original error into a template, dropping its **stack and `cause`**. An `Error` in a template literal stringifies to just `name: message` (e.g. `PaymentError: charge failed`), so the log line *looks* like it "includes the error" while the stack and any `cause` chain are silently gone. It passes review because it reads as deliberate error logging — *fix:* `throw new PaymentError("charge failed after retries", 500, { cause: lastErr })` and log `lastErr` with its stack (this is also the leak vector in #2 — keep detail server-side, generic message client-side).
9. **Praise (Resilience):** `sendReceipt` does timeouts *right* (lines 66–67, 78–79): an `AbortController` bounded by `setTimeout`, wired through `signal`, with `clearTimeout` in a `finally` so the timer never leaks. This is precisely the pattern missing from the charge path in #3 — call it out and make the charge call copy it.

**Senior framing to say out loud:** "I'm blocking on the double-charge and the client-facing error leak first — that's money and security, nothing ships until they're fixed, and the missing charge timeout is the same severity in prod even though it's invisible in dev. The retry policy needs idempotency, backoff, and 4xx/5xx discrimination as one change, not three. And the swallowed enrollment write means we can take payment without granting access — that's a data-integrity bug, not the logging nit the comment claims. Credit where due: the timeout handling in `sendReceipt` is the exact pattern I want lifted onto the charge call."
</details>
