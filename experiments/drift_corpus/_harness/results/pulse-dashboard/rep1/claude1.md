# Sanity / Coherence Review — pulse-dashboard (r1-claude1)

```text
VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS (with one contradiction)
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
RIGOR: tuned
```

Reviewer: verifier (fresh-eyes). Scope: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, all of `src/`, plus `package.json` and `vite.config.ts`.
No code or docs were modified. This is a report only.

The headline: the documents are mutually consistent on almost every checkable fact, and the
**code disagrees with them on almost every one of those facts.** `src/config.ts` is wrong on
four of four documented values, the Settings route path is wrong, the auth storage key is wrong,
the `/me` endpoint is wrong, two documented behaviors (visibility-aware polling, PKCE) are not
implemented, and three "shipped" features (WebSocket real-time, i18n, OAuth callback wiring) do
not exist in the code at all. The CONTEXT/plan "feature-complete, all R1–R9 satisfied" claim is
not supportable.

---

### 1. Source Brief -> Architecture

ARCHITECTURE.md explicitly maps itself to PRD R1–R9, and on paper it covers them. Requirement
walk-through:

- **R1 (three views, client-side routing)** — Addressed. ARCH §"Component & route map" lists
  `/`, `/metrics/:metricId`, `/settings`, all under `RequireAuth`, using react-router-dom v6.
- **R2 (Overview grid, 25/page)** — Addressed. `MetricGrid`/`MetricCard`, `pageSize = 25`.
- **R3 (detail + time series + min/max/latest header)** — Addressed. `MetricDetailView`,
  `LineChart`, `/metrics/:id` + `/metrics/:id/series`.
- **R4 (poll every 30 s, pause on hidden tab)** — Addressed. ARCH §"Polling layer" specifies a
  `setInterval` at `pollIntervalMs = 30000` plus `visibilitychange` pause/resume.
- **R5 (date range, default 7d, switchable 24h/7d/30d)** — Addressed. `DateRange` union +
  `defaultDateRange = '7d'`.
- **R6 (OAuth-gated)** — Addressed. ARCH §"Auth model" describes the Authorization Code redirect
  flow, `RequireAuth`, `/auth/callback`, session in `sessionStorage` key `pulse.session`.
- **R7 (feature flags, `enableExport=false`, `enableDarkMode=true`)** — Addressed in ARCH
  §"Config".
- **R8 (single config module)** — Addressed. `src/config.ts` named as the only home for tunables.
- **R9 (graceful inline error + retry, isolated per view)** — Addressed. `ApiError` + `ErrorState`.

**Flag — ARCH contradicts the PRD's read-only premise.** PRD §Summary: *"It is read-only: it
never writes metric data."* PRD §"Out of scope": no create/edit/delete. But ARCH §"Auth model"
sets **Scope: `metrics:read metrics:write`** (ARCHITECTURE.md:95). Requesting a write scope
contradicts the read-only product. (The code agrees with the PRD, not ARCH — see §3 item 9.)

**Under-specified (minor).** ARCH never says how the Settings date-range selection is propagated
to the Detail view's query (no shared store/context/storage is named). The PRD (R5) requires the
selection to "drive the time-series query on the Detail view," and the code never wires this up
(§3 item 17). The architecture should have specified the mechanism.

Net: the architecture *satisfies* the PRD requirements but over-reaches once (`metrics:write`)
and leaves one cross-view data path (R5 selection → Detail) unspecified.

---

### 2. Architecture -> Delivery Plan

The plan's six phases map cleanly onto ARCH components (scaffold/config, API client, auth gate,
Overview+polling, detail+chart, settings+flags+errors) with per-phase acceptance criteria. The
sequencing is sane. Problems:

- **Plan invents a component the architecture (and PRD) never mentions.** Phase 6 acceptance:
  *"All UI strings are localized via `react-i18next` (English + Spanish bundles)."* i18n/localization
  appears nowhere in the PRD or ARCHITECTURE, and `react-i18next` is not a dependency. This is a
  plan claim referencing a component that neither the architecture nor the code has (§3 item 15).
