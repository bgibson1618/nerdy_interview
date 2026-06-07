VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/config.ts: every numeric/string config value drifted from docs (apiBaseUrl /v2 vs /v1, pollIntervalMs 60000 vs 30000, pageSize 50 vs 25, enableExport true vs false)
  - src/hooks/usePolling.ts: no visibilitychange handling at all — R4 "pauses on hidden tab" is documented as shipped but absent
  - src/App.tsx: Settings route is /preferences, all docs say /settings (R1)
  - IMPLEMENTATION_PLAN.md / CONTEXT.md: react-i18next (EN+ES) and WebSocket real-time channel are claimed DONE/shipped but do not exist in code, package.json, or PRD/ARCHITECTURE
  - src/auth: scope, session key, /me endpoint, PKCE, and /auth/callback wiring all drift from the documented R6 flow
RIGOR: tuned

# pulse-dashboard — Fresh-Eyes Coherence / Drift Review

Reviewer: verifier (independent). Scope: CONTEXT.md, PRD.md, ARCHITECTURE.md,
IMPLEMENTATION_PLAN.md, README.md, and all code under `src/` (plus package.json,
vite.config.ts). No prior context; read only what is on disk in this workspace.

Bottom line up front: the docs describe a coherent product, but the code has quietly
diverged from nearly every checkable fact, and two "shipped/DONE" claims (i18n and a
real-time WebSocket channel) describe features that do not exist anywhere in the code.

---

### 1. Source Brief -> Architecture

The PRD's nine requirements are each addressed by ARCHITECTURE.md. This layer is essentially
clean; the problems live downstream (plan and code), not here. One over-build and a couple of
under-specs noted.

| Req | PRD intent | Architecture coverage | Status |
|-----|-----------|------------------------|--------|
| R1 | Exactly 3 client-side routes `/`, `/metrics/:metricId`, `/settings`, no full reload | Component & route map names all three under `RequireAuth`; React Router v6 | Addressed |
| R2 | Overview grid of cards (name, latest, unit), paginated 25/page | `MetricGrid`/`MetricCard`, `pageSize=25` | Addressed |
| R3 | Detail line chart + header (latest/min/max) over active range | `LineChart`, GET `/metrics/:id` + `/metrics/:id/series` | Addressed |
| R4 | Auto-refresh polling at 30000 ms, pause on hidden tab, resume on visible | Polling layer section spells out `setInterval` + `visibilitychange` | Addressed |
| R5 | Default last 7 days; switch 24h/7d/30d from Settings; drives Detail query | `DateRange` union, `defaultDateRange='7d'`, range param | Addressed (but "drives Detail query" is under-specified — no shared-state mechanism is described, which is exactly where the code later fails) |
| R6 | OAuth 2.0 Auth-Code redirect gate; land on intended view | Auth model section: `RequireAuth`, `beginLogin`, `/auth/callback`, `handleCallback`, sessionStorage | Addressed |
| R7 | Two build-time flags; defaults `enableExport=false`, `enableDarkMode=true` | Flags table matches PRD | Addressed |
| R8 | Single config module; nothing hard-coded elsewhere | Config table; "and nowhere else" | Addressed |
| R9 | Inline error + retry per view; others unaffected | `ApiError`, `ErrorState`, per-view fetch state | Addressed |

Flags at this layer:

- **Over-build / contradiction (R6, read-only product):** ARCHITECTURE.md line 95 sets OAuth
  `Scope: metrics:read metrics:write`. The PRD is explicit that the product is read-only and
  never writes metric data (PRD lines 6, 56). Requesting `metrics:write` contradicts the brief.
  (README line 40 and the code use `metrics:read`, so the architecture is the outlier — see §3.)
- **Under-spec (R5):** "The selected range drives the time-series query on the Detail view"
  (PRD R5) is not given any mechanism in ARCHITECTURE.md — no context/store/lifted state. The
  code consequently never wires Settings → Detail (see §3 item 16).
- **Under-spec (R6):** ARCHITECTURE lists GET `/me` as "Confirms session is valid (R6)", but
  the auth flow it describes only ever reads `sessionStorage`; nothing in the design actually
  calls `/me`. The endpoint's stated purpose is never realized (see §3 items 8, 15).

---

### 2. Architecture -> Delivery Plan

The plan's phase structure maps cleanly onto the architecture's components, but it contains a
**fabricated acceptance criterion** and inherits the architecture's unrealized claims, and its
"all DONE / feature-complete" status is not credible against the code.

