# pulse-dashboard — Independent Drift / Coherence Review

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/config.ts: every config value drifted (apiBaseUrl /v2, poll 60000, pageSize 50, enableExport true) vs all docs
  - src/hooks/usePolling.ts: no visibilitychange/pause-on-hidden behavior that R4/ARCH/CONTEXT/plan all claim
  - src/App.tsx: Settings route is /preferences, not the documented /settings; no /auth/callback route wired
  - src/api/metrics.ts: session-validation wrapper hits /profile, not the documented /me
  - CONTEXT.md / IMPLEMENTATION_PLAN.md: claim WebSocket real-time and react-i18next localization that do not exist in code
RIGOR: tuned
```

Reviewed with fresh eyes, on-disk only: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, `package.json`, and all 16 files under `src/`.

---

### 1. Source Brief -> Architecture

The architecture addresses every PRD requirement on paper. Per-requirement check:

- **R1 (three views, client-side routing)** — Addressed. ARCHITECTURE §"Component & route map"
  names `/`, `/metrics/:metricId`, `/settings` wrapped in `RequireAuth`, using react-router-dom v6.
- **R2 (Overview grid, 25/page)** — Addressed. `MetricGrid` + `MetricCard`, `pageSize` config key = 25.
- **R3 (detail + time series + summary header)** — Addressed. `MetricDetailView` + `LineChart`;
  API table maps `/metrics/:id` and `/metrics/:id/series`.
- **R4 (poll every 30 s, pause on hidden tab)** — Addressed. §"Polling layer" specifies `setInterval`
  at `pollIntervalMs` and a `visibilitychange` subscription.
- **R5 (date range, default 7d, drives Detail)** — Addressed. `DateRange` union, `defaultDateRange='7d'`,
  Settings selects, range drives the series query.
- **R6 (OAuth Authorization Code redirect gate)** — Addressed. §"Auth model" specifies authorize URL,
  client id, redirect URI, `RequireAuth`, callback handling, `sessionStorage` key `pulse.session`, PKCE.
- **R7 (two build-time flags, export off / dark on)** — Addressed. Flags table matches PRD defaults.
- **R8 (single config module)** — Addressed. §"Config" centralizes the four tunables.
- **R9 (graceful per-view error + retry)** — Addressed. `ApiError` + `ErrorState` per-view.

Two architecture-level concerns (not code drift, but brief→arch tension):

- **Overbuild / contradiction vs PRD scope.** PRD says the product is **read-only** ("never writes metric
  data"; out-of-scope: create/edit/delete). Yet ARCHITECTURE §"Auth model" requests scope
  `metrics:read metrics:write` (ARCHITECTURE.md:95). The `metrics:write` grant contradicts the read-only
  brief. (Code and README both use `metrics:read` only — so the architecture is the outlier; see §3 #7.)
- **Under-specified R5 mechanism.** The architecture asserts the selected range "drives the time-series
  query on the Detail view" but never specifies *how* the Settings selection reaches the Detail view
  (shared store? URL param? persisted config?). That gap is exactly where the code fails R5 (see §3 #15).

Verdict for this layer: the architecture *satisfies* R1–R9 as written; the only real flaw is the
`metrics:write` scope contradicting the read-only PRD.

### 2. Architecture -> Delivery Plan

The six-phase plan maps cleanly onto the named architecture components and lists acceptance criteria for
each. Sequencing is sound (scaffold → API client → auth → overview/polling → detail → settings/errors).
However the plan asserts components/behavior that the architecture does **not** contain and the code does
not implement:

- **Phantom localization requirement.** Plan Phase 6 acceptance (IMPLEMENTATION_PLAN.md:62): "All UI
  strings are localized via `react-i18next` (English + Spanish bundles)." This appears in **no** other
  artifact — not the PRD, not ARCHITECTURE — and there is no i18n dependency, setup, or bundle in the repo
  (see §3 #12). It is a stale/invented acceptance criterion that can never have passed.
- **Auth callback wiring is assumed but never planned as a route.** ARCHITECTURE says the provider redirects
  to `/auth/callback` and `handleCallback()` runs there, but no phase calls for registering that route, and
  the code never wires it (see §3 #13). The plan marks Phase 3 DONE with `handleCallback()` "implemented,"
  which is true as a function but false as a working flow.
- **All phases marked DONE / "feature-complete"** while numerous acceptance criteria are demonstrably unmet
  (poll cadence, pause-on-hidden, page size, export default, route path, endpoint path, session key). The
  checkbox status is stale relative to `src/`.

Verdict for this layer: plan structure is coherent, but it carries a phantom requirement (i18n) and rubber-
stamps acceptance criteria the code does not meet.

### 3. Delivery/Status -> Code

Concrete, individually checkable inconsistencies. Each is `DRIFT: <doc claim @ where> vs <code/doc fact @ where>`.

1. **DRIFT:** apiBaseUrl `https://api.pulse.example.com/v1` (PRD-implied; ARCHITECTURE.md:37 & :75; CONTEXT.md:13; README.md:26,54) **vs** code uses `https://api.pulse.example.com/v2` (src/config.ts:9).

