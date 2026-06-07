### 1. Source Brief -> Architecture
The architecture generally satisfies the PRD requirements, but there is one internal inconsistency within the architecture document itself regarding timeouts.

*   **R1 (Accounts):** Satisfied. `ARCHITECTURE.md` §3/§4.
*   **R2 (List accounts):** Satisfied. `ARCHITECTURE.md` §8.
*   **R3 (Soft-delete):** Satisfied. `ARCHITECTURE.md` §3.
*   **R4 (Post transfer):** Satisfied. `ARCHITECTURE.md` §5.
*   **R5 (Balance invariant):** Satisfied. `ARCHITECTURE.md` §5.
*   **R6 (Read transfers):** Satisfied. `ARCHITECTURE.md` §8.
*   **R7 (Settlement webhook):** Satisfied, but with drift. `PRD.md` says 5s timeout. `ARCHITECTURE.md` §7 says 5s, but §12 table says 10000ms (10s).
*   **R8 (Fees and rounding):** Satisfied. `ARCHITECTURE.md` §6.
*   **R9 (Token auth):** Satisfied. `ARCHITECTURE.md` §4.
*   **R10 (Idempotency):** Satisfied. `ARCHITECTURE.md` §9.
*   **R11 (Rate limiting):** Satisfied. `ARCHITECTURE.md` §10.
*   **R12 (Audit log):** Satisfied. `ARCHITECTURE.md` §11.
*   **R13 (Health check):** Satisfied. `ARCHITECTURE.md` §2.

### 2. Architecture -> Delivery Plan
The delivery plan is coherent with the architecture, but there is drift regarding "Phase 7".

*   **Phase 7 (Token management):** `CONTEXT.md` claims Phase 7 is "Done" and provides endpoints (`POST /tokens`, `DELETE /tokens/:id`), but these are absent from the `IMPLEMENTATION_PLAN.md` "Out of scope" section and the main delivery steps. `CONTEXT.md` also contradicts itself by listing token-management as "not built" in the "Things that trip people up" section.

### 3. Delivery/Status -> Code
The code contains significant logic, configuration, and security drift from the documentation.

1.  DRIFT: `FEE_BPS` is documented as 290 (2.9%) in `PRD.md` R8 and `ARCHITECTURE.md` §5 vs 190 in `src/services/transfers.ts`.
2.  DRIFT: `HALF_EVEN` rounding is required by `PRD.md` R8 and `ARCHITECTURE.md` §6, but `src/utils/money.ts` always rounds up on exact halves (logic error).
3.  DRIFT: `POST /transfers` requires `transfers:write` scope per `ARCHITECTURE.md` §4 and `README.md` vs `transfers:read` in `src/routes/transfers.ts`.
4.  DRIFT: Idempotency logic is inverted. `PRD.md` R10 requires 409 on body mismatch vs `src/middleware/idempotency.ts` which returns 409 if bodies match (`existing.request_hash === requestHash`) and replays if they differ.
5.  DRIFT: Idempotency TTL is documented as 24 hours in `PRD.md` R10 vs 24 minutes (`24 * 60 * 1000` ms) in `src/config.ts`.
6.  DRIFT: Rate limiting must be per-account/token per `PRD.md` R11 and `ARCHITECTURE.md` §10 vs per-IP (`req.ip`) in `src/middleware/rateLimit.ts`.
7.  DRIFT: Rate limit max requests is 60/60s per `PRD.md` R11 vs 100 in `src/config.ts`.
8.  DRIFT: Transfer listing must be newest-first per `PRD.md` R6 vs oldest-first (`ORDER BY created_at ASC`) in `src/routes/transfers.ts`.
9.  DRIFT: Pagination default limit is 25 per `PRD.md` R2 and `ARCHITECTURE.md` §8 vs 10 in `src/config.ts`.
10. DRIFT: Webhook backoff intervals are 1s, 2s, 4s per `PRD.md` R7 vs 1s, 3s, 9s (`[1000, 3000, 9000]`) in `src/config.ts`.
11. DRIFT: Token management endpoints (`POST /tokens`, etc.) are claimed as "Done" in `CONTEXT.md` Phase 7 vs completely missing from `src/index.ts` and `src/routes/`.
12. DRIFT: `transfer.failed` audit action is documented in `PRD.md` R12 and `CONTEXT.md` vs not implemented in `src/services/transfers.ts` or `src/routes/transfers.ts`.
13. DRIFT: `GET /accounts` should cap limit at 100 per `PRD.md` R2 vs no capping in `src/routes/accounts.ts` (though `listAccounts` service does cap it, the route doesn't pass a capped value).
14. DRIFT: `ARCHITECTURE.md` §12 table says `FEE_BPS` is in `src/config.ts` vs it is actually in `src/services/transfers.ts`.

### 4. Verdict
**SIGNIFICANT DRIFT**

The project has critical security and logic defects where the code diverges from the authoritative documentation:
1.  **Inverted Idempotency Logic:** The `idempotency.ts` middleware rejects identical requests with 409 and replays different requests, which is the exact opposite of the requirement and potentially dangerous.
2.  **Insufficient Scope Enforcement:** `POST /transfers` incorrectly requires `transfers:read`, allowing any client with read access to move money.
3.  **Money/Fee Errors:** `FEE_BPS` is wrong (190 vs 290), and the `HALF_EVEN` rounding implementation is mathematically incorrect.
4.  **Operational Drift:** Idempotency TTL is 1/60th of the required duration (24 mins vs 24 hours), and rate limiting is incorrectly keyed by IP instead of account/token.
5.  **Stale Claims:** `CONTEXT.md` claims token management is complete (Phase 7), but the code is missing.
