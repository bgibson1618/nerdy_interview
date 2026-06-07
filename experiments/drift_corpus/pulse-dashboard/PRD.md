# pulse-dashboard — Product Requirements

## Summary

pulse-dashboard is a browser-based single-page application that lets an operations team view
and explore service metrics published by the Pulse Metrics API. It is read-only: it never
writes metric data, only fetches and renders it. The dashboard auto-refreshes so a wall-mounted
or desk screen stays current without manual reloads.

## Target users

- On-call engineers watching live service health.
- Engineering managers reviewing weekly trends.

## Requirements

The following requirements are numbered and individually checkable. Every requirement is
realized by the architecture and the code in `src/`.

**R1 — Three primary views.** The app exposes exactly three routes: an Overview at `/`, a
Metric Detail at `/metrics/:metricId`, and a Settings page at `/settings`. Client-side routing
is used; there is no full page reload when navigating between views.

**R2 — Overview metric grid.** The Overview lists all available metrics as cards, each showing
the metric's display name, its latest value, and its unit. Cards are paginated client-side at
**25 cards per page**.

**R3 — Metric detail with time series.** Selecting a metric opens its Detail view, which renders
a line chart of that metric's values over the active date range, plus a summary header (latest
value, minimum, maximum over the range).

**R4 — Auto-refresh by polling.** Visible data refreshes automatically by polling the API on a
fixed cadence of **30 seconds (30000 ms)**. Polling pauses when the browser tab is hidden and
resumes when it becomes visible again.

**R5 — Configurable date range.** The active date range defaults to the **last 7 days**. From
Settings the user may switch it to last 24 hours, last 7 days, or last 30 days. The selected
range drives the time-series query on the Detail view.

**R6 — OAuth-gated access.** All data views require an authenticated session. Unauthenticated
users are redirected to begin an OAuth 2.0 Authorization Code redirect flow. After the provider
redirects back, the session is established and the user lands on the originally requested view.

**R7 — Feature flags.** Two build-time feature flags exist: `enableExport` (adds a "Download
CSV" action on the Detail view) and `enableDarkMode` (adds a light/dark theme toggle in
Settings). Flags default to `enableExport = false` and `enableDarkMode = true`.

**R8 — Single source of config.** API base URL, polling interval, default date range, and page
size are defined in one config module and are not hard-coded elsewhere.

**R9 — Graceful API errors.** When an API request fails, the affected view shows an inline
error state with a retry control rather than a blank screen; other views are unaffected.

## Out of scope

- Creating, editing, or deleting metrics (read-only product).
- Alerting, paging, or notification delivery.
- Multi-tenant organization switching.

