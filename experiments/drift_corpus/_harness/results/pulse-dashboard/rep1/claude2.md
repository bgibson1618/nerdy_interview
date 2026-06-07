VERDICT: FAIL
DIMENSIONS:
  - Source Brief -> Architecture: PASS
  - Architecture -> Delivery Plan: FAIL
  - Delivery/Status -> Code: FAIL
BLOCKING:
  - src/config.ts: every config value drifts from the docs (apiBaseUrl /v2, pollIntervalMs 60000, pageSize 50, enableExport true)
  - src/App.tsx: documented `/settings` route does not exist — the app routes `/preferences` instead
  - src/hooks/usePolling.ts: R4 "pause polling on hidden tab" is documented everywhere but not implemented
  - CONTEXT.md / IMPLEMENTATION_PLAN.md: claim shipped features (WebSocket live channel, react-i18next) that exist in no code, dependency, or architecture doc
RIGOR: tuned

---

# pulse-dashboard — Drift / Coherence Review

Independent fresh-eyes review. Read on disk: `CONTEXT.md`, `PRD.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `README.md`, all of `src/`, plus `package.json` and `vite.config.ts`.
The four required sections follow.

---

## 1. Source Brief -> Architecture

`ARCHITECTURE.md` is the most internally honest document in the set. Walking PRD R1–R9 against
the architecture doc (not yet the code):

| Req | PRD requirement | Addressed in ARCHITECTURE.md? | Note |
|-----|-----------------|-------------------------------|------|
| R1 | Exactly three client-side routes `/`, `/metrics/:metricId`, `/settings` | Yes — route map table (§Component & route map) | Architecture is correct; the **code** diverges (see §3.8). |
| R2 | Overview grid, cards (name/value/unit), 25/page | Yes — `MetricGrid`/`MetricCard`, `pageSize 25` | Doc correct; code value differs (§3.3). |
| R3 | Detail line chart + latest/min/max header | Yes — `LineChart`, API surface, header | Satisfied. |
| R4 | Poll every 30000 ms; pause when tab hidden, resume on visible | Yes — §Polling layer describes `visibilitychange` + 30000 | Doc correct; **code implements neither the interval value nor the visibility pause** (§3.2, §3.10). |
| R5 | Default range `7d`, switchable `24h`/`7d`/`30d` | Yes — `defaultDateRange '7d'`, `DateRange` union | Satisfied in arch; README contradicts (§3.4). |
| R6 | OAuth 2.0 Authorization-Code redirect gate | Yes — §Auth model | **Contradiction/overbuild:** scope listed as `metrics:read metrics:write`. PRD is explicitly read-only ("never writes metric data"; "Out of scope: Creating, editing, or deleting metrics"). A write scope contradicts the brief. (§3.7) |
| R7 | Flags `enableExport=false`, `enableDarkMode=true` | Yes — flags table | Doc correct; code default differs (§3.5). |
| R8 | Single config module for base URL / interval / range / page size | Yes — §Config | Satisfied as a design. |
| R9 | Inline error + retry, per-view isolation | Yes — §Error handling, `ErrorState` | Satisfied. |

**Findings for §1:**
- The architecture *as a design* satisfies all nine requirements. The single PRD↔ARCHITECTURE
  contradiction is the OAuth **`metrics:write` scope** (ARCHITECTURE.md §Auth model, line 95),
  which is incompatible with the PRD's read-only mandate. Recommend dropping it.
- ARCHITECTURE.md correctly does **not** mention a WebSocket/real-time channel or i18n. Those
  are not PRD requirements. The drift is that *other* docs (CONTEXT, PLAN) invented them — see
  §2 and §3. So the architecture is not overbuilt there; the satellite docs are over-claimed.

---

## 2. Architecture -> Delivery Plan

`IMPLEMENTATION_PLAN.md` mostly maps phases cleanly onto architecture components (Phase 1→Config,
2→API, 3→Auth, 4→Overview/polling, 5→Detail/chart, 6→Settings/flags/errors). Problems:

- **Plan invents a component the architecture never specifies.** Phase 6 acceptance criterion
  (IMPLEMENTATION_PLAN.md line 62) requires *"All UI strings are localized via `react-i18next`
  (English + Spanish bundles)"* and marks it `[x]` DONE. `react-i18next` appears nowhere in
  ARCHITECTURE.md (the Stack section lists React/TypeScript/Vite/react-router-dom/fetch only),
  nowhere in `package.json` dependencies, and nowhere in `src/`. This is a plan task referencing
  a component the architecture and code do not have. (See §3.12.)
- **Endpoint-count mismatch inside the plan.** Phase 2 (lines 23–24) says `metrics.ts` exposes
  three functions "mapping to the **four** documented endpoints," but lists only `listMetrics`,
  `getMetric`, `getMetricSeries`. The fourth endpoint (`/me`) and its function are unnamed; the
  code does ship a fourth (`getProfile`) but it is dead (see §3.9, §3.14). Stale/imprecise.
- **No task wires up the OAuth callback.** Phase 3 lists `handleCallback()` as implemented, and
  ARCHITECTURE.md §Auth model step 3 says the provider "redirects back to `/auth/callback`;
  `handleCallback()` exchanges the code." But no phase creates a `/auth/callback` route/component
  to *invoke* `handleCallback`. The plan treats the auth loop as closed when it is not (§3.13).
- **The plan asserts blanket completion** ("All six phases are DONE … feature-complete against
  PRD R1–R9", lines 65–67) while several acceptance criteria it checks `[x]` are demonstrably
  false in code (30000 ms cadence, hidden-tab pause, 25/page, default false export, i18n). The
  checked boxes are not backed by the code.

---

## 3. Delivery/Status -> Code

Every concrete doc-vs-code (or doc-vs-doc) inconsistency, numbered for individual checking.
Code values were read directly from `src/`; all docs agree with each other unless noted.

1. **DRIFT:** API base URL is `https://api.pulse.example.com/v1` per CONTEXT.md line 13,
   ARCHITECTURE.md §Config line 38 & §API surface line 75, README.md lines 28 & 54
   vs `apiBaseUrl: 'https://api.pulse.example.com/v2'` in `src/config.ts` line 9. Code is on **/v2**; all docs say **/v1**.

