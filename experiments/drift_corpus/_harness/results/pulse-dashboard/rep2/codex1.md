### 1. Source Brief -> Architecture

R1 - Three primary views: PARTIAL. `ARCHITECTURE.md:13-23` defines the PRD's three routes (`/`, `/metrics/:metricId`, `/settings`) behind `RequireAuth`, which satisfies the main route map in `PRD.md:20-22`. However, the auth model also requires a provider return to `/auth/callback` in `ARCHITECTURE.md:102-103` without reconciling that extra callback path with the "exactly three routes" requirement or documenting how the callback is handled outside the app route map.

R2 - Overview metric grid: ADDRESSED. `ARCHITECTURE.md:24-29` maps `MetricCard`/`MetricGrid`, and `ARCHITECTURE.md:31-40` assigns `pageSize = 25` to config for grid paging.

R3 - Metric detail with time series: ADDRESSED IN ARCHITECTURE. `ARCHITECTURE.md:24-29` maps `LineChart`, `ARCHITECTURE.md:78-83` includes `/metrics/:id` and `/metrics/:id/series?range=`, and `ARCHITECTURE.md:53-68` defines metric and point data.

R4 - Auto-refresh by polling: ADDRESSED IN ARCHITECTURE. `ARCHITECTURE.md:109-114` specifies mount fetch, 30000 ms interval, hidden-tab skip, and visible-tab immediate refresh.

R5 - Configurable date range: PARTIAL. `ARCHITECTURE.md:69-72` defines `DateRange = '24h' | '7d' | '30d'` and default `'7d'`, and `ARCHITECTURE.md:78-85` uses the range query parameter. It does not define the state/storage path by which a Settings selection drives the Detail view, which is required by `PRD.md:36-38`.

R6 - OAuth-gated access: PARTIAL/CONTRADICTED. `ARCHITECTURE.md:88-107` covers redirect auth, session storage, and no browser client secret. It is under-specified because `/auth/callback` is not included in the route map, and it contradicts the read-only PRD posture in `PRD.md:5-7` and `PRD.md:54-58` by requesting `metrics:read metrics:write` in `ARCHITECTURE.md:95`.

R7 - Feature flags: ADDRESSED IN ARCHITECTURE. `ARCHITECTURE.md:42-47` defines `enableExport = false` and `enableDarkMode = true` with the required UI effects.

R8 - Single source of config: ADDRESSED IN ARCHITECTURE. `ARCHITECTURE.md:31-40` centralizes API base URL, poll interval, default date range, and page size in `src/config.ts`.

R9 - Graceful API errors: ADDRESSED IN ARCHITECTURE. `ARCHITECTURE.md:116-120` defines typed API errors and per-view `ErrorState` retry behavior.

### 2. Architecture -> Delivery Plan

The plan generally follows the architecture's component breakdown and phase order, but it is not a coherent acceptance contract for the full architecture.

Missing or weak delivery coverage:

- Auth callback handling is missing from the plan. `ARCHITECTURE.md:102-103` requires the provider to redirect to `/auth/callback`, but `IMPLEMENTATION_PLAN.md:26-35` only checks that `handleCallback()` exists and never requires a route/component to invoke it.
- PKCE is missing from the plan acceptance criteria. `ARCHITECTURE.md:107` says the public client uses PKCE, but `IMPLEMENTATION_PLAN.md:30-35` does not require verifier/challenge generation, storage, or token-exchange validation.
- The `/me` endpoint is under-specified in the plan. `ARCHITECTURE.md:78-83` documents four API endpoints, including `GET /me`, while `IMPLEMENTATION_PLAN.md:23-24` names only `listMetrics()`, `getMetric(id)`, and `getMetricSeries(id, range)` as wrappers "mapping to the four documented endpoints."
- Settings-to-detail date range propagation is under-specified. `PRD.md:36-38` requires the Settings selection to drive Detail queries, but neither `ARCHITECTURE.md` nor `IMPLEMENTATION_PLAN.md:55-63` defines shared state, persistence, or routing/query-param mechanics for that handoff.
- The plan adds localization that the architecture does not have. `IMPLEMENTATION_PLAN.md:62` requires all UI strings to be localized via `react-i18next` with English and Spanish bundles, but there is no corresponding architecture claim in `ARCHITECTURE.md`.
- The plan does not mention WebSocket/live updates, while `CONTEXT.md:18-19` later claims WebSocket real-time updates shipped. That status claim references a component absent from both `ARCHITECTURE.md` and `IMPLEMENTATION_PLAN.md`.
- Build acceptance is weak for this workspace slice. `IMPLEMENTATION_PLAN.md:10-14` says the Vite + React + TypeScript app builds, but this directory has no local `tsconfig.json` or `index.html` (`find . -maxdepth 2 -type f` listed only docs, `package.json`, `vite.config.ts`, and `src/*`), and `npm run build` failed because `tsc` tried to write `/home/bgibs/projects/agent-roster-observe-smoke/dist/*.js` outside the run workspace.