2. **DRIFT:** Poll cadence 30000 ms / "30 seconds" (PRD R4; ARCHITECTURE.md:38; CONTEXT.md:14,17; README.md:27; IMPLEMENTATION_PLAN.md:12,44) **vs** code sets `pollIntervalMs: 60000` (src/config.ts:11) — the inline comment even says "30 seconds" while the value is 60 s.

3. **DRIFT:** Page size 25 cards/page (PRD R2; ARCHITECTURE.md:40; CONTEXT.md:14,20; README.md:29; IMPLEMENTATION_PLAN.md:43) **vs** code sets `pageSize: 50` (src/config.ts:15).

4. **DRIFT:** `enableExport` default `false` (PRD R7; ARCHITECTURE.md:46; CONTEXT.md:21; README.md:33) **vs** code sets `enableExport: true` (src/config.ts:23) — so the "Download CSV" button ships on by default.

5. **DRIFT:** `defaultDateRange` `'30d'` / "last 30 days" (README.md:28) **vs** code, PRD, ARCHITECTURE, CONTEXT, plan all say `'7d'` (src/config.ts:13; PRD.md:36; ARCHITECTURE.md:39,71; CONTEXT.md:14; IMPLEMENTATION_PLAN.md:13). README is the outlier here.

6. **DRIFT:** Session stored under `sessionStorage` key `pulse.session` (ARCHITECTURE.md:104; README.md:41; IMPLEMENTATION_PLAN.md:33-34) **vs** code uses `SESSION_KEY = 'pulse.auth'` (src/auth/oauth.ts:12).

7. **DRIFT:** OAuth scope `metrics:read metrics:write` (ARCHITECTURE.md:95) **vs** code and README use `metrics:read` only (src/auth/oauth.ts:9; README.md:40). Also contradicts the read-only PRD.

8. **DRIFT:** Session-validation endpoint `GET /me` (ARCHITECTURE.md:83; CONTEXT.md:16; README.md:62) **vs** the wrapper `getProfile()` calls `GET /profile` (src/api/metrics.ts:24).