2. **DRIFT:** Poll interval is `30000` ms ("30 seconds") per PRD R4, CONTEXT.md lines 14 & 17,
   ARCHITECTURE.md §Config line 39 & §Polling layer lines 111–112, README.md line 27,
   IMPLEMENTATION_PLAN.md lines 12 & 44 vs `pollIntervalMs: 60000` in `src/config.ts` line 11.
   Code polls every **60 s**. (Aggravating: `src/config.ts` line 10's own comment says "30 seconds,"
   and `src/hooks/usePolling.ts` lines 13–14 comment says "every config.pollIntervalMs (30000 ms)"
   — both comments contradict the value beside them.)

3. **DRIFT:** Page size is `25` cards/page per PRD R2, CONTEXT.md lines 14 & 20,
   ARCHITECTURE.md §Config line 40, README.md lines 29 & 48, IMPLEMENTATION_PLAN.md lines 13 & 43
   vs `pageSize: 50` in `src/config.ts` line 15 (and `src/components/MetricGrid.tsx` line 7 comment
   still says "(25)"). Code paginates at **50**.

4. **DRIFT:** Default date range — README.md line 28 says `defaultDateRange` default is `'30d'`
   ("Initial date range (last 30 days)") vs `defaultDateRange: '7d'` in `src/config.ts` line 13,
   which agrees with PRD R5, CONTEXT.md line 14, ARCHITECTURE.md lines 39 & 71. README is the
   outlier — it contradicts both the code and every other doc.

5. **DRIFT:** `enableExport` default is `false` per PRD R7, CONTEXT.md line 21,
   ARCHITECTURE.md §Config line 46, README.md line 33 vs `enableExport: true` in
   `src/config.ts` line 23. Code ships the CSV-export flag **on** by default.

