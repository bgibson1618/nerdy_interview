### 1. Source Brief -> Architecture

The architecture generally aligns with the PRD requirements, but there are several discrepancies and under-specified areas:

- **R1 — Three primary views:** The PRD specifies `/settings`, but the architecture (and code) shifts between `/settings` and `/preferences`.
- **R2 — Overview metric grid:** The PRD requires a page size of **25**, but the architecture/code implements **50**.
- **R3 — Metric detail with time series:** The architecture specifies fetching both `/metrics/:id` (header) and `/metrics/:id/series` (chart), but the code only fetches the series.
- **R4 — Auto-refresh by polling:** The PRD requires a **30s** interval and pausing on hidden tabs. The architecture claims this is satisfied, but the code implements a **60s** interval and lacks the pause-on-hidden-tab logic.
- **R5 — Configurable date range:** The architecture specifies the three ranges, but does not address how the selection in Settings persists or propagates to the Detail view (which is also missing in the code).
- **R6 — OAuth-gated access:** The architecture specifies the redirect flow but omits the necessary `/auth/callback` route definition which is required for the flow to complete.
- **R7 — Feature flags:** Addressed correctly.
- **R8 — Single source of config:** Addressed correctly.
- **R9 — Graceful API errors:** Addressed correctly.

### 2. Architecture -> Delivery Plan

The delivery plan claims feature-completeness, but several claims in the plan are not reflected in the architecture or code:

- **Phase 3 (Auth):** Claims to be DONE, but the missing `/auth/callback` route in `App.tsx` means the OAuth flow cannot be completed.
- **Phase 6 (Localization):** Claims that all UI strings are localized via `react-i18next` for English and Spanish. This is not mentioned in the ARCHITECTURE and is completely absent from the code and `package.json`.
- **WebSocket (CONTEXT/Plan):** The CONTEXT (and by implication the status of "complete") claims real-time updates via WebSockets, but this is not in the ARCHITECTURE or the code.

### 3. Delivery/Status -> Code

The code exhibits significant drift from the documentation:

1. DRIFT: `apiBaseUrl` is `https://api.pulse.example.com/v2` in `src/config.ts` vs `v1` in `ARCHITECTURE.md` (Config) and `README.md`.
2. DRIFT: `pollIntervalMs` is `60000` in `src/config.ts` vs `30000` in `PRD.md` (R4), `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md`.
3. DRIFT: `pageSize` is `50` in `src/config.ts` vs `25` in `PRD.md` (R2) and `ARCHITECTURE.md`.
4. DRIFT: `enableExport` flag is `true` in `src/config.ts` vs `false` (default) in `PRD.md` (R7) and `ARCHITECTURE.md`.
5. DRIFT: Settings route is `/preferences` in `src/App.tsx` vs `/settings` in `PRD.md` (R1) and `ARCHITECTURE.md`.
6. DRIFT: Metric Detail view does NOT fetch `/metrics/:id` in `src/views/MetricDetailView.tsx` vs claim in `ARCHITECTURE.md` (Data model) and `IMPLEMENTATION_PLAN.md` (Phase 5).
7. DRIFT: `getProfile()` calls `/profile` in `src/api/metrics.ts` vs `/me` in `ARCHITECTURE.md` (API surface) and `README.md`.
8. DRIFT: `SESSION_KEY` is `pulse.auth` in `src/auth/oauth.ts` vs `pulse.session` in `CONTEXT.md`, `ARCHITECTURE.md`, and `README.md`.
9. DRIFT: OAuth scope is `metrics:read` in `src/auth/oauth.ts` vs `metrics:read metrics:write` in `ARCHITECTURE.md` (Auth model).
10. DRIFT: `usePolling` hook does NOT pause when tab is hidden in `src/hooks/usePolling.ts` vs claim in `PRD.md` (R4), `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md`.
11. DRIFT: Localization via `react-i18next` is missing from `src/` and `package.json` vs claim in `IMPLEMENTATION_PLAN.md` (Phase 6).
12. DRIFT: WebSocket support is missing from `src/` vs claim in `CONTEXT.md` (What's shipped).
13. DRIFT: Nav link for Settings points to `/preferences` in `src/App.tsx` but the component comment in `src/views/SettingsView.tsx` still says `/settings`.
14. DRIFT: Default date range is `'30d'` in `README.md` (Configuration) vs `'7d'` in `src/config.ts` and `ARCHITECTURE.md`.
15. DRIFT: `MetricGrid.tsx` has a hard-coded comment claiming `25` cards per page while the code uses `config.pageSize` (which is `50`).
16. DRIFT: The `/auth/callback` route required by `src/auth/oauth.ts` is missing from `src/App.tsx`, rendering the auth flow broken.

### 4. Verdict

VERDICT: FAIL
DIMENSIONS:
  - Architecture: PASS
  - Plan: FAIL
  - Code: FAIL
BLOCKING:
  - Auth: Missing `/auth/callback` route in `App.tsx` breaks the login flow.
  - Polling: Missing pause-on-hidden-tab logic violates PRD R4.
  - Localization: Claimed `react-i18next` support is entirely missing.
  - WebSocket: Claimed WebSocket support is entirely missing.
RIGOR: tuned

**SIGNIFICANT DRIFT**

The most critical issue is the **broken OAuth flow** due to a missing callback route, followed by **significant configuration drift** (API version, poll interval, page size) and **entirely missing features** (localization, WebSocket, polling-pause) that are claimed as shipped in the documentation. The app is effectively unusable in its current state if the auth gate is active.