9. **DRIFT:** Settings route path `/settings` (PRD R1; ARCHITECTURE.md:22; CONTEXT.md:10; README.md:50; and the view's own doc comment src/views/SettingsView.tsx:7) **vs** code registers `/preferences` for both the nav link and the route (src/App.tsx:17,38). There is no `/settings` route — the documented URL 404s.

10. **DRIFT:** Polling "pauses when the tab is hidden and resumes when visible" (PRD R4; ARCHITECTURE.md:109-114; CONTEXT.md:17; IMPLEMENTATION_PLAN.md:44) **vs** `usePolling` has **no** `visibilitychange` listener and no hidden-tab handling at all — it runs on mount and on a plain `setInterval`, ticking even when hidden (src/hooks/usePolling.ts:35-40).

11. **DRIFT:** "Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) … for sub-second metric refresh" claimed shipped (CONTEXT.md:18-19) **vs** no WebSocket / `wss://` / `/live` code anywhere in `src/` (grep: 0 hits). Feature does not exist and is absent from PRD/ARCHITECTURE entirely.

12. **DRIFT:** "All UI strings are localized via `react-i18next` (English + Spanish bundles)" marked done (IMPLEMENTATION_PLAN.md:62) **vs** no `react-i18next` (or any i18n) dependency in package.json, no bundles, and all UI strings hard-coded in English (e.g. src/views/OverviewView.tsx:21, src/views/SettingsView.tsx:14, src/components/ErrorState.tsx:17).

13. **DRIFT:** "The provider redirects back to `/auth/callback`; `handleCallback()` exchanges the code and stores the session" (ARCHITECTURE.md:103; IMPLEMENTATION_PLAN.md Phase 3) **vs** App.tsx registers only `/`, `/metrics/:metricId`, `/preferences` — there is no `/auth/callback` route, and `handleCallback` is never imported or invoked (grep: defined only at src/auth/oauth.ts:52). The redirect can never complete inside the app; login is effectively a dead end.

14. **DRIFT:** Detail header sourced from `GET /metrics/:id` → `Metric` (ARCHITECTURE.md:81; "Detail header (R3)") **vs** `MetricDetailView` never calls `getMetric`; the header is computed from the series points and the `<h1>` shows the raw `metricId`, not the metric's display `name` (src/views/MetricDetailView.tsx:27-46). `getMetric()` is defined but unused dead code (grep: only its definition at src/api/metrics.ts:10).

15. **DRIFT:** "From Settings the user may switch [the range] … The selected range drives the time-series query on the Detail view" (PRD R5; ARCHITECTURE.md:38,71) **vs** `SettingsView` holds the chosen range only in local `useState` and never persists or shares it (src/views/SettingsView.tsx:9), while `MetricDetailView` reads `config.defaultDateRange` directly into its own local state (src/views/MetricDetailView.tsx:13). Changing the range in Settings has zero effect on the Detail chart — R5's core behavior is unimplemented.

Minor / informational (not counted above):
- `getProfile()` itself is dead code in addition to hitting the wrong path — nothing calls it, so session validity is never actually checked against the API (grep: definition only). `RequireAuth` only checks for a stored token's presence (src/auth/RequireAuth.tsx:13).
- The CONTEXT/plan top-line status ("Feature-complete," "All six phases DONE," "satisfies every PRD requirement R1–R9") is itself drift, since items #2, #3, #4, #6, #9, #10, #13, #15 mean R2, R4, R5, R6, R7, R8 are not met as specified.

### 4. Verdict

**SIGNIFICANT DRIFT.**

Most important issues, highest first:

1. **Every value in the single config module is wrong** (src/config.ts vs all docs): apiBaseUrl `/v2`,
   poll 60 s, pageSize 50, enableExport `true`. R8's whole point — config matching the spec — is violated
   four-for-four (§3 #1–#4).
2. **R4 pause-on-hidden-tab is entirely missing** and the cadence is doubled to 60 s (§3 #2, #10). A wall-
   mounted dashboard polls twice as slowly as specified and never throttles when hidden.
3. **OAuth flow cannot complete in-app**: documented `/auth/callback` route is unwired, `handleCallback`
   is never called, and the session key is `pulse.auth` not `pulse.session` (§3 #6, #13).
4. **Documented routes/endpoints don't exist as written**: Settings is at `/preferences` not `/settings`
   (the spec URL 404s), and session validation targets `/profile` not `/me` (§3 #8, #9).
5. **R5 is non-functional**: the Settings range selection is discarded and never drives the Detail chart
   (§3 #15).
6. **Two "shipped" features are fiction**: WebSocket real-time (CONTEXT) and react-i18next localization
   (plan) have no code, dependencies, or design behind them (§3 #11, #12).
7. **Cross-doc disagreements** persist even before touching code: README defaults `defaultDateRange` to
   `30d`, and ARCHITECTURE requests a `metrics:write` scope contradicting the read-only PRD (§3 #5, #7).

The "feature-complete / all phases DONE / satisfies R1–R9" status claims in CONTEXT and the plan are not
supported by the code. This needs remediation across config, the polling hook, routing/auth wiring, the
metrics endpoint, and the Settings→Detail data path, plus a documentation reconciliation pass, before any
"done" call.

---

#### Open Questions
- Is `/v2` the intended API version going forward (docs stale), or is `/v1` correct (code stale)? Same
  question for poll interval (30 vs 60 s), page size (25 vs 50), and `enableExport` default — i.e. which
  side is the source of truth for each config value?
- Are WebSocket real-time and react-i18next localization actually in scope, or should those claims be
  struck from CONTEXT/the plan?
- Should the canonical Settings route be `/settings` or `/preferences`, and the session endpoint `/me` or
  `/profile`? (Pick one and align the other artifacts.)

#### Verification Evidence
- Read all five docs + `package.json` + all 16 `src/` files in full.
- `grep -rn` confirmed: 0 hits for WebSocket/`wss://`/`/live`; 0 hits for i18n/i18next/translation; 0 hits
  for `visibilitychange`/`document.hidden`; `handleCallback`, `getMetric`, `getProfile` each appear only at
  their definition site (unused); the only Settings route literals in code are `/preferences`.
- Could not run the app/tests (review-only, no build executed); findings are static-analysis and
  doc-vs-source comparisons, each cited to file:line above.

#### Residual Risk
- Static review only; a build/run might surface additional runtime issues (e.g. the dead-end login loop:
  `RequireAuth` calls `beginLogin` on every unauthenticated render with no callback route to break the cycle).
- I did not have ground-truth on which artifact is canonical per value, so §3 reports the disagreement
  rather than asserting which side is "correct."

#### Gate Verdict
`VERDICT: FAIL` — non-empty BLOCKING. 15 concrete drifts (8 of them functional, not just cosmetic), three
of which break core requirements (R4 polling, R5 range, R6 auth callback). Handoff should be blocked until
the config module, polling hook, routing/auth wiring, metrics endpoint, and Settings→Detail path are
reconciled with a single agreed source of truth and the docs updated to match.
