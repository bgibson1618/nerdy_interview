# Fresh-eyes drift review — pulse-dashboard

Scope: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, and all code under `src/` (plus `package.json`, `vite.config.ts`). Report only; nothing fixed.

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement at the design level. Mapping:

| PRD req | Addressed by ARCHITECTURE? | Notes |
|---------|----------------------------|-------|
| **R1** Three views, client-side routing | ✅ Route map (3 routes via `react-router-dom`, `RequireAuth` wrap) | Architecture names `/settings`; code uses `/preferences` (see §3). |
| **R2** Overview grid, 25/page | ✅ `MetricGrid` + `pageSize` config | Architecture says 25; code says 50 (see §3). |
| **R3** Detail with time-series + latest/min/max header | ✅ `MetricDetailView`, `LineChart`, `GET /metrics/:id` + `/series` | Architecture says the header comes from `GET /metrics/:id`; code never calls it (see §3). |
| **R4** Auto-refresh poll 30 s, pause on hidden tab | ✅ Polling layer section describes `visibilitychange` | Architecture is **over-specified vs code**: code has no visibility handling (see §3). |
| **R5** Default 7d, switchable from Settings, drives Detail query | ✅ `DateRange` union, Settings selector | Architecture asserts selection "drives the time-series query on the Detail view"; code does not wire this (see §3). |
| **R6** OAuth Authorization Code redirect gate | ✅ Auth model section, `RequireAuth`, `oauth.ts` | Architecture adds `metrics:write` scope and PKCE that contradict the read-only PRD / code (see §3). |
| **R7** Two build-time flags, defaults `enableExport=false`, `enableDarkMode=true` | ✅ Flags table | Default for `enableExport` contradicted by code (see §3). |
| **R8** Single config module | ✅ Config table; code does centralize values | Satisfied structurally (`src/config.ts` is the only source); the *values* drift, not the pattern. |
| **R9** Inline error + retry per view | ✅ Error-handling section, `ErrorState` | Satisfied in code. |

Findings at this layer:

- **Overbuild / PRD contradiction (scope):** ARCHITECTURE §Auth model (line 95) specifies OAuth scope `metrics:read metrics:write`. The PRD is explicit that the product is **read-only** ("It is read-only: it never writes metric data"; Out-of-scope: "Creating, editing, or deleting metrics"). A `metrics:write` scope is unjustified by any requirement and contradicts the brief. (Code and README only request `metrics:read`.)
- **Overbuild (R4):** ARCHITECTURE §Polling layer specifies a `visibilitychange` subscription with skip-on-hidden + refetch-on-visible. This faithfully restates R4, but the *code* implements none of it — so the architecture promises behavior the delivered code lacks.
- Everything else in the architecture is a faithful, checkable restatement of the PRD. The design is coherent; the drift is overwhelmingly **architecture/plan vs code**, surfaced in §3.

### 2. Architecture -> Delivery Plan

The six-phase plan maps cleanly onto the architecture's components and is sequenced sensibly (scaffold → client → auth → overview/polling → detail → settings/errors). Acceptance criteria largely mirror the architecture. Problems:

- **Plan claims a component that does not exist anywhere (i18n).** IMPLEMENTATION_PLAN Phase 6 acceptance (line 62): "All UI strings are localized via `react-i18next` (English + Spanish bundles)." This appears in **no** other document — not the PRD, not the architecture — and there is no `react-i18next` dependency in `package.json` and no i18n code in `src/`. A stale/invented acceptance criterion that also references a stack component the architecture never introduced.
- **Plan asserts a fetch the code does not make.** Phase 5 acceptance (line 51): "Detail fetches `/metrics/:id` and `/metrics/:id/series?range=<active>`." The architecture agrees (`GET /metrics/:id` → Detail header). `MetricDetailView` only fetches the series; `getMetric()` is never called.
- **Plan re-asserts the hidden-tab pause** (Phase 4, line 44) that the code never implements — same drift as the architecture, carried into an acceptance criterion marked `[x]`.
- **Plan endpoint claim is off by path.** Phase 2 (line 24) says the wrappers map "to the four documented endpoints," the fourth being `/me`; the code's fourth wrapper hits `/profile` (see §3).
- **Status integrity:** the plan closes with "All six phases are DONE … feature-complete against PRD R1–R9," and every acceptance box is `[x]`. Several of those boxes are demonstrably unchecked-in-reality (R4 visibility, R5 range wiring, i18n, the `/metrics/:id` header fetch, `/auth/callback` handling). The "DONE" claims are stale relative to the code.

No missing-task gaps in the plan's *shape*; the risk is that ticked acceptance criteria do not reflect the code.

### 3. Delivery/Status -> Code

Each item is an individually checkable contradiction. Format: `DRIFT: <doc claim + location> vs <code/doc fact + location>`.