- **Plan Phase 2 under-lists vs ARCH.** It says `metrics.ts` exposes `listMetrics()`,
  `getMetric(id)`, `getMetricSeries(id, range)` ("the four documented endpoints") but omits the
  `/me` wrapper that ARCH's API table lists as confirming the session (R6). Three functions are
  not four endpoints; the `/me` path is the one quietly dropped here and mis-implemented in code.
- **Stale "DONE" status.** Every phase and the §Status line assert DONE / "feature-complete
  against PRD R1–R9." Given §3, several acceptance criteria are objectively unmet (30000 ms,
  25/page, `enableExport=false`, hidden-tab pause, `/settings` route, `pulse.session` key, i18n).
  The status box is the single largest stale assumption in the plan.

---

### 3. Delivery/Status -> Code

Every concrete inconsistency between a doc claim and the code (or between two docs), as a
numbered list. Each is independently checkable.

1. **DRIFT (apiBaseUrl):** PRD/ARCH/README/CONTEXT all state the API base URL is
   `https://api.pulse.example.com/v1` (ARCHITECTURE.md §Config table; README.md §Configuration;
   CONTEXT.md line 13) **vs** code `apiBaseUrl: 'https://api.pulse.example.com/v2'`
   (`src/config.ts:9`). Code is on **v2**, docs say **v1**.

2. **DRIFT (poll interval):** PRD R4 / ARCH §Config (`pollIntervalMs 30000`) / README
   ("30000 / 30 s") / CONTEXT line 14 / plan Phase 1 & 4 all say **30000 ms** **vs** code
   `pollIntervalMs: 60000` (`src/config.ts:11`). The code's own comment on that line still says
   "PRD R4: 30 seconds" while the value is 60000. `usePolling`'s docstring also claims 30000
   (`src/hooks/usePolling.ts:13`).

3. **DRIFT (page size):** PRD R2 / ARCH §Config (`pageSize 25`) / README / CONTEXT line 20 / plan
   Phase 4 all say **25 cards per page** **vs** code `pageSize: 50` (`src/config.ts:15`, comment
   still cites "PRD R2"). `MetricGrid.tsx:7` docstring also claims "(25)".