6. **DRIFT:** Session storage key is `pulse.session` per ARCHITECTURE.md §Auth model line 104,
   README.md line 41, IMPLEMENTATION_PLAN.md lines 33–34 vs
   `export const SESSION_KEY = 'pulse.auth';` in `src/auth/oauth.ts` line 12. Code stores the
   session under **`pulse.auth`**, not the documented `pulse.session`.

7. **DRIFT:** OAuth scope is `metrics:read metrics:write` per ARCHITECTURE.md §Auth model line 95
   vs `const SCOPE = 'metrics:read';` in `src/auth/oauth.ts` line 9 (which matches README.md line 40).
   ARCHITECTURE over-states the scope; it also contradicts the PRD's read-only mandate.

8. **DRIFT:** Settings route is `/settings` per PRD R1, CONTEXT.md line 10,
   ARCHITECTURE.md route map line 22, README.md line 50 vs `path="/preferences"` in
   `src/App.tsx` line 38 (and nav `<Link to="/preferences">` line 17). The documented `/settings`
   URL does not exist in the router; visiting `/settings` resolves to no route. Functional drift.

9. **DRIFT:** Session-validation endpoint is `GET /me` per ARCHITECTURE.md §API surface line 83,
   CONTEXT.md line 16, README.md line 62 vs `apiGet<UserProfile>('/profile')` in
   `src/api/metrics.ts` line 23 (`getProfile`). Code calls **`/profile`**, not `/me`.

10. **DRIFT:** Polling "pauses when the tab is hidden and resumes when visible" per PRD R4,
    CONTEXT.md line 17, ARCHITECTURE.md §Polling layer lines 111–114, IMPLEMENTATION_PLAN.md line 44
    vs `src/hooks/usePolling.ts` — the hook only does `run()` on mount + `setInterval(run, …)`
    (lines 35–40) and has **no `visibilitychange` listener and no `document.hidden`/`visibilityState`
    check anywhere** (confirmed by grep: zero hits). The documented visibility behavior is not implemented.

11. **DRIFT:** CONTEXT.md lines 18–19 claim a shipped *"Real-time updates over a WebSocket channel
    (`wss://api.pulse.example.com/live`) … for sub-second metric refresh."* No WebSocket exists:
    no `wss`/`WebSocket` anywhere in `src/` (grep: zero hits), ARCHITECTURE.md says native fetch
    with "no data-fetching framework" and never mentions WebSockets, and PRD R4 is polling-only.
    Pure over-claim in CONTEXT.

12. **DRIFT:** IMPLEMENTATION_PLAN.md line 62 marks DONE *"All UI strings are localized via
    `react-i18next` (English + Spanish bundles)."* There is no `react-i18next` in `package.json`,
    no i18n code in `src/` (grep: zero hits), and UI strings are hard-coded English ("Overview",
    "Settings", "Retry", "Loading metrics…", "Download CSV"). Feature claimed shipped, not built.

13. **DRIFT:** ARCHITECTURE.md §Auth model lines 102–105 and IMPLEMENTATION_PLAN.md Phase 3 describe
    `handleCallback()` handling the provider redirect to `/auth/callback` vs `src/App.tsx`, which
    defines only `/`, `/metrics/:metricId`, `/preferences` — there is **no `/auth/callback` route**
    and nothing imports or calls `handleCallback` (grep: only its definition in `oauth.ts`). The
    documented auth round-trip is unwired dead code; a real login could never complete.

14. **DRIFT:** ARCHITECTURE.md §API surface line 83 says `/me` "Confirms session is valid (R6)"
    vs code: `getProfile` is never called anywhere (grep: only its definition in
    `src/api/metrics.ts`). `RequireAuth` (`src/auth/RequireAuth.tsx` line 12) decides validity
    solely from the presence of a `sessionStorage` entry via `getSession()`; no server-side
    `/me` (or `/profile`) check ever runs. The doc's stated session-validation mechanism does not exist.

