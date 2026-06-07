## EdTech BillingService PR — gRPC service (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// ---------------------------------------------------------------------------
// billing.proto (excerpt)
//
//   service BillingService {
//     rpc ChargeForSession (ChargeRequest)  returns (ChargeReply);
//     rpc GetInvoice       (InvoiceRequest) returns (Invoice);
//     rpc StreamReceipts   (AccountRequest) returns (stream Receipt);
//   }
//
//   message ChargeRequest  { string student_id = 1; string session_id = 2; int32 amount_cents = 3; }
//   message InvoiceRequest { string invoice_id = 1; }
//   message AccountRequest { string account_id = 1; }
// ---------------------------------------------------------------------------
//
// Called by the scheduling-service after a tutoring session is marked complete.

import * as grpc from '@grpc/grpc-js';
import { db } from './db';                   // db.query(sql, params) => Promise<Row[]>
import { paymentGateway } from './payments'; // gRPC client for the external charge processor
import { logger } from './logger';
import { BillingServiceService as BillingService } from './generated/billing';
import type {
  ChargeRequest, ChargeReply, InvoiceRequest, Invoice,
  AccountRequest, Receipt, LineItem,
} from './generated/billing';

// Charge a student for a completed tutoring session.
async function chargeForSession(
  call: grpc.ServerUnaryCall<ChargeRequest, ChargeReply>,
  callback: grpc.sendUnaryData<ChargeReply>,
): Promise<void> {
  const { student_id, session_id, amount_cents } = call.request;
  logger.info(`ChargeForSession: ${JSON.stringify(call.request)}`);

  try {
    const sessions = await db.query(
      'SELECT id FROM sessions WHERE id = $1 AND student_id = $2',
      [session_id, student_id],
    );
    if (sessions.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: `no session ${session_id} for that student`,
      });
    }

    const result = await paymentGateway.charge({
      studentId: student_id,
      amountCents: amount_cents,
    });

    await db.query(
      'INSERT INTO charges (session_id, student_id, amount_cents, ref) VALUES ($1, $2, $3, $4)',
      [session_id, student_id, amount_cents, result.ref],
    );

    callback(null, { chargeId: result.ref, status: 'CHARGED' });
  } catch (err) {
    logger.error('charge failed');
    callback(null, { chargeId: '', status: 'FAILED' });
  }
}

// Fetch a single invoice by id.
async function getInvoice(
  call: grpc.ServerUnaryCall<InvoiceRequest, Invoice>,
  callback: grpc.sendUnaryData<Invoice>,
): Promise<void> {
  const { invoice_id } = call.request;

  const rows = await db.query('SELECT * FROM invoices WHERE id = $1', [invoice_id]);
  const invoice = rows[0];

  callback(null, {
    invoiceId: invoice.id,
    amountCents: invoice.amount_cents,
    lineItems: invoice.line_items.map((li: LineItem) => li.description),
  });
}

// Stream every receipt for an account, newest first.
async function streamReceipts(
  call: grpc.ServerWritableStream<AccountRequest, Receipt>,
): Promise<void> {
  const { account_id } = call.request;

  const receipts = await db.query(
    'SELECT * FROM receipts WHERE account_id = $1 ORDER BY created_at DESC',
    [account_id],
  );

  for (const r of receipts) {
    call.write({ receiptId: r.id, amountCents: r.amount_cents, paidAt: r.created_at });
  }
}

const server = new grpc.Server();
server.addService(BillingService, { chargeForSession, getInvoice, streamReceipts });
server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
  logger.info('BillingService listening on :50051');
  server.start();
});
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security):** No handler authenticates the caller — none of them read `call.metadata`. In gRPC, auth tokens ride in *metadata* (the equivalent of HTTP headers); you read them with `call.metadata.get('authorization')`. This slips past review because there's no obvious "missing middleware" line to notice — the absence is invisible, and people assume "it's internal, the mesh protects it." But any pod that can reach `:50051` can charge arbitrary students. **Fix:** validate the token at the top of every handler and `callback({ code: grpc.status.UNAUTHENTICATED })` (code 16) when it's missing or invalid; better yet, enforce it in a server interceptor so no handler can forget.