### 3. Delivery/Status -> Code

1. DRIFT: `CONTEXT.md:5-6` claims all six phases are DONE and the build satisfies every PRD requirement R1-R9 vs multiple source facts below show unmet route, config, auth, polling, API, date-range, and shipped-feature claims in `src/`.
2. DRIFT: `IMPLEMENTATION_PLAN.md:65-67` claims all six phases are DONE and feature-complete against PRD R1-R9 vs `npm run build` failed with TS5033 attempting to write `/home/bgibs/projects/agent-roster-observe-smoke/dist/*.js`, and the source facts below contradict completed acceptance criteria.
3. DRIFT: `PRD.md:20-22`, `ARCHITECTURE.md:18-22`, `CONTEXT.md:10-11`, and `README.md:46-50` claim the Settings route is `/settings` vs `src/App.tsx:17` links to `/preferences` and `src/App.tsx:37-44` registers `/preferences`.
4. DRIFT: `src/views/SettingsView.tsx:7` documents "Settings route `/settings`" vs `src/App.tsx:37-44` actually mounts `SettingsView` at `/preferences`.
5. DRIFT: `CONTEXT.md:12-14`, `ARCHITECTURE.md:35-40`, and `README.md:24-29` claim `apiBaseUrl = https://api.pulse.example.com/v1` vs `src/config.ts:7-10` sets `apiBaseUrl` to `https://api.pulse.example.com/v2`.
6. DRIFT: `PRD.md:32-34`, `CONTEXT.md:12-17`, `ARCHITECTURE.md:35-40`, `README.md:24-29`, and `IMPLEMENTATION_PLAN.md:12-13` claim the poll interval is 30000 ms / 30 seconds vs `src/config.ts:10-11` sets `pollIntervalMs: 60000`.
7. DRIFT: `src/hooks/usePolling.ts:12-14` says the hook runs every `config.pollIntervalMs` "(30000 ms)" vs `src/config.ts:10-11` sets `pollIntervalMs: 60000`.
8. DRIFT: `PRD.md:24-26`, `CONTEXT.md:20`, `ARCHITECTURE.md:35-40`, `README.md:24-29`, and `IMPLEMENTATION_PLAN.md:42-43` claim Overview pages 25 cards per page vs `src/config.ts:14-15` sets `pageSize: 50` and `src/components/MetricGrid.tsx:12-14` slices by that value.
9. DRIFT: `src/components/MetricGrid.tsx:6-8` documents paging at `config.pageSize (25)` vs `src/config.ts:14-15` sets `pageSize: 50`.
10. DRIFT: `README.md:24-29` claims `defaultDateRange` defaults to `'30d'` vs `PRD.md:36-38`, `CONTEXT.md:12-14`, `ARCHITECTURE.md:35-40`, `IMPLEMENTATION_PLAN.md:12-13`, and `src/config.ts:12-13` all specify `'7d'`.
11. DRIFT: `PRD.md:44-46`, `CONTEXT.md:21`, `ARCHITECTURE.md:42-47`, and `README.md:31-34` claim `enableExport` defaults to `false` vs `src/config.ts:21-24` sets `enableExport: true`, so `src/views/MetricDetailView.tsx:53-57` shows "Download CSV" by default.
12. DRIFT: `CONTEXT.md:15-16`, `ARCHITECTURE.md:78-83`, and `README.md:57-62` claim the session/profile endpoint is `GET /me` vs `src/api/metrics.ts:21-24` names the wrapper as `GET /me` but calls `apiGet<UserProfile>('/profile')`.
13. DRIFT: `ARCHITECTURE.md:83` says `GET /me` confirms the session is valid and `README.md:62` says `/me` validates the current session vs `src/auth/RequireAuth.tsx:10-19` only checks local `getSession()` and no `src/` caller invokes `getProfile()`.
14. DRIFT: `ARCHITECTURE.md:104-105`, `README.md:40-42`, and `IMPLEMENTATION_PLAN.md:31-33` claim sessions are stored under `sessionStorage` key `pulse.session` vs `src/auth/oauth.ts:11-13` exports `SESSION_KEY = 'pulse.auth'`.
15. DRIFT: `ARCHITECTURE.md:95` claims OAuth scope `metrics:read metrics:write` vs `README.md:38-40` and `src/auth/oauth.ts:6-9` use only `metrics:read`; the write scope also conflicts with the read-only product scope in `PRD.md:5-7` and out-of-scope metric writes in `PRD.md:54-58`.
16. DRIFT: `README.md:38-40` claims an OAuth Authorization Code (PKCE) flow and `ARCHITECTURE.md:107` says the public client uses PKCE vs `src/auth/oauth.ts:37-45` sends no `code_challenge` / `code_challenge_method` and `src/auth/oauth.ts:60-76` sends no `code_verifier`.
17. DRIFT: `PRD.md:40-42`, `ARCHITECTURE.md:102-103`, and `README.md:40-42` claim the provider redirects back to `/auth/callback` and establishes the session vs `src/App.tsx:20-45` defines no `/auth/callback` route to invoke `handleCallback()`.
18. DRIFT: `PRD.md:32-34`, `CONTEXT.md:17`, `ARCHITECTURE.md:109-114`, and `IMPLEMENTATION_PLAN.md:44` claim polling pauses when the tab is hidden and resumes/refetches when visible vs `src/hooks/usePolling.ts:35-38` only starts `setInterval(run, config.pollIntervalMs)` and has no `visibilitychange` or `document.hidden` logic.
19. DRIFT: `CONTEXT.md:18-19` claims real-time updates over WebSocket channel `wss://api.pulse.example.com/live` vs focused source search found no `WebSocket`, `websocket`, `wss://`, or `api.pulse.example.com/live` implementation under `src/`.
20. DRIFT: `IMPLEMENTATION_PLAN.md:51-52`, `ARCHITECTURE.md:78-83`, and `README.md:57-61` claim Detail fetches both `/metrics/:id` for the header and `/metrics/:id/series?range=<active>` for the chart vs `src/views/MetricDetailView.tsx:1-18` imports/calls only `getMetricSeries()` and never calls `getMetric()`.
21. DRIFT: `README.md:49` claims Metric Detail shows "One metric's time-series line chart plus latest / min / max header" backed by the one-metric endpoint in `README.md:60` vs `src/views/MetricDetailView.tsx:27-31` derives latest/min/max solely from the series response and `src/views/MetricDetailView.tsx:46` displays the raw `metricId`, not fetched metric display data.
22. DRIFT: `PRD.md:36-38` says the Settings-selected date range drives the Detail time-series query vs `src/views/SettingsView.tsx:8-24` stores range only in local Settings state and `src/views/MetricDetailView.tsx:11-18` uses its own local state initialized from `config.defaultDateRange`.
23. DRIFT: `IMPLEMENTATION_PLAN.md:60-61` marks Settings date range and dark-mode toggle as DONE vs `src/views/SettingsView.tsx:8-38` implements both as local component state only, with no persistence or app-level effect visible outside the Settings view.
24. DRIFT: `IMPLEMENTATION_PLAN.md:62` claims all UI strings are localized via `react-i18next` with English and Spanish bundles vs `package.json:11-22` has no `react-i18next` or `i18next` dependency, `find . -maxdepth 3` found no locale/i18n files, and source strings are hard-coded in components such as `src/views/OverviewView.tsx:16-21`, `src/components/ErrorState.tsx:15-17`, and `src/views/SettingsView.tsx:14-36`.
25. DRIFT: `IMPLEMENTATION_PLAN.md:10-11` claims the Vite + React + TypeScript app builds and `README.md:64-70` documents `npm run build` as production build vs running `npm run build` in this workspace failed with TS5033 write errors to the parent repo `dist/`, and the workspace slice has no local `tsconfig.json` or `index.html` in the file inventory.

### 4. Verdict

SIGNIFICANT DRIFT

The most important issues are:

1. Core PRD behavior is not aligned with code: `/settings` is not implemented, polling is 60000 ms instead of 30000 ms, hidden-tab polling pause/resume is absent, Overview pages at 50 not 25, and `enableExport` defaults true instead of false.
2. Auth/session behavior is materially under-implemented or inconsistent: no `/auth/callback` route, no PKCE parameters, wrong session storage key, conflicting OAuth scopes, and `/me` validation is neither called nor correctly routed.
3. Status docs overclaim shipped capabilities: WebSocket real-time updates and `react-i18next` localization are documented as shipped but have no supporting source implementation.
4. Settings date range selection does not drive Detail queries, so R5 is not actually satisfied by the code even though PRD, architecture, README, and plan say it is.
5. Build readiness is not verified in this workspace; the documented build command failed due TypeScript writing to the parent repo output path.