4. **DRIFT (enableExport default):** PRD R7 / ARCH §Config flags / README / CONTEXT line 21 all
   say `enableExport` default **`false`** **vs** code `enableExport: true` (`src/config.ts:23`).
   (Because it is `true`, the "Download CSV" button is shown by default, contradicting R7's intent.)

5. **DRIFT (defaultDateRange — README vs everyone):** README.md §Configuration table states
   `defaultDateRange` default `'30d'` ("Initial date range (last 30 days)") **vs** PRD R5, ARCH
   (`'7d'`), CONTEXT line 14, plan, and code `defaultDateRange: '7d'` (`src/config.ts:13`). The
   README is the outlier; code is correct here.

6. **DRIFT (Settings route path):** PRD R1, ARCH route-map, README §Views, CONTEXT line 10, and
   plan Phase 6 all say the Settings route is **`/settings`** **vs** code, which registers it at
   **`/preferences`** (`src/App.tsx:38`) and links to `/preferences` in the nav
   (`src/App.tsx:16`). Even `SettingsView.tsx:7` self-documents as "Settings route `/settings`",
   so the file disagrees with the route that actually mounts it.

7. **DRIFT (session storage key):** ARCH §Auth ("`sessionStorage` under the key `pulse.session`",
   line 104), README §Authentication, and plan Phase 3 say the key is **`pulse.session`** **vs**
   code `SESSION_KEY = 'pulse.auth'` (`src/auth/oauth.ts:12`).

8. **DRIFT (`/me` endpoint path):** ARCH API table (`GET /me`), README §API, CONTEXT line 16, and
   plan Phase 2 say the session/profile endpoint is **`/me`** **vs** code `getProfile()` which
   calls **`/profile`** (`src/api/metrics.ts:23`).

9. **DRIFT (OAuth scope):** ARCH §Auth model states **Scope: `metrics:read metrics:write`**
   (ARCHITECTURE.md:95) **vs** code `SCOPE = 'metrics:read'` (`src/auth/oauth.ts:9`) and README,
   which both say `metrics:read`. ARCH also contradicts the PRD's read-only product (see §1). Code
   is correct; ARCH is wrong on both counts.

10. **DRIFT (PKCE claimed, not implemented):** ARCH §Auth ("the public client uses PKCE",
    line 107) and README §Authentication ("Authorization Code (PKCE) flow"), plus the code's own
    header comment (`src/auth/oauth.ts:2`), claim PKCE. The code performs **no PKCE**: `beginLogin`
    builds the authorize URL with only `response_type, client_id, redirect_uri, scope` and no
    `code_challenge`/`code_challenge_method` (`src/auth/oauth.ts:39-45`); `exchangeCode` posts
    `grant_type, code, client_id, redirect_uri` with no `code_verifier` (`src/auth/oauth.ts:65-70`).

11. **DRIFT (`/me` / `getProfile` never invoked):** ARCH says `GET /me` "Confirms session is
    valid (R6)" (ARCHITECTURE.md:83) and CONTEXT lists a `/me` wrapper as shipped (line 16). In
    code `getProfile()` is defined but **called nowhere** (grep finds only its definition);
    `RequireAuth` validates the session purely by the presence of a `sessionStorage` entry
    (`src/auth/RequireAuth.tsx:12`), never hitting the API. The documented session-validation call
    does not happen.

12. **DRIFT (Detail does not fetch `/metrics/:id`):** Plan Phase 5 acceptance: "Detail fetches
    `/metrics/:id` and `/metrics/:id/series?range=<active>`" and ARCH lists `/metrics/:id` as the
    "Detail header" source (ARCHITECTURE.md:81). In code `MetricDetailView` calls only
    `getMetricSeries(...)`; the latest/min/max header is derived from the series array
    (`src/views/MetricDetailView.tsx:15-31`). `getMetric(id)` is defined but **called nowhere**.

13. **DRIFT (polling does not pause on hidden tab):** PRD R4, ARCH §"Polling layer"
    ("subscribes to the document `visibilitychange` event: when the tab is hidden it skips
    ticks… refetches immediately when the tab becomes visible", lines 111-114), CONTEXT line 17,
    and plan Phase 4 ("pauses on hidden tabs") all promise visibility-aware polling. `usePolling`
    contains **no `visibilitychange` listener and no `document.hidden` check** at all — it is a
    plain mount-fetch + `setInterval` (`src/hooks/usePolling.ts:35-40`; grep `visibilit|hidden` →
    no hits).

14. **DRIFT (WebSocket real-time channel does not exist):** CONTEXT.md lines 18-19 claim
    "Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) that
    supplements polling for sub-second metric refresh." There is **no WebSocket code anywhere**
    in `src/` (grep `websocket|wss|/live` → no hits), and the feature is not in the PRD or ARCH.
    This is a fabricated "shipped" claim in CONTEXT.

15. **DRIFT (i18n / react-i18next does not exist):** Plan Phase 6 acceptance: "All UI strings are
    localized via `react-i18next` (English + Spanish bundles)." `react-i18next` is **not in
    `package.json`**, there is **no i18n setup or Spanish bundle**, and every UI string in the
    components is hard-coded English (grep `i18n|i18next|spanish|locale` → no hits). Not in PRD or
    ARCH either.

16. **DRIFT (OAuth callback route not wired):** ARCH §Auth step 3 and plan Phase 3 describe the
    provider redirecting to `/auth/callback`, where `handleCallback()` exchanges the code and
    stores the session, completing the flow. In code there is **no `Route` for `/auth/callback`**
    in `App.tsx`, and **`handleCallback` is imported/called nowhere** (grep `handleCallback` →
    only its definition). As written, an unauthenticated user is redirected out to the provider and
    the app has no way to consume the redirect back — the login loop cannot complete in-app.

17. **DRIFT (R5 selection does not drive the Detail query):** PRD R5: "The selected range drives
    the time-series query on the Detail view." In code, `SettingsView`'s range is isolated local
    `useState` that is never persisted or lifted (`src/views/SettingsView.tsx:9`), and
    `MetricDetailView` initializes its range from `config.defaultDateRange` and never reads the
    Settings selection (`src/views/MetricDetailView.tsx:13`). Changing the range in Settings has
    no effect on the chart query.

Minor / for-awareness (not counted above):

- ARCH §API ("Every request carries `Authorization: Bearer …`") vs code, which attaches the
  header only when a session exists (`src/api/client.ts:24-26`). Acceptable in practice but not
  literally "every request."
- CONTEXT §"What's shipped" restates the *documented* config values (v1, 30000, '7d', 25) as
  shipped — all four are wrong in the actual `src/config.ts` (items 1–4), so the shipped list is
  doubly inaccurate.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

The docs largely agree with each other, but the code has diverged from them on nearly every
specific, checkable fact, and three "shipped" features are pure documentation fiction. The
CONTEXT/plan claim of "feature-complete, all R1–R9 satisfied / all phases DONE" is false.

Most important issues, most important first:

1. **OAuth flow cannot complete (item 16).** No `/auth/callback` route, `handleCallback` never
   wired. R6 is not actually functional in the running app — the most severe gap.
2. **`src/config.ts` is wrong on all four single-source values (items 1–4):** v2 (vs v1),
   60000 ms (vs 30000), pageSize 50 (vs 25), `enableExport=true` (vs false). R8's whole point is
   that these are authoritative; they directly violate R2, R4, R7.
3. **Three fabricated "shipped" claims:** WebSocket real-time (item 14, CONTEXT), react-i18next
   EN/ES localization (item 15, plan), and the `/me` session-validation call (item 11,
   ARCH/CONTEXT). None exist in code.
4. **Documented behaviors missing:** visibility-aware polling (item 13) and PKCE (item 10) are
   promised by PRD/ARCH/README but absent from the code.
5. **Path/key/route mismatches that break the documented contract:** Settings at `/preferences`
   not `/settings` (item 6), session key `pulse.auth` not `pulse.session` (item 7), profile
   endpoint `/profile` not `/me` (item 8).
6. **R5 not fully wired (item 17):** the Settings range selection does not reach the Detail query.
7. **Internal doc contradictions:** README defaultDateRange `'30d'` vs everyone's `'7d'` (item 5);
   ARCH scope `metrics:write` vs read-only PRD and code (item 9).

---

#### Open Questions
- Is this corpus an intentional drift-injection fixture? Several mismatches (config values flipped,
  routes/keys/endpoints renamed, comments left citing the old value) read like deliberately seeded
  drift rather than organic decay. If so, this report is the detection pass; no remediation implied.
- Which side is authoritative for each conflict — docs or code? (e.g., is the API really v2 now, or
  is the code wrong?) Remediation direction depends on that answer.

#### Verification Evidence
- Read all six docs + `package.json` + `vite.config.ts` + all 16 files under `src/`.
- grep confirmations: `handleCallback`, `getProfile`, `getMetric` defined-but-unused;
  `visibilit|hidden` → 0 hits; `websocket|wss|/live` → 0 hits; `i18n|i18next|spanish|locale` →
  0 hits in src and package.json; `code_challenge|code_verifier` → 0 hits (only the comment);
  `SESSION_KEY = 'pulse.auth'` confirmed at `src/auth/oauth.ts:12`.
- Did not run the app or build (`npm` not invoked); findings are from static cross-reading, which
  is sufficient for the path/value/endpoint/feature-presence drifts reported.

#### Residual Risk
- Low risk of false positives on the 17 numbered items — each cites exact file:line and a concrete
  doc location. The one judgment call is item 12 (Detail header derived from series is functionally
  fine; it only contradicts the *doc's stated mechanism*).
- A runtime pass could surface additional behavioral drift not visible statically (e.g., whether
  the missing callback route throws or silently dead-ends), but would not change the verdict.

#### Gate Verdict
`VERDICT: FAIL` — 17 concrete doc/code drifts, including a non-functional OAuth flow and three
fabricated shipped features. Handoff is blocked until each conflict is resolved by deciding the
authoritative side and reconciling the other, or until the drift is explicitly accepted as an
intentional fixture.