1. **DRIFT:** API base URL is `https://api.pulse.example.com/v1` — ARCHITECTURE §Config (line 37) & §API surface (line 75), README (lines 28, 54), CONTEXT (line 13) — **vs** `apiBaseUrl: 'https://api.pulse.example.com/v2'` in `src/config.ts:9`.

2. **DRIFT:** Poll interval is `30000` ms / 30 s — PRD R4 (line 33), ARCHITECTURE §Config (line 40) & §Polling (line 112), README (line 27), CONTEXT (line 13), IMPLEMENTATION_PLAN Phase 1/4 (lines 12, 44) — **vs** `pollIntervalMs: 60000` in `src/config.ts:11`. (The `src/config.ts:10` comment reads "PRD R4: 30 seconds" while the value is 60000; `src/hooks/usePolling.ts:14` comment also says "30000 ms".)

3. **DRIFT:** Page size is `25` cards/page — PRD R2 (line 26), ARCHITECTURE §Config (line 40), README (line 29), CONTEXT (lines 13, 20), IMPLEMENTATION_PLAN (lines 13, 43) — **vs** `pageSize: 50` in `src/config.ts:15`. (The `src/config.ts:14` comment cites "PRD R2"; `src/components/MetricGrid.tsx:7` comment says "(25)".)

4. **DRIFT:** `enableExport` default is `false` — PRD R7 (line 46), ARCHITECTURE §Flags (line 46), README (line 33), CONTEXT (line 21) — **vs** `enableExport: true` in `src/config.ts:23`.

5. **DRIFT (doc-vs-doc and doc-vs-code):** README §Configuration (line 28) lists `defaultDateRange` default `'30d'` ("Initial date range (last 30 days)") — **vs** `'7d'` everywhere else: PRD R5 (line 36), ARCHITECTURE (lines 39, 71), CONTEXT (line 13), and the code `defaultDateRange: '7d'` in `src/config.ts:13`. The README is the outlier.

6. **DRIFT:** Settings route path is `/settings` — PRD R1 (line 20), ARCHITECTURE route map (line 22), README (line 50), CONTEXT (line 10), IMPLEMENTATION_PLAN Phase 6 — **vs** `path="/preferences"` (and nav `<Link to="/preferences">`) in `src/App.tsx:17,38`. Navigating to `/settings` matches no route. (`src/views/SettingsView.tsx:7` doc comment still says "Settings route `/settings`", contradicting its own routing.)

7. **DRIFT:** Session-validation endpoint is `GET /me` — ARCHITECTURE §API surface (line 83), README (line 62), CONTEXT (line 16) — **vs** `getProfile()` calling `apiGet('/profile')` in `src/api/metrics.ts:22-24`.

8. **DRIFT:** Session is stored in `sessionStorage` under key `pulse.session` — ARCHITECTURE §Auth model (line 104), README (line 41), IMPLEMENTATION_PLAN Phase 3 (line 33) — **vs** `export const SESSION_KEY = 'pulse.auth'` in `src/auth/oauth.ts:12`.

9. **DRIFT:** OAuth scope is `metrics:read metrics:write` — ARCHITECTURE §Auth model (line 95) — **vs** `const SCOPE = 'metrics:read'` in `src/auth/oauth.ts:9` (which matches README line 40 and the read-only PRD). ARCHITECTURE is the outlier and also contradicts the PRD's read-only mandate.

10. **DRIFT:** OAuth flow "uses PKCE" — ARCHITECTURE §Auth model (line 107), README (line 38, "(PKCE) flow") — **vs** `src/auth/oauth.ts` `beginLogin()` (lines 37-46) sends only `response_type/client_id/redirect_uri/scope` (no `code_challenge`/`code_challenge_method`) and `exchangeCode()` (lines 61-71) sends no `code_verifier`. No PKCE is implemented anywhere; only the comment at `oauth.ts:2` claims it.

11. **DRIFT:** Polling "pauses when the browser tab is hidden and resumes when it becomes visible" — PRD R4 (lines 33-34), ARCHITECTURE §Polling layer (lines 109-114, `visibilitychange`), CONTEXT (line 17), IMPLEMENTATION_PLAN Phase 4 (line 44) — **vs** `src/hooks/usePolling.ts` (lines 35-40): runs on mount + unconditional `setInterval`, with **no** `visibilitychange` listener and no `document.hidden` check. Polling never pauses.

12. **DRIFT:** "Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) … for sub-second metric refresh" — CONTEXT (lines 18-19) — **vs** no WebSocket anywhere in `src/` (no `WebSocket`, `wss:`, or `/live` reference). The PRD and ARCHITECTURE never mention it either; it is a phantom "shipped" feature invented by CONTEXT.

13. **DRIFT:** "All UI strings are localized via `react-i18next` (English + Spanish bundles)" — IMPLEMENTATION_PLAN Phase 6 (line 62), marked `[x]` — **vs** no `react-i18next` in `package.json` (lines 11-22) and no i18n code in `src/`; views hard-code English strings (e.g. `OverviewView.tsx:21` "Overview", `SettingsView.tsx:14` "Settings", `ErrorState.tsx:17` "Retry").

