# pulse-dashboard — Independent Sanity / Drift Review

```text
VERDICT: FAIL
DIMENSIONS:
  - PRD -> Architecture: FAIL
  - Architecture -> Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - CONTEXT.md / IMPLEMENTATION_PLAN.md: "feature-complete, satisfies every PRD R1–R9" is false; R2, R4, R5, R6, R7 each diverge from code.
  - src/config.ts: every numeric/string config value drifts from the docs (apiBaseUrl v2, poll 60000, pageSize 50, enableExport true).
  - src/App.tsx: Settings route is `/preferences`, not the documented `/settings`; no `/auth/callback` route exists.
  - src/hooks/usePolling.ts: pause-on-hidden-tab (R4) is not implemented at all.
  - CONTEXT.md: claims a WebSocket real-time channel that exists in no source file.
RIGOR: tuned
```

Reviewed with fresh eyes, on-disk only. Files read: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `package.json`, `vite.config.ts`, and all 16 files under `src/`.

---

### 1. Source Brief -> Architecture

The architecture *document* covers all nine PRD requirements on paper, but it contradicts the PRD in two places and under-specifies one. (Code conformance is Section 3; this section is PRD↔ARCHITECTURE only.)

| Req | Addressed by ARCHITECTURE? | Notes |
|-----|----------------------------|-------|
| **R1 — three views, client routing** | Yes | Route map (ARCHITECTURE §"Component & route map") lists `/`, `/metrics/:metricId`, `/settings`, all under `RequireAuth`. Matches PRD. |
| **R2 — Overview grid, 25/page** | Yes | `MetricGrid` + `pageSize=25` in Config table. Matches PRD. |
| **R3 — detail w/ line chart + min/max/latest** | Yes | `LineChart` + detail header described. Matches PRD. |
| **R4 — poll 30 s, pause on hidden tab** | Yes | §"Polling layer" explicitly describes `visibilitychange` pause/resume at 30000 ms. Matches PRD. |
| **R5 — date range default 7d, selectable, drives Detail** | **Under-specified** | Config table gives `defaultDateRange='7d'` and the API surface takes `range=`, but the architecture never explains the mechanism by which a range *chosen in Settings* reaches the Detail view's query (no store, context, URL param, or persistence is described). The PRD's "The selected range drives the time-series query on the Detail view" has no architectural realization. This gap is exactly what the code later fails to bridge (see Section 3 #14). |
| **R6 — OAuth Authorization Code redirect gate** | Yes, but **contradicts PRD** | §"Auth model" requests **`scope: metrics:read metrics:write`**. The PRD summary states the product "is read-only: it never writes metric data" and lists create/edit/delete as out of scope. Requesting a `metrics:write` scope contradicts the read-only product definition. (README, by contrast, lists scope `metrics:read` only — the docs disagree with each other too.) |
| **R7 — two build-time flags w/ stated defaults** | Yes | Flags table matches PRD (`enableExport=false`, `enableDarkMode=true`). |
| **R8 — single source of config** | Yes | §"Config" designates `src/config.ts` as sole home. Matches PRD. |
| **R9 — graceful inline API errors w/ retry** | Yes | §"Error handling" describes typed `ApiError` + `ErrorState` + per-view isolation. Matches PRD. |

**Architecture-level findings:**
- **Overbuild / contradiction (R6):** `metrics:write` scope is unjustified for a read-only product.
- **Under-spec (R5):** no described path for the Settings selection to influence the Detail query.
- Everything else in the architecture faithfully restates the PRD.

---

### 2. Architecture -> Delivery Plan

The plan's six phases map cleanly onto the architecture's components and carry acceptance criteria. Two problems:

1. **Plan invents a component the architecture (and PRD) never mention.** `IMPLEMENTATION_PLAN.md` Phase 6 acceptance criterion: *"All UI strings are localized via `react-i18next` (English + Spanish bundles)."* Nothing about i18n/localization or Spanish appears in the PRD or ARCHITECTURE, and `react-i18next` is not a stack choice anywhere in the architecture. This is a stale/foreign acceptance criterion — it references a component the architecture does not have. (It is also unmet in code; see Section 3 #13.)

2. **Every phase is marked DONE with all boxes checked, and the Status line asserts "feature-complete against PRD R1–R9."** As Section 3 shows, multiple checked criteria are false against the actual code (poll cadence, page size, hidden-tab pause, session key, flag default, endpoint path). The plan's checkboxes are not a trustworthy record of what shipped.

Sequencing itself is reasonable (scaffold → client → auth → overview → detail → settings/errors). The defect is **stale "DONE" claims**, not ordering.

---

### 3. Delivery/Status -> Code

Each item below is an independently checkable inconsistency between a doc claim and the code (or between two docs). Format: `DRIFT: <doc claim + where> vs <conflicting fact + where>`.

1. **DRIFT:** API base URL is `https://api.pulse.example.com/v1` (ARCHITECTURE §Stack/§Config table/§API surface; README Config table + API section; CONTEXT.md line 13) **vs** `apiBaseUrl: 'https://api.pulse.example.com/v2'` in `src/config.ts:9` (v2, not v1).

2. **DRIFT:** Poll interval is **30000 ms / 30 s** (PRD R4; ARCHITECTURE §Config table + §Polling layer; README Config table; CONTEXT.md line 14; plan Phase 1 & Phase 4) **vs** `pollIntervalMs: 60000` in `src/config.ts:11` (60 s — double the spec). The same file's comment on line 10 still says "PRD R4: 30 seconds," and `usePolling.ts:13` comment claims "every config.pollIntervalMs (30000 ms)" — both inline comments are now false.

3. **DRIFT:** Page size is **25 cards per page** (PRD R2; ARCHITECTURE §Config table; README Config table + Views table; CONTEXT.md line 20; plan Phase 1 & Phase 4) **vs** `pageSize: 50` in `src/config.ts:15` (consumed by `MetricGrid.tsx:12-14`).

4. **DRIFT:** `enableExport` default is **`false`** (PRD R7; ARCHITECTURE §flags table; README flags list; CONTEXT.md line 21; plan Phase 1) **vs** `enableExport: true` in `src/config.ts:23`. Because of this, the "Download CSV" button (`MetricDetailView.tsx:53`) renders by default, contrary to every doc.

5. **DRIFT:** Default date range is **`'30d'` (last 30 days)** per README Config table (`README.md:28`) **vs** `defaultDateRange: '7d'` in `src/config.ts:13` — which is what PRD R5, ARCHITECTURE §Config table, and CONTEXT.md line 14 actually specify. The README is internally wrong against the other three docs *and* the code.

6. **DRIFT:** Settings lives at route **`/settings`** (PRD R1; ARCHITECTURE route map; README Views table; CONTEXT.md line 10; plan Phase 6; even `SettingsView.tsx:7`'s own docstring) **vs** the route registered as `path="/preferences"` in `src/App.tsx:38`, with the nav `<Link to="/preferences">` at `src/App.tsx:16`. Visiting `/settings` resolves to no route.

7. **DRIFT:** Session is stored under sessionStorage key **`pulse.session`** (ARCHITECTURE §Auth model step 4; README Authentication section; plan Phase 3) **vs** `export const SESSION_KEY = 'pulse.auth'` in `src/auth/oauth.ts:12`.

8. **DRIFT:** Session-validation endpoint is **`GET /me`** (ARCHITECTURE §API surface table; README API table; `types.ts:24` comment; and `metrics.ts:21`'s own comment) **vs** `getProfile()` calling `apiGet<UserProfile>('/profile')` in `src/api/metrics.ts:23` (path `/profile`, not `/me`).

9. **DRIFT:** OAuth scope is **`metrics:read metrics:write`** (ARCHITECTURE §Auth model) **vs** `const SCOPE = 'metrics:read'` in `src/auth/oauth.ts:9`. (README line 39 agrees with the code; ARCHITECTURE is the outlier — and, per Section 1, the write scope also contradicts the read-only PRD.)

10. **DRIFT:** Auth flow "subscribes to `visibilitychange`… when the tab is hidden it skips ticks… refetches when visible" / "Polling pauses when the browser tab is hidden" (ARCHITECTURE §Polling layer; PRD R4; CONTEXT.md line 17; plan Phase 4 checked box) **vs** `src/hooks/usePolling.ts` — the hook uses only `setInterval(run, config.pollIntervalMs)` (lines 36-38) and contains **no** `visibilitychange` listener or hidden-tab logic anywhere (confirmed: zero matches for `visibilit`/`hidden` in `src/`). R4's pause-on-hidden behavior is unimplemented.

11. **DRIFT:** OAuth flow uses **PKCE** ("the public client uses PKCE," ARCHITECTURE line 107; README line 38; `oauth.ts:2` comment) **vs** `src/auth/oauth.ts` — `beginLogin()` builds the authorize URL with only `response_type/client_id/redirect_uri/scope` (lines 39-45) and `exchangeCode()` posts only `grant_type/code/client_id/redirect_uri` (lines 65-70). There is **no** `code_challenge`, `code_challenge_method`, or `code_verifier` (confirmed: zero PKCE matches in `src/`). PKCE is claimed but absent.

12. **DRIFT:** Auth flow says "The provider redirects back to `/auth/callback`; `handleCallback()` exchanges the code" (ARCHITECTURE §Auth model step 3; README line 41) **vs** `src/App.tsx` — `<Routes>` registers only `/`, `/metrics/:metricId`, and `/preferences` (lines 21-44). There is **no** `/auth/callback` route, so `handleCallback()` (`oauth.ts:52`) is never wired and is dead code; the documented redirect target has no handler.

13. **DRIFT:** "All UI strings are localized via `react-i18next` (English + Spanish bundles)" (plan Phase 6, checked) **vs** the codebase — `react-i18next` is not in `package.json` dependencies, there is no i18n setup, and all UI strings are hard-coded English literals (e.g. "Overview" `OverviewView.tsx:21`, "Settings"/"Date range"/"Dark mode" `SettingsView.tsx:14-29`, "Retry" `ErrorState.tsx:17`). Confirmed: zero `i18n`/`i18next`/`translat`/`locale` matches in `src/` or `package.json`.

14. **DRIFT:** "From Settings the user may switch [the range]… The selected range drives the time-series query on the Detail view" (PRD R5) **vs** the code — `SettingsView.tsx:9` holds the range in a purely local `useState` that is never persisted or lifted, while `MetricDetailView.tsx:13` independently initializes `const [range] = useState(config.defaultDateRange)` (no setter, never changed). There is no shared store/context/URL param connecting them, so a range chosen in Settings can never affect the Detail query. R5's cross-view wiring is unrealized.

15. **DRIFT:** "Real-time updates over a WebSocket channel (`wss://api.pulse.example.com/live`) that supplements polling for sub-second metric refresh" (CONTEXT.md lines 18-19, listed under "What's shipped") **vs** the codebase — there is no WebSocket anywhere (confirmed: zero `websocket`/`wss:`/`/live`/`socket` matches in `src/`). The feature is also absent from PRD, ARCHITECTURE, and the plan. CONTEXT claims a shipped capability that exists in no source file and no other doc.

16. **DRIFT:** ARCHITECTURE §API surface lists `GET /me` whose purpose is "Confirms session is valid (R6)" **vs** the code — `RequireAuth.tsx:12` validates the session only by the presence of `getSession()` (a sessionStorage read); `getProfile()` is never called from anywhere (confirmed: the only `getProfile` occurrence in `src/` is its own definition at `metrics.ts:22`). The documented session-confirmation call is never made.

17. **DRIFT:** CONTEXT.md line 5 ("**Feature-complete.** All six implementation phases … are DONE, and the build satisfies every PRD requirement R1–R9") and IMPLEMENTATION_PLAN.md line 67 ("All six phases are DONE. The build is feature-complete against PRD R1–R9") **vs** items #1–#16 above, which show R2 (page size), R4 (cadence + hidden pause), R5 (Settings→Detail wiring + README default), R6 (route, key, scope, PKCE, callback), and R7 (export default) all diverging from code. The umbrella "satisfies every requirement / feature-complete" status claim is false.

---

### 4. Verdict

**SIGNIFICANT DRIFT.**

This is not isolated doc rot — it is pervasive, spans every layer (config, routing, auth, polling, status narrative), and includes a phantom "shipped" feature. The "feature-complete, satisfies R1–R9" status in CONTEXT and the plan is contradicted by the code in at least six requirements. Most important issues first:

1. **Phantom shipped feature (item #15).** CONTEXT advertises a WebSocket real-time channel (`wss://…/live`) that exists in zero source files and in no other doc. A status doc inventing capabilities is the most dangerous class of drift for a reviewer or operator relying on it.

2. **R4 pause-on-hidden-tab is unimplemented, and the cadence is wrong (items #2, #10).** The hook has no `visibilitychange` handling at all, and polls every 60 s instead of 30 s — directly contradicting a checked plan box and three other docs. For a wall-mounted auto-refresh dashboard this is a core-requirement miss.

3. **Auth is materially off-spec (items #7, #11, #12, #9).** Wrong sessionStorage key (`pulse.auth` vs `pulse.session`), no PKCE despite being claimed three times, no `/auth/callback` route (so `handleCallback` is dead code), and a scope mismatch the docs can't agree on — with the architecture's `metrics:write` also contradicting the read-only PRD.

4. **Every value in the single-source config drifts (items #1, #3, #4, #5).** `apiBaseUrl` v2≠v1, `pageSize` 50≠25, `enableExport` true≠false, plus README's `defaultDateRange` 30d≠the code's 7d. R8 centralization holds, but the centralized values are uniformly wrong against the docs.

5. **Settings route renamed and Settings→Detail wiring missing (items #6, #14).** `/settings` is actually `/preferences`, and the range chosen in Settings can never reach the Detail query — R1 and R5 are both only partially realized.

6. **Endpoint path drift and a foreign i18n acceptance criterion (items #8, #13, #16).** `/profile` vs documented `/me` (and `/me` is never even called), plus a Spanish-localization plan criterion for a feature that does not exist in code or any other doc.

**Recommendation:** Treat the "DONE / feature-complete" claims as unverified. Before any done-call, reconcile `src/config.ts`, `src/App.tsx`, `src/auth/oauth.ts`, and `src/hooks/usePolling.ts` against the PRD, and correct CONTEXT (drop the WebSocket claim), the README (fix `30d`→`7d` and scope), the plan (drop/justify the i18n criterion, re-check the false boxes), and the ARCHITECTURE scope line.

---

#### Open Questions
- Is the intended API version `/v1` (docs) or `/v2` (code)? The base URL must be pinned to one before any deploy.
- Is the WebSocket/live channel an abandoned plan, a future intention, or copy-paste from another project? It should be removed from CONTEXT or promoted into PRD/ARCHITECTURE/plan with code.
- Was `react-i18next` ever in scope? If not, the Phase 6 acceptance criterion should be deleted, not left checked.
- Is `metrics:write` scope intentional? It conflicts with the read-only product definition.

#### Verification Evidence
- Read on disk: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `README.md`, `package.json`, `vite.config.ts`, and all of `src/` (16 files).
- Absence checks via grep over `src/` (all returned no matches): `websocket|wss:|/live|socket`; `i18n|i18next|translat|locale`; `visibilit|hidden`; `code_challenge|code_verifier|pkce`. PKCE text appears only in a comment (`oauth.ts:2`).
- Presence/value checks: `apiBaseUrl …/v2` (`config.ts:9`), `pollIntervalMs: 60000` (`config.ts:11`), `pageSize: 50` (`config.ts:15`), `enableExport: true` (`config.ts:23`), `defaultDateRange: '7d'` (`config.ts:13`), `SESSION_KEY = 'pulse.auth'` (`oauth.ts:12`), `SCOPE = 'metrics:read'` (`oauth.ts:9`), `path="/preferences"` (`App.tsx:38`), `apiGet('/profile')` (`metrics.ts:23`), and routes registered in `App.tsx:21-44` (no `/auth/callback`).
- Not run: no build/test executed (review-only task; no test suite present in repo). Findings are from static reading and grep, which is sufficient for the doc/code-drift mandate.

#### Residual Risk
- Static-only review: a build (`tsc && vite build`) was not run, so I cannot confirm the app compiles (e.g., `config.ts:1` imports from `./types`, which resolves correctly, but no full type-check was performed).
- I treated CONTEXT/PRD/ARCHITECTURE/README/plan as the source of truth for "intended" behavior; if any of these is itself outdated relative to a newer external spec, some "drift" items could instead be intentional changes that the docs simply haven't caught up to. The direction of fix (doc vs code) is a product decision, not mine to make.

#### Gate Verdict
**FAIL** — non-empty BLOCKING. Significant, multi-layer documentation/code drift plus a phantom shipped feature. Do not accept the "feature-complete / R1–R9 satisfied" claim until items #1–#17 are reconciled.