15. **DRIFT (doc-internal):** IMPLEMENTATION_PLAN.md Phase 2 lines 23–24 say the three listed
    functions map to "the **four** documented endpoints" — three functions cannot map to four
    endpoints; the fourth (`getProfile`/`/me`) is omitted from the plan yet present (and dead) in code.

16. **DRIFT (status over-claim):** CONTEXT.md lines 5–6 state the build is "Feature-complete …
    satisfies every PRD requirement R1–R9," and IMPLEMENTATION_PLAN.md lines 65–67 declare all six
    phases DONE. Items 2, 3, 5, 8, 10, 11, 12 above show shipped-status claims that the code
    contradicts (R2 page size, R4 cadence + hidden-tab pause, R7 export default, R1 settings route),
    so the "feature-complete / all DONE" status is not supported by the code.

---

## 4. Verdict

**SIGNIFICANT DRIFT.**

This corpus shows pervasive, checkable divergence between the documentation set and `src/`,
plus doc-vs-doc conflicts. The architecture is the soundest artifact; CONTEXT.md and
IMPLEMENTATION_PLAN.md are the least trustworthy (they assert shipped features that do not exist).

Most important issues, in priority order:

1. **Functional auth break (§3.13):** no `/auth/callback` route and `handleCallback` is never
   invoked — the OAuth flow described everywhere cannot actually complete. Highest severity.
2. **Settings route renamed (§3.8):** code serves `/preferences`; the PRD/arch/README `/settings`
   URL 404s. Directly violates PRD R1.
3. **R4 polling half-built (§3.2, §3.10):** wrong cadence (60 s, not 30 s) and the required
   hidden-tab pause/resume is entirely absent.
4. **Config block-drift (§3.1, §3.3, §3.5):** base URL on `/v2` not `/v1`, page size 50 not 25,
   export flag defaults `true` not `false` — directly contradicting R2, R7, R8 and every doc table.
5. **Fabricated shipped features (§3.11, §3.12):** WebSocket live channel (CONTEXT) and
   react-i18next localization (PLAN) are claimed DONE but exist in no code/dep/architecture.
6. **Auth detail drift (§3.6, §3.7, §3.9, §3.14):** session key `pulse.auth` vs `pulse.session`,
   scope mismatch incl. PRD-violating `metrics:write`, `/profile` vs `/me`, and `/me` never called.
7. **README internal contradiction (§3.4):** default date range `30d` vs the code/PRD/arch `7d`.
8. **Status over-claims (§3.16):** "feature-complete / all phases DONE" is not backed by code.

### Open Questions
- Is `/preferences` the intended route and the docs stale, or is `/settings` correct and the
  code wrong? (Determines direction of the §3.8 fix.)
- Were `/v2`, 60 s, page-size 50, and `enableExport=true` deliberate post-doc changes, or
  accidental edits? They are consistent enough to look intentional but no doc records them.

### Verification Evidence
- All values read directly from `src/config.ts`, `src/App.tsx`, `src/auth/oauth.ts`,
  `src/api/metrics.ts`, `src/hooks/usePolling.ts`.
- Negative confirmations via `grep -rn` over `src/`: `visibilit*`/`hidden` → 0 hits;
  `wss`/`websocket` → 0 hits; `i18n`/`i18next` → 0 hits; `getProfile` → definition only;
  `handleCallback` → definition only; `auth/callback` → REDIRECT_URI constant + comment only.
- `package.json` dependency list contains no `react-i18next`.
- Tests: none present in the repo; could not run a test suite. Review is by static reading only.

### Residual Risk
- This was a static read; I did not execute `npm run dev`/`build`. Behavioral claims about the
  router 404, the unfinished OAuth loop, and the missing visibility pause are inferred from the
  source and grep evidence, which is conclusive for these particular drifts, but a runtime pass
  would further confirm the auth break.

### Gate Verdict
FAIL — multiple BLOCKING items (see header). Handoff should not proceed on the "feature-complete"
claim until at least the auth-callback wiring, the `/settings` route, and the config-value drift
(items §3.1/3.2/3.3/3.5/3.8/3.13) are resolved or explicitly accepted with rationale.