2. **Blocker (Correctness / crash):** `getInvoice` does `const invoice = rows[0]` then dereferences `invoice.id` and `invoice.line_items.map(...)`. When the id doesn't exist, `rows[0]` is `undefined` and `invoice.id` throws a `TypeError`. Because the throw happens in an `async` handler, **`callback` is never called** — so the client just waits until *its* deadline and then gets a generic error, with no clue it was a simple "not found." It reads as fine next to the happy path. **Fix:** check `if (rows.length === 0) return callback({ code: grpc.status.NOT_FOUND })` (code 5) — a deliberate status so callers can tell "doesn't exist" apart from "server broke" — and never leave a path where `callback` isn't called.

3. **Blocker (Correctness — status mapping):** The `catch` does `callback(null, { status: 'FAILED' })`. In gRPC the *first* callback argument is the error; `callback(null, x)` means **status OK (code 0)**. So a thrown DB/gateway error is reported to the caller as a *successful* RPC whose body happens to say FAILED. Callers (and any gRPC retry policy) treat OK as success — they won't retry a transient blip, and reconciliation will think the charge resolved. Worse: the gateway `charge` can succeed and the `INSERT` then fail, so money moved but the RPC says OK. It hides because returning a populated object *feels* like handling the error. **Fix:** `callback({ code: grpc.status.INTERNAL, message: ... })` for unexpected failures (and the specific code where you know it), so the error is a real gRPC error the caller can react to.

4. **Should-fix (Reliability — deadlines):** `paymentGateway.charge({...})` is an outbound RPC with no deadline. A gRPC *deadline* is an absolute "give up after" timestamp; with none set, if the gateway stalls this handler waits forever, holding a connection and pinning resources until the whole server starves. Easy to miss because in the happy path it returns instantly. **Fix:** pass an options object with a deadline, e.g. `{ deadline: Date.now() + 3000 }`, and ideally derive it from the inbound `call.getDeadline()` so the time budget propagates instead of being reinvented per hop. (The `db.query` calls deserve a statement timeout for the same reason.)

5. **Should-fix (Validation):** `amount_cents`, `session_id`, and `student_id` are used raw. Proto fields aren't "required" — they default to `0`/`""`, and they're caller-controlled. A negative `amount_cents` could push a *refund* through the gateway, `0` is meaningless, and empty ids still hit the DB. It slips by because the destructured values look populated. **Fix:** validate up front (`amount_cents > 0`, ids non-empty) and reject with `grpc.status.INVALID_ARGUMENT` (code 3) — the code that tells the caller "your request is malformed, retrying won't help."

6. **Should-fix (Resource / streaming):** `streamReceipts` writes every row but **never calls `call.end()`**, so the client never learns the stream is complete and hangs until timeout. It also ignores `call.write()`'s return value (it returns `false` when the send buffer is full — that's backpressure you should await via the `'drain'` event), never listens for `call.on('cancelled')` to stop work when the client disconnects, and loads the whole table into memory first. The loop *looks* complete, which is why it passes. **Fix:** stream rows in batches, honor backpressure, handle `cancelled`, and **always** `call.end()` when done.

7. **Nit (Privacy / logging):** `logger.info(JSON.stringify(call.request))` dumps the full request — `student_id` and friends — into logs that fan out to aggregators with broad read access. For a billing/edtech service that's PII in plaintext. **Fix:** log selected non-sensitive ids (e.g. `session_id`) rather than the whole payload.

8. **Nit (Observability):** The `catch` logs the bare string `'charge failed'` and drops `err` entirely — no stack, no gateway message — so on-call has nothing to debug from. **Fix:** `logger.error('charge failed', { err })` (or `err.message` + stack) so the failure is actually diagnosable.

9. **Praise (Correctness):** `chargeForSession` gets the not-found case *right* — it explicitly returns `grpc.status.NOT_FOUND` when the session lookup is empty instead of crashing or pretending success. That's exactly the deliberate status-code mapping `getInvoice` (#2) is missing; this is the pattern to copy across the service.

**Senior framing to say out loud:** "I'd block the missing auth and the `getInvoice` not-found crash before anything else — one's a security hole, the other 500s on a totally normal lookup — plus the `catch` that reports a failed charge as OK, because for money a clean error is far safer than a fake success. Deadlines, input validation, and the never-ended stream I'd raise as must-fix-before-prod reliability items, not blockers. The PII logging and the context-free error log I'd leave to a linter or a quick follow-up. And I'd call out that the NOT_FOUND handling in `chargeForSession` is the right model — let's make every handler look like that."
</details>