- **Invented requirement marked DONE:** IMPLEMENTATION_PLAN.md Phase 6 line 62 asserts
  "[x] All UI strings are localized via `react-i18next` (English + Spanish bundles)." This
  appears in *no* upstream artifact — not in the PRD, not in ARCHITECTURE.md. The plan
  introduced a requirement the architecture never specified and then checked it off. There is
  no i18n code or dependency anywhere (see §3 item 11).
- **Stale endpoint claim:** Phase 5 line 51 says "Detail fetches `/metrics/:id` and
  `/metrics/:id/series?range=<active>`." The architecture supports this (it exports
  `getMetric`), but the code never calls `/metrics/:id` from the Detail view (see §3 item 9).
  The plan asserts a behavior the code does not perform.
- **Endpoint count vs. functions:** Phase 2 lines 23-24 says `metrics.ts` exposes
  `listMetrics()`, `getMetric(id)`, `getMetricSeries(id, range)` "mapping to the four documented
  endpoints" — but lists only three functions for four endpoints; the fourth (`/me`) wrapper is
  unmentioned, and in code it is mis-pathed (`/profile`) and unused (see §3 items 8, 13-adjacent).
- **Risky "all green" status:** Phase 4 line 44 ("pauses on hidden tabs") and Phase 1 config
  values are all checked `[x]`, but the code contradicts them (see §3). The plan's closing
  "feature-complete against PRD R1–R9" (line 67) and CONTEXT's matching claim are not supported
  by the code as it stands. Acceptance boxes were ticked without the behavior existing.

---

### 3. Delivery/Status -> Code

Every concrete inconsistency found, as a numbered list. Format:
`DRIFT: <doc claim + where> vs <conflicting code/doc fact + where>`.

1. DRIFT: `apiBaseUrl = https://api.pulse.example.com/v1` (ARCHITECTURE.md line 38;
   README.md line 26; CONTEXT.md line 13) vs code `apiBaseUrl: 'https://api.pulse.example.com/v2'`
   (`src/config.ts` line 9). Code points at **/v2**; all docs say **/v1**.

2. DRIFT: poll interval `30000 ms` / 30 s (PRD R4 lines 33-34; ARCHITECTURE.md lines 39, 111;
   README.md line 27; CONTEXT.md lines 14, 17; PLAN Phase 4 line 44) vs code
   `pollIntervalMs: 60000` (`src/config.ts` line 11). Code polls every **60 s**, not 30 s. The
   in-file comment on `src/config.ts` line 10 even says "(PRD R4: 30 seconds)" while the value
   below it is 60000 — internal contradiction inside the config module.

3. DRIFT: `pageSize = 25` / "25 cards per page" (PRD R2 line 26; ARCHITECTURE.md line 40;
   README.md lines 29, 48, 50; CONTEXT.md line 20; PLAN Phase 4 line 43) vs code
   `pageSize: 50` (`src/config.ts` line 15). Grid shows **50** per page.

4. DRIFT: `enableExport` default `false` (PRD R7 line 46; ARCHITECTURE.md line 46; README.md
   line 33; CONTEXT.md line 21) vs code `enableExport: true` (`src/config.ts` line 23). The flag
   default is **flipped**, so the "Download CSV" action ships on by default.

5. DRIFT: Settings route is `/settings` (PRD R1 line 21; ARCHITECTURE.md lines 22, 50;
   README.md line 50; CONTEXT.md line 10; SettingsView's own docstring `src/views/SettingsView.tsx`
   line 7) vs code route `path="/preferences"` and `<Link to="/preferences">`
   (`src/App.tsx` lines 17, 38). The Settings page is served at **/preferences**; a deep link to
   `/settings` matches no route (blank), and R1's exact-route claim is violated.

6. DRIFT: session sessionStorage key `pulse.session` (ARCHITECTURE.md line 104; README.md
   line 41; PLAN Phase 3 lines 33-34) vs code `export const SESSION_KEY = 'pulse.auth'`
   (`src/auth/oauth.ts` line 12). Code stores the session under **`pulse.auth`**.

7. DRIFT: OAuth scope `metrics:read metrics:write` (ARCHITECTURE.md line 95) vs code
   `const SCOPE = 'metrics:read'` (`src/auth/oauth.ts` line 9) — which also matches README.md
   line 40. The architecture is internally inconsistent with both the code and the README, and
   `metrics:write` contradicts the read-only PRD.

8. DRIFT: session-validation endpoint GET `/me` (ARCHITECTURE.md lines 83, 105 purpose
   "Confirms session is valid"; README.md line 62; CONTEXT.md line 16; `src/api/metrics.ts`
   docstring line 21 "GET /me") vs code that actually requests `/profile`:
   `return apiGet<UserProfile>('/profile')` (`src/api/metrics.ts` line 23). Path mismatch
   (`/me` documented, `/profile` called) — and the function is named `getProfile`, not the
   documented `/me`.

