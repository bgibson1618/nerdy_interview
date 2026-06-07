# pulse-dashboard

A React + TypeScript single-page dashboard for viewing service metrics from the Pulse Metrics
API. Read-only, auto-refreshing, OAuth-gated.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
npm run dev
```

The Vite dev server starts on **http://localhost:5173**.

## Configuration

All tunable values live in `src/config.ts`:

| Key                | Default                              | Meaning                          |
|--------------------|--------------------------------------|----------------------------------|
| `apiBaseUrl`       | `https://api.pulse.example.com/v1`   | Base URL of the metrics API      |
| `pollIntervalMs`   | `30000`                              | Auto-refresh cadence (30 s)      |
| `defaultDateRange` | `'30d'`                              | Initial date range (last 30 days)|
| `pageSize`         | `25`                                 | Metric cards per Overview page   |

Feature flags (also in `src/config.ts`):

- `enableExport` (default `false`) — shows a "Download CSV" action on the Metric Detail view.
- `enableDarkMode` (default `true`) — shows a light/dark theme toggle in Settings.

## Authentication

On first visit you are redirected through an OAuth 2.0 Authorization Code (PKCE) flow against
`https://auth.pulse.example.com/oauth/authorize` with client ID `pulse-dashboard-web` and
scope `metrics:read`. After the provider redirects back to `/auth/callback`, your session is
stored in `sessionStorage` under the key `pulse.session` and you are returned to the page you
requested.

## Views

| Route                | What it shows                                                          |
|----------------------|-----------------------------------------------------------------------|
| `/`                  | Overview grid of all metrics, 25 cards per page                       |
| `/metrics/:metricId` | One metric's time-series line chart plus latest / min / max header    |
| `/settings`          | Date range (`24h` / `7d` / `30d`), theme toggle, flag status          |

## API

The dashboard calls these endpoints (base `https://api.pulse.example.com/v1`), each with an
`Authorization: Bearer <token>` header:

| Method | Path                           | Purpose                         |
|--------|--------------------------------|---------------------------------|
| GET    | `/metrics`                     | List metrics for the Overview   |
| GET    | `/metrics/:id`                 | One metric (Detail header)      |
| GET    | `/metrics/:id/series?range=`   | Time series (`24h`/`7d`/`30d`)  |
| GET    | `/me`                          | Validate the current session    |

## Scripts

```bash
npm run dev      # start Vite dev server on :5173
npm run build    # type-check and build for production
npm run preview  # preview the production build
```

