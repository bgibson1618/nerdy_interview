### 1. Source Brief -> Architecture

The architecture generally satisfies the PRD requirements, but there are some under-specified areas and minor contradictions:

*   **R1 — Three primary views**: Addressed. Architecture defines Overview, Metric Detail, and Settings routes.
*   **R2 — Overview metric grid**: Addressed. Architecture defines `MetricGrid` and `MetricCard` with client-side pagination.
*   **R3 — Metric detail with time series**: Addressed. Architecture defines `LineChart` and a summary header.
*   **R4 — Auto-refresh by polling**: Addressed. Architecture defines a `usePolling` hook with visibility-aware pausing.
*   **R5 — Configurable date range**: Addressed. Architecture defines `DateRange` type and default value.
*   **R6 — OAuth-gated access**: Addressed. Architecture defines an OAuth 2.0 Authorization Code redirect flow with a `RequireAuth` wrapper.
*   **R7 — Feature flags**: Addressed. Architecture defines `enableExport` and `enableDarkMode` flags.
*   **R8 — Single source of config**: Addressed. Architecture defines a centralized `config.ts` module.
*   **R9 — Graceful API errors**: Addressed. Architecture defines `ApiError` and `ErrorState` components.

**Flagged Issues:**
*   **Under-specified**: ARCHITECTURE.md mentions a "summary header" for R3 but doesn't explicitly link it to the `/metrics/:id` endpoint in the text, though the table includes it.
*   **Overbuilt/Drift**: ARCHITECTURE.md includes `metrics:write` in the OAuth scope, but the PRD specifies the application is read-only.

---

### 2. Architecture -> Delivery Plan

The delivery plan builds the architecture coherently, but introduces a new requirement in Phase 6 that is not present in the Architecture or PRD:

*   **Phases 1-5**: Align well with the architecture components and acceptance criteria.
*   **Phase 6**: Includes "All UI strings are localized via `react-i18next` (English + Spanish bundles)" which is not mentioned in the ARCHITECTURE.md or PRD.md.

**Flagged Issues:**
*   **Stale Assumptions**: Phase 6 claims localization is "DONE", but this feature is missing from the architecture and (as shown below) the code.

---

### 3. Delivery/Status -> Code

Numerous concrete inconsistencies exist between the documentation (PRD, Architecture, Plan, README, CONTEXT) and the actual implementation in `src/`.

1.  DRIFT: `config.apiBaseUrl` is `https://api.pulse.example.com/v1` in ARCHITECTURE.md (Config section), CONTEXT.md (What's shipped), and README.md (Configuration) vs `https://api.pulse.example.com/v2` in `src/config.ts`.
2.  DRIFT: `config.pollIntervalMs` is `30000` (30s) in PRD.md (R4), ARCHITECTURE.md (Config section), IMPLEMENTATION_PLAN.md (Phase 1), CONTEXT.md (What's shipped), and README.md (Configuration) vs `60000` (60s) in `src/config.ts`.
3.  DRIFT: `config.pageSize` is `25` in PRD.md (R2), ARCHITECTURE.md (Config section), IMPLEMENTATION_PLAN.md (Phase 4), CONTEXT.md (What's shipped), and README.md (Configuration) vs `50` in `src/config.ts`.
4.  DRIFT: `flags.enableExport` default is `false` in PRD.md (R7), ARCHITECTURE.md (Config section), CONTEXT.md (What's shipped), and README.md (Configuration) vs `true` in `src/config.ts`.
5.  DRIFT: Route path `/settings` claimed in PRD.md (R1), ARCHITECTURE.md (Component map), CONTEXT.md (What's shipped), and README.md (Views) vs `/preferences` in `src/App.tsx` and the nav link.
6.  DRIFT: API endpoint `/me` for session validation in ARCHITECTURE.md (API surface) and README.md (API) vs `/profile` in `src/api/metrics.ts`.
7.  DRIFT: WebSocket channel `wss://api.pulse.example.com/live` claimed as shipped in CONTEXT.md vs no WebSocket implementation exists in `src/`.
8.  DRIFT: Localization via `react-i18next` (English + Spanish) claimed as DONE in IMPLEMENTATION_PLAN.md (Phase 6) vs no localization code or dependencies found in `package.json` or `src/`.
9.  DRIFT: `usePolling` hook pauses on hidden tabs claimed in PRD.md (R4), ARCHITECTURE.md (Polling layer), CONTEXT.md (What's shipped), and IMPLEMENTATION_PLAN.md (Phase 4) vs no visibility check implementation in `src/hooks/usePolling.ts`.
10. DRIFT: Metric Detail header uses `GET /metrics/:id` claimed in ARCHITECTURE.md (API surface) vs `src/views/MetricDetailView.tsx` only calls `getMetricSeries` and derives header data from the series.
11. DRIFT: Date range selection in Settings affects the app claimed in PRD.md (R5) and IMPLEMENTATION_PLAN.md (Phase 6) vs `range` state is local to `SettingsView.tsx` and `MetricDetailView.tsx` and is not shared or persisted.
12. DRIFT: OAuth scope is `metrics:read metrics:write` in ARCHITECTURE.md (Auth model) vs `metrics:read` in `src/auth/oauth.ts` and README.md (Authentication).
13. DRIFT: `sessionStorage` key for session is `pulse.session` in ARCHITECTURE.md (Auth model), IMPLEMENTATION_PLAN.md (Phase 3), CONTEXT.md (What's shipped), and README.md (Authentication) vs `pulse.auth` in `src/auth/oauth.ts`.
14. DRIFT: `defaultDateRange` is `'7d'` in PRD.md (R5), ARCHITECTURE.md (Config section), and `src/config.ts` vs `'30d'` in README.md (Configuration).
15. DRIFT: `MetricGrid` code comment claims pagination at `25` cards per page vs code uses `config.pageSize` (which is 50) in `src/components/MetricGrid.tsx`.

---

### 4. Verdict

**VERDICT: SIGNIFICANT DRIFT**

The project suffers from extensive drift across almost all configurable values, route definitions, and API endpoints. Most critically:
1.  **Fake Completion**: The `IMPLEMENTATION_PLAN.md` and `CONTEXT.md` claim features are "DONE" (Localization, WebSockets, Polling visibility pause) that do not exist in the codebase.
2.  **Broken Requirements**: PRD R5 (Configurable date range) is non-functional as the state is not shared between the Settings view and the Detail view.
3.  **Config Mismatch**: Fundamental values like API Base URL, Polling Interval, and Page Size are inconsistent between every document and the code.
4.  **Routing/API Mismatch**: Core routes (`/settings` vs `/preferences`) and API endpoints (`/me` vs `/profile`) do not match the documentation.