9. DRIFT: "Detail fetches `/metrics/:id`" for the header (PLAN Phase 5 line 51; ARCHITECTURE.md
   API table line 81 "Detail header (R3)"; CONTEXT.md line 16 lists the `/metrics/:id` wrapper as
   shipped) vs code: `MetricDetailView` imports and calls only `getMetricSeries`
   (`src/views/MetricDetailView.tsx` lines 3, 15-18) and derives latest/min/max from the series
   points (lines 28-31). `getMetric` (`src/api/metrics.ts` line 10) is **never called anywhere**
   in `src/` — dead code. The documented `/metrics/:id` fetch does not happen.

10. DRIFT: polling "pauses when the browser tab is hidden and resumes when it becomes visible"
    (PRD R4 lines 33-34; ARCHITECTURE.md lines 111-114 "subscribes to the document
    `visibilitychange` event … when the tab is hidden it skips ticks"; CONTEXT.md line 17
    "pauses on hidden tab"; PLAN Phase 4 line 44 "pauses on hidden tabs") vs code:
    `usePolling` has **no** `visibilitychange` listener and **no** `document.hidden` check at all
    — it is a bare `setInterval(run, config.pollIntervalMs)` (`src/hooks/usePolling.ts`
    lines 35-40). Grep for `visibilit`/`hidden` across `src/` returns nothing. R4's
    pause-on-hidden behavior is unimplemented.

11. DRIFT: "All UI strings are localized via `react-i18next` (English + Spanish bundles)",
    marked `[x]` DONE (PLAN Phase 6 line 62) vs code: no `i18next`/`react-i18next` import or
    locale bundle exists anywhere in `src/`, and `package.json` has no i18n dependency (only
    react, react-dom, react-router-dom). All UI strings are hard-coded English
    (e.g. "Overview", "Settings", "Loading metrics…", "Download CSV"). The feature is entirely
    absent.

12. DRIFT: "Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) that
    supplements polling for sub-second metric refresh" claimed shipped (CONTEXT.md lines 18-19)
    vs code: no `WebSocket`, `wss://`, or `/live` anywhere in `src/`. The PRD and ARCHITECTURE
    never mention real-time/WebSocket either — this is a fabricated "shipped" feature.

13. DRIFT: "the public client uses PKCE" / "OAuth 2.0 Authorization Code (PKCE)" (ARCHITECTURE.md
    line 107; README.md line 38; `src/auth/oauth.ts` docstring line 2) vs code: `beginLogin`
    sends only `response_type`, `client_id`, `redirect_uri`, `scope` — **no `code_challenge`**
    (`src/auth/oauth.ts` lines 39-45) — and `exchangeCode` posts no `code_verifier`
    (lines 61-71). No PKCE is implemented; only the word appears in comments.

14. DRIFT: default date range "last 7 days" / `'7d'` (PRD R5 line 36; ARCHITECTURE.md line 39;
    CONTEXT.md line 14; code `defaultDateRange: '7d'` in `src/config.ts` line 13) vs
    README.md line 28 which lists `defaultDateRange` default `'30d'` ("Initial date range
    (last 30 days)"). README contradicts the code and every other artifact (and is internally
    inconsistent with its own Views table at README line 50). Here the **code is correct**; the
    README drifted.

15. DRIFT: OAuth redirect-back handling — "The provider redirects back to `/auth/callback`;
    `handleCallback()` exchanges the code and stores the session" (ARCHITECTURE.md lines 102-103,
    flow step 3) vs code: `src/App.tsx` defines only three routes (`/`, `/metrics/:metricId`,
    `/preferences`) and **no `/auth/callback` route**; `handleCallback` (`src/auth/oauth.ts`
    line 52) is exported but **never imported or invoked** anywhere in `src/`. The
    redirect-return half of R6 is unwired dead code; a real callback would hit no route.

16. DRIFT: "The selected range drives the time-series query on the Detail view" (PRD R5 line 38)
    vs code: `SettingsView` holds `range` in its own local `useState`
    (`src/views/SettingsView.tsx` line 9) and `MetricDetailView` independently initializes
    `range` from `config.defaultDateRange` with no setter exposed
    (`src/views/MetricDetailView.tsx` line 13). There is no shared store/context/router state, so
    changing the range in Settings has **zero effect** on the Detail query. R5's cross-view wiring
    is not implemented.

17. DRIFT: "feature-complete … satisfies every PRD requirement R1–R9" / "All six phases are DONE"
    (CONTEXT.md lines 5-6; PLAN line 67) vs the code, which (per items 5, 10, 13, 15, 16 above)
    leaves R1 (route path), R4 (hidden-tab pause), R5 (range→Detail), and R6 (PKCE + callback +
    `/me`) only partially implemented. The blanket "done/complete" status is unsupported.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

