# pulse-dashboard — Architecture

This document describes how pulse-dashboard is built and shows that every PRD requirement
(R1–R9) is satisfied. It is the contract between the PRD and the code under `src/`.

## Stack

- **React 18** with **TypeScript** for the UI.
- **Vite** as the dev server and bundler. Dev server runs on port **5173**.
- **react-router-dom v6** for client-side routing.
- Native **fetch** for HTTP; no data-fetching framework.

## Component & route map (satisfies R1)

Routing is defined in `src/App.tsx`. There are exactly three routes, all wrapped by an auth
gate (`RequireAuth`):

| Route path           | View component        | File                                |
|----------------------|-----------------------|-------------------------------------|
| `/`                  | `OverviewView`        | `src/views/OverviewView.tsx`        |
| `/metrics/:metricId` | `MetricDetailView`    | `src/views/MetricDetailView.tsx`    |
| `/settings`          | `SettingsView`        | `src/views/SettingsView.tsx`        |

Shared presentational components:

- `MetricCard` (`src/components/MetricCard.tsx`) — one card in the Overview grid.
- `MetricGrid` (`src/components/MetricGrid.tsx`) — paginated grid of `MetricCard`s (R2).
- `LineChart` (`src/components/LineChart.tsx`) — SVG line chart for a time series (R3).
- `ErrorState` (`src/components/ErrorState.tsx`) — inline error + retry control (R9).

## Config (satisfies R8)

All tunable values live in `src/config.ts` and nowhere else:

| Config key          | Value                                  | Used by         |
|---------------------|----------------------------------------|-----------------|
| `apiBaseUrl`        | `https://api.pulse.example.com/v1`     | API client      |
| `pollIntervalMs`    | `30000`                                | polling hook R4 |
| `defaultDateRange`  | `'7d'`                                 | date range R5   |
| `pageSize`          | `25`                                   | grid paging R2  |

Feature flags also live in `src/config.ts` (satisfies R7):

| Flag             | Default | Effect                                              |
|------------------|---------|-----------------------------------------------------|
| `enableExport`   | `false` | Shows "Download CSV" on Metric Detail                |
| `enableDarkMode` | `true`  | Shows light/dark theme toggle in Settings           |

## Data model

Types are declared in `src/types.ts`.

### `Metric` (one entry in the Overview grid)

| Field         | Type     | Notes                                  |
|---------------|----------|----------------------------------------|
| `id`          | `string` | Stable metric identifier (URL segment) |
| `name`        | `string` | Human display name                     |
| `unit`        | `string` | e.g. `"ms"`, `"req/s"`, `"%"`           |
| `latestValue` | `number` | Most recent sample                     |

### `MetricPoint` (one sample in a time series)

| Field       | Type     | Notes                              |
|-------------|----------|------------------------------------|
| `timestamp` | `string` | ISO-8601 UTC timestamp             |
| `value`     | `number` | Sample value at that timestamp     |

### `DateRange`

A string union: `'24h' | '7d' | '30d'`. The default is `'7d'` (R5).

## API surface

The dashboard consumes the Pulse Metrics API at base URL `https://api.pulse.example.com/v1`.
The API client is `src/api/client.ts`; endpoint wrappers are in `src/api/metrics.ts`.

| Method | Path                          | Returns           | Purpose                          |
|--------|-------------------------------|-------------------|----------------------------------|
| GET    | `/metrics`                    | `Metric[]`        | Overview grid (R2)               |
| GET    | `/metrics/:id`                | `Metric`          | Detail header (R3)               |
| GET    | `/metrics/:id/series?range=`  | `MetricPoint[]`   | Detail chart series (R3, R5)     |
| GET    | `/me`                         | `UserProfile`     | Confirms session is valid (R6)   |

The `range` query parameter accepts exactly the `DateRange` values `24h`, `7d`, `30d`.
Every request carries `Authorization: Bearer <accessToken>` from the active session.

## Auth model (satisfies R6)

OAuth 2.0 Authorization Code redirect flow, implemented in `src/auth/`:

- **Provider authorize URL:** `https://auth.pulse.example.com/oauth/authorize`
- **Client ID:** `pulse-dashboard-web` (public client; placeholder, not a secret)
- **Redirect URI:** `http://localhost:5173/auth/callback`
- **Scope:** `metrics:read metrics:write`

Flow:

1. `RequireAuth` (`src/auth/RequireAuth.tsx`) checks for a session via `getSession()`.
2. If absent, it stores the intended path and calls `beginLogin()`
   (`src/auth/oauth.ts`), which redirects the browser to the authorize URL.
3. The provider redirects back to `/auth/callback`; `handleCallback()` exchanges the code
   and stores the session.
4. The session is held in `sessionStorage` under the key **`pulse.session`** as JSON
   `{ accessToken, expiresAt }`. It is read by `getSession()` and cleared by `logout()`.

No client secret is stored in the browser; the public client uses PKCE.

## Polling layer (satisfies R4)

`usePolling` (`src/hooks/usePolling.ts`) runs a fetch on mount and then every
`pollIntervalMs` (30000) milliseconds via `setInterval`. It subscribes to the document
`visibilitychange` event: when the tab is hidden it skips ticks, and it refetches immediately
when the tab becomes visible. The Overview and Detail views use this hook for their data.

## Error handling (satisfies R9)

The API client throws a typed `ApiError` on non-2xx responses. Views catch it, store it in
local state, and render `ErrorState` with a retry button that re-invokes the fetch. A failure
in one view does not affect the others because each view owns its own fetch state.

