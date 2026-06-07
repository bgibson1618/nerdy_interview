# pulse-dashboard — Implementation Plan

Phased delivery plan. Each phase maps onto components named in ARCHITECTURE.md and lists
acceptance criteria. Completion status reflects the code currently in `src/`.

## Phase 1 — Project scaffold & config — DONE

Maps to: Stack, Config (`src/config.ts`).

Acceptance criteria:
- [x] Vite + React + TypeScript app builds; dev server on port 5173.
- [x] `src/config.ts` exports `apiBaseUrl`, `pollIntervalMs` (30000), `defaultDateRange`
      (`'7d'`), `pageSize` (25), and the two feature flags.
- [x] `src/types.ts` declares `Metric`, `MetricPoint`, `DateRange`, `UserProfile`.

## Phase 2 — API client & metrics endpoints — DONE

Maps to: API surface (`src/api/client.ts`, `src/api/metrics.ts`).

Acceptance criteria:
- [x] `client.ts` performs `fetch` against `apiBaseUrl`, attaches the bearer token, and
      throws `ApiError` on non-2xx.
- [x] `metrics.ts` exposes `listMetrics()`, `getMetric(id)`, and
      `getMetricSeries(id, range)` mapping to the four documented endpoints.

## Phase 3 — Auth gate (OAuth redirect) — DONE

Maps to: Auth model (`src/auth/`).

Acceptance criteria:
- [x] `oauth.ts` implements `beginLogin()`, `handleCallback()`, `getSession()`, `logout()`.
- [x] Session JSON `{ accessToken, expiresAt }` is stored in `sessionStorage` key
      `pulse.session`.
- [x] `RequireAuth` redirects unauthenticated users into the flow and preserves the
      intended path.

## Phase 4 — Overview grid & polling — DONE

Maps to: `OverviewView`, `MetricGrid`, `MetricCard`, `usePolling`.

Acceptance criteria:
- [x] Overview fetches `/metrics` via `usePolling` and renders a `MetricGrid`.
- [x] Grid paginates at 25 cards per page (`pageSize`).
- [x] Polling cadence is 30000 ms and pauses on hidden tabs.

## Phase 5 — Metric detail & chart — DONE

Maps to: `MetricDetailView`, `LineChart`.

Acceptance criteria:
- [x] Detail fetches `/metrics/:id` and `/metrics/:id/series?range=<active>`.
- [x] `LineChart` renders the series; header shows latest, min, max.
- [x] When `enableExport` is true, a "Download CSV" action is shown.

## Phase 6 — Settings, flags & error states — DONE

Maps to: `SettingsView`, `ErrorState`.

Acceptance criteria:
- [x] Settings lets the user pick the date range (`24h`/`7d`/`30d`).
- [x] When `enableDarkMode` is true, a light/dark theme toggle is shown.
- [x] All UI strings are localized via `react-i18next` (English + Spanish bundles).
- [x] All data views render `ErrorState` with retry on API failure.

## Status

All six phases are DONE. The build is feature-complete against PRD R1–R9.