The documentation set is internally coherent and the PRD→Architecture mapping is sound, but the
code has diverged from the docs on essentially every concrete, checkable fact, and two artifacts
claim completed features that do not exist. This is not "minor numbers off by a bit" — it spans
config values, route paths, storage keys, endpoint paths, the auth flow, and fabricated
"shipped/DONE" status.

Most important issues, most important first:

1. **Fabricated completion claims (credibility risk).** PLAN Phase 6 marks react-i18next
   EN+ES localization `[x] DONE` (item 11) and CONTEXT claims a shipped `wss://…/live` WebSocket
   real-time channel (item 12) — neither exists in code, deps, or the upstream PRD/ARCHITECTURE.
   These undermine the trustworthiness of the entire "feature-complete" status (item 17).

2. **R4 behavior missing.** `usePolling` has no visibility handling at all (item 10), and the
   poll interval is 60 s instead of the documented 30 s (item 2). The headline auto-refresh
   requirement is both mis-tuned and missing its pause-on-hidden behavior.

3. **R6 auth flow incomplete and mis-specified.** No PKCE despite repeated claims (item 13),
   no `/auth/callback` route and `handleCallback` never wired (item 15), `/me` actually calls
   `/profile` and is never invoked (items 8, 9), and the session key is `pulse.auth`
   not `pulse.session` (item 6). The redirect-return half of OAuth would not function.

4. **Config drift across the board (R2/R4/R7/R8).** apiBaseUrl `/v2` vs `/v1` (item 1),
   pageSize 50 vs 25 (item 3), enableExport default flipped to `true` (item 4). Since R8 makes
   config the single source of truth, these silently propagate everywhere.

5. **R1 route path wrong.** Settings is served at `/preferences`, not `/settings` (item 5);
   deep links and the documented route contract break.

6. **R5 cross-view wiring absent.** Settings range selection does not drive the Detail query
   (item 16); `getMetric`/`/metrics/:id` for the Detail header is never called (item 9).

7. **README internal/external inconsistency.** README defaultDateRange `'30d'` contradicts the
   code and all other docs (item 14); ARCHITECTURE scope `metrics:write` contradicts the
   read-only PRD, code, and README (item 7).

Recommended (not performed — report only): reconcile `src/config.ts`, `src/App.tsx`,
`src/auth/oauth.ts`, `src/api/metrics.ts`, and `src/hooks/usePolling.ts` against the docs (or
correct the docs to match intent), and retract the i18n and WebSocket claims until the code
exists. Do not treat this build as feature-complete.

---

#### Findings
See §1–§3 above (numbered list in §3 is the authoritative drift inventory; 17 distinct items).

#### Open Questions
- Is the intended Settings route `/settings` (docs) or `/preferences` (code)? This decides
  which side is the bug.
- Are the drifted config values (60000, 50, /v2, enableExport=true) intentional recent changes
  the docs haven't caught up to, or accidental regressions?
- Were i18n and the WebSocket channel ever planned for this scope, or are those claims purely
  spurious? They are absent from the PRD and ARCHITECTURE entirely.

#### Verification Evidence
- Read all six docs and all 16 files under `src/`, plus `package.json` and `vite.config.ts`.
- Confirmed by grep across `src/`: no `visibilitychange`/`hidden`, no `WebSocket`/`wss`/`/live`,
  no `i18n`/`i18next`/locale, no `code_challenge`/`code_verifier` (PKCE); `getMetric`,
  `getProfile`, and `handleCallback` are exported but have no call sites in `src/`.
- `package.json` dependencies: react, react-dom, react-router-dom only (no i18n, no ws lib).
- Could not run the app/tests in this read-only review; findings are from static cross-reading
  of docs vs source, which is sufficient for the listed string/number/path drifts.

#### Residual Risk
- Even after the listed drifts are reconciled, R6 cannot actually complete a login in code:
  there is no `/auth/callback` route and `handleCallback` is unwired, so a real OAuth round-trip
  would dead-end. This may be masked in a dev/mock environment where a session is hand-seeded
  into `sessionStorage`, hiding the gap from casual testing.

#### Gate Verdict
FAIL — see the contract block at the top of this file. Non-empty BLOCKING; three of the
documented features (R1 route, R4 pause, R6 callback/PKCE/`/me`) are not implemented as
documented, and two "shipped/DONE" claims are fabricated. Handoff should be blocked until the
drift inventory in §3 is resolved or each item is explicitly accepted with rationale.
