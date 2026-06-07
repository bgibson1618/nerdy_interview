# pulse-dashboard — Context (front door)

## Current state

**Feature-complete.** All six implementation phases (see `IMPLEMENTATION_PLAN.md`) are DONE,
and the build satisfies every PRD requirement R1–R9.

## What's shipped

- Three routed views: Overview (`/`), Metric Detail (`/metrics/:metricId`), Settings
  (`/settings`), all behind an OAuth redirect gate.
- A typed config module (`src/config.ts`) holding the API base URL
  (`https://api.pulse.example.com/v1`), the 30000 ms poll interval, the `'7d'` default date
  range, the page size of 25, and the two feature flags.
- An API client + metrics endpoint wrappers for `/metrics`, `/metrics/:id`,
  `/metrics/:id/series`, and `/me`.
- A polling hook (30 s cadence, pauses on hidden tab) used by Overview and Detail.
- Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) that
  supplements polling for sub-second metric refresh.
- An SVG `LineChart`, a paginated `MetricGrid` (25/page), and an `ErrorState` with retry.
- Feature flags `enableExport` (default `false`) and `enableDarkMode` (default `true`).

## What's next

Nothing is required for the current scope. Possible future work, all explicitly out of scope
today: live metric editing, alerting, and multi-tenant org switching (see PRD "Out of scope").

## Pointers

- Product brief: `PRD.md`
- How it's built: `ARCHITECTURE.md`
- Plan & phase status: `IMPLEMENTATION_PLAN.md`
- Setup & usage: `README.md`