14. **DRIFT:** "From Settings the user may switch [the range] … The selected range drives the time-series query on the Detail view" — PRD R5 (lines 37-38), ARCHITECTURE R5 — **vs** code does not connect them: `src/views/SettingsView.tsx:9` holds `range` in local `useState` that is never persisted/shared, and `src/views/MetricDetailView.tsx:13` initializes `const [range] = useState(config.defaultDateRange)` with **no setter** and no shared store/context. Changing the range in Settings has zero effect on the Detail query.

15. **DRIFT:** The provider "redirects back to `/auth/callback`; `handleCallback()` exchanges the code and stores the session" — ARCHITECTURE §Auth model flow step 3 (lines 102-103), README (line 41), REDIRECT_URI `…/auth/callback` (`oauth.ts:8`) — **vs** `src/App.tsx` defines no `/auth/callback` route (only `/`, `/metrics/:metricId`, `/preferences`), and `handleCallback()` (`oauth.ts:52`) is never imported or invoked anywhere. The redirect leg of the OAuth flow is unhandled in the app, so the documented R6 login cannot actually complete.

16. **DRIFT:** "Detail fetches `/metrics/:id`" for the header — IMPLEMENTATION_PLAN Phase 5 (line 51), ARCHITECTURE §API surface (line 81, `GET /metrics/:id` → "Detail header (R3)") — **vs** `src/views/MetricDetailView.tsx:15-18` calls only `getMetricSeries()`; the latest/min/max header (lines 28-31) is derived from the series points, and `getMetric()` (`src/api/metrics.ts:10`) is never called.

17. **DRIFT:** `GET /me` "Confirms session is valid (R6)" — ARCHITECTURE §API surface (line 83) — **vs** `getProfile()` (`src/api/metrics.ts:22`) is never invoked; `RequireAuth` (`src/auth/RequireAuth.tsx:12`) validates the session purely from `sessionStorage` via `getSession()` and never calls the profile/`/me` endpoint. The documented session-validation request is dead code.

Additional minor note (not counted above): ARCHITECTURE §API surface (line 86) states "Every request carries `Authorization: Bearer <accessToken>`," but `apiGet` (`src/api/client.ts:24-26`) attaches the header only when a session exists. Low impact since all callers are auth-gated.

### 4. Verdict

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - CONTEXT.md / IMPLEMENTATION_PLAN.md: "feature-complete / all phases DONE / satisfies R1-R9" is false — R4, R5, R6 are incomplete in code.
  - src/auth (R6): no /auth/callback route and handleCallback() never invoked — OAuth login cannot complete.
  - src/config.ts: poll interval (60000 vs 30000), pageSize (50 vs 25), apiBaseUrl (/v2 vs /v1), enableExport (true vs false) all contradict every spec doc.
RIGOR: tuned
```

**Overall: SIGNIFICANT DRIFT.**

The architecture is a faithful design for the PRD, but the code has diverged from the architecture, the plan, the README, and CONTEXT on numerous concrete, checkable facts, and the status docs assert a completeness the code does not have. 17 distinct drifts, most important first:

1. **R6 login is structurally broken (#15).** No `/auth/callback` route exists and `handleCallback()` is never wired in, so the documented OAuth redirect flow cannot complete in the app despite being marked DONE.
2. **R5 is not implemented (#14).** The Settings date-range selector is dead local state; the Detail view can never see a user's range change. The PRD's central "selected range drives the Detail query" behavior is absent.
3. **R4 is partial (#11).** Polling never pauses on a hidden tab — explicitly required by the PRD and described in detail by the architecture and plan.
4. **Config values contradict the PRD wholesale (#1–#4).** Poll interval is 60 s not 30 s, page size 50 not 25, base URL `/v2` not `/v1`, and `enableExport` ships **on** (default false in spec) — exposing the CSV export the PRD/flags say is off by default. Even the in-file comments contradict the values.
5. **Status docs are stale/false.** CONTEXT claims a WebSocket real-time channel that does not exist (#12) and the plan claims `react-i18next` localization that does not exist (#13); both, plus the "feature-complete / R1–R9 satisfied" headline, are untrue.
6. **Auth detail drift (#7–#10):** wrong session key (`pulse.auth` vs `pulse.session`), wrong profile path (`/profile` vs `/me`), PKCE claimed but unimplemented, and an unjustified `metrics:write` scope in the architecture that contradicts the read-only PRD.
7. **Route/label drift (#6)** to `/preferences`, and **dead documented endpoints** (`getMetric`/`/me` never called, #16/#17).

Recommended remediation: reconcile `src/config.ts` and `src/auth/oauth.ts` to the spec (or update specs if the new values are intentional), implement the `/auth/callback` route + visibility-aware polling + Settings→Detail range wiring, and correct the false "DONE / feature-complete" claims in CONTEXT and IMPLEMENTATION_PLAN before any "done" call.
