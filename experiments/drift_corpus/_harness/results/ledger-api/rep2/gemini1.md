### 1. Source Brief -> Architecture

The architecture satisfies almost every PRD requirement, with a few notes on specificity:

- **R1 - R13**: All requirements are explicitly mapped to architectural components in `ARCHITECTURE.md`.
- **R9 (Scopes)**: The architecture correctly identifies the need for per-endpoint scopes and maps them in a table (§4).
- **R11 (Rate Limiting)**: The architecture specifies per-account rate limiting, which satisfies the PRD.
- **R12 (Audit Log)**: The architecture specifies an append-only audit log with a shared service (`services/audit.ts`).
- **Rounding (R8)**: Both PRD and Architecture specify **HALF_EVEN** rounding, though the Architecture doesn't detail the implementation beyond referencing `utils/money.ts`.

**Flagged Issues**:
- **Webhook Timeout**: `ARCHITECTURE.md` (§12) lists a 10000ms timeout, while `PRD.md` (R7) specifies 5s. This is an internal documentation contradiction.

---

### 2. Architecture -> Delivery Plan

The delivery plan is largely coherent with the architecture, but contains a significant claim drift regarding completion:

- **Phase Mapping**: Phases 0-6 in the plan align well with the components described in the architecture.
- **Phase 7 (Tokens)**: `CONTEXT.md` claims Phase 7 is "Done", but the `IMPLEMENTATION_PLAN.md` explicitly lists a "token-management API" as **Out of scope (v1)**. This creates ambiguity about the actual intended scope of the project.
- **Acceptance Criteria**: The plan's acceptance criteria for Phase 5 (Rate Limiting) and Phase 4 (Fees) specify values (60 req/60s, 290 bps) that the code currently violates.

---

### 3. Delivery/Status -> Code

Every concrete inconsistency identified between the documentation and the codebase:

1.  **DRIFT**: `CONTEXT.md` claims Phase 7 (Token management) is "Done" vs `IMPLEMENTATION_PLAN.md` lists it as "Out of scope" and `src/routes/` contains no `tokens.ts`.
2.  **DRIFT**: `src/config.ts` sets `rateLimit.max: 100` vs all documents (`PRD.md`, `ARCHITECTURE.md`, `README.md`) specifying **60** req/60s.
3.  **DRIFT**: `src/config.ts` sets `pagination.defaultLimit: 10` vs all documents specifying **25**.
4.  **DRIFT**: `src/config.ts` sets `webhook.backoffMs: [1000, 3000, 9000]` vs all documents specifying **1s, 2s, 4s**.
5.  **DRIFT**: `src/routes/transfers.ts` requires scope `transfers:read` for `POST /transfers` vs all documents specifying `transfers:write`.
6.  **DRIFT**: `src/routes/transfers.ts` orders by `created_at ASC` vs all documents and `src/services/accounts.ts` specifying newest-first (`DESC`).
7.  **DRIFT**: `src/middleware/rateLimit.ts` keys limits by `req.ip` vs all documents specifying per-account/token keying.
8.  **DRIFT**: `src/middleware/idempotency.ts` throws 409 when body hash **matches** vs all documents specifying 409 for body **mismatch**.
9.  **DRIFT**: `src/services/transfers.ts` uses `FEE_BPS = 190` vs all documents specifying **290**.
10. **DRIFT**: `src/utils/money.ts` rounds all exact halves **up** vs all documents specifying **HALF_EVEN** (banker's rounding).
11. **DRIFT**: `src/routes/transfers.ts` query uses `ASC` order while the schema index `transfers_created_idx` in `src/db/schema.sql` is `DESC`.
12. **DRIFT**: `CONTEXT.md` is internally inconsistent: "Current state" says Phase 7 is Done, but "What's next" says Token endpoints are "not built".

---

### 4. Verdict

**VERDICT: SIGNIFICANT DRIFT**

The project has significant behavioral and security drift from its specifications:

1.  **Security/Logic Bug**: The transfer posting endpoint requires `transfers:read` instead of `transfers:write`, potentially allowing read-only tokens to move money.
2.  **Logic Inversion**: The idempotency middleware is inverted, rejecting valid retries with a 409 and allowing body-mismatched retries to proceed.
3.  **Inaccurate Money/Fees**: The fee (190 bps vs 290 bps) and rounding (Always Up vs Half-Even) logic violates the core "double-entry" and "money representation" requirements.
4.  **Identity/Throttling**: The rate limiter keys by IP instead of Account/Token, violating R11.
5.  **Configuration Drift**: Nearly every numeric constant in `src/config.ts` (rate limits, pagination, webhook backoff) disagrees with the documentation.
6.  **Internal Doc Contradiction**: `CONTEXT.md` makes conflicting claims about the status of Token management endpoints.
