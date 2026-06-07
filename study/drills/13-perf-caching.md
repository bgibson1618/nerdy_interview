## Course Dashboard Read-Through Cache — Caching & performance (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// services/dashboard-cache.ts
//
// Read-through cache in front of Postgres for the two hottest ed-tech read
// paths: the public course catalog and a student's per-course dashboard.
// One module-level store is shared by every request the process handles.

import { db } from "../db";
import type {
  Enrollment,
  Progress,
  Assignment,
  Score,
  CourseDraft,
} from "../types";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type DashboardView = {
  enrollment: Enrollment;
  progress: Progress;
  assignments: Assignment[];
};

const TTL_SECONDS = 300; // entries should live 5 minutes
const CATALOG_SCHEMA = "v3"; // bump when the serialized catalog shape changes

const store = new Map<string, CacheEntry>();

function readThrough(
  key: string,
  loader: () => Promise<unknown>,
): Promise<unknown> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.value);
  }
  return loader().then((value) => {
    store.set(key, { value, expiresAt: Date.now() + TTL_SECONDS });
    return value;
  });
}

// --- Public catalog: identical for everyone in a given locale --------------

export async function getCourseCatalog(locale: string) {
  const key = `catalog:${CATALOG_SCHEMA}:${locale}`;
  return readThrough(key, () => db.courses.listPublished({ locale }));
}

// Admin path: republish a locale's catalog and bust exactly its cache entry.
export async function publishCourse(locale: string, draft: CourseDraft) {
  await db.courses.publish(draft);
  store.delete(`catalog:${CATALOG_SCHEMA}:${locale}`);
}

// --- Student dashboard: private to a single student ------------------------

export async function getStudentDashboard(courseId: string, studentId: string) {
  const key = `dashboard:${courseId}`;
  return readThrough(key, async () => {
    const enrollment = await db.enrollments.find({ courseId, studentId });
    if (!enrollment) {
      return null; // student isn't enrolled (yet)
    }
    const [progress, assignments] = await Promise.all([
      db.progress.forStudent({ courseId, studentId }),
      db.assignments.dueSoon({ courseId, studentId }),
    ]);
    return { enrollment, progress, assignments } as DashboardView;
  });
}

// Grading worker calls this whenever a new score is persisted.
export async function recordScore(
  courseId: string,
  studentId: string,
  score: Score,
) {
  await db.progress.upsert({ courseId, studentId, score });
}

// Available for callers that need to drop a cached dashboard by hand.
export function invalidateDashboard(courseId: string) {
  store.delete(`dashboard:${courseId}`);
}

export function cacheStats() {
  return { entries: store.size, ttlSeconds: TTL_SECONDS };
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security — cross-user data leak):** `getStudentDashboard` builds its key as `dashboard:${courseId}` and drops `studentId`, but `store` is a process-global `Map` shared by every request. The first student to open a course populates the entry; the next student who opens the *same* course is served the first student's `enrollment`, `progress`, and due assignments. — It slips past because the *loader* is correctly scoped (`studentId` flows into every DB call), so the query looks right and single-user manual testing never collides; only the key omits the dimension. **Fix:** put every identity dimension in the key — `dashboard:${courseId}:${studentId}` (and `tenantId`/`locale` if you're multi-tenant), exactly like the catalog key already does.
2. **Blocker (Correctness — no write-path invalidation):** `recordScore` upserts progress but never evicts the dashboard entry, so a student sees pre-score data for up to a full TTL after grading. `invalidateDashboard` exists but is wired to nothing. — It slips past because the helper's mere presence makes invalidation *look* handled, and the catalog path (`publishCourse`) really does bust its key, so the pattern reads as consistent. **Fix:** call `invalidateDashboard` (updated to take `studentId` and use the corrected key) at the end of `recordScore`, or switch the dashboard to write-through.
3. **Should-fix (Availability — cache stampede):** `readThrough` has no single-flight. On a cold or just-expired hot key, every concurrent request falls through and runs `loader()`, so N simultaneous requests fire N identical DB queries — a thundering herd that melts the primary exactly when traffic is highest. — It slips past because it's invisible without concurrency; a load test against an already-warm key never triggers it. **Fix:** cache the in-flight `Promise` itself (store it in the map / single-flight) so concurrent misses coalesce into one load.
4. **Should-fix (Reliability — unbounded cache):** `store` has no max size and no eviction; an expired entry is only overwritten if that *same* key is requested again, so any key never re-read leaks forever. It looks bounded today *only* because the leaky key is accidentally coarse (one entry per course) — fix finding #1 and cardinality jumps to courses×students with no ceiling. — It slips past because memory looks flat in a short test and the leak rides in on the *correct* fix. **Fix:** bound it (LRU with a max entry count) or move to Redis with server-side eviction, and actively reap expired entries.
5. **Should-fix (Correctness — negative caching):** A missing enrollment caches `null` for the full TTL, so a student who enrolls (or is granted access) seconds after a miss is told "not enrolled" until the entry expires. — It slips past because the tested happy path is the already-enrolled case; the just-enrolled window is rare and timing-dependent. **Fix:** don't cache negatives, or give them a short dedicated TTL and bust on enrollment.
6. **Nit (Correctness — TTL units):** `expiresAt: Date.now() + TTL_SECONDS` adds `300` to a *millisecond* timestamp, so entries live ~300 ms, not 5 minutes — the cache is nearly a no-op and quietly amplifies the stampede in #3. — It slips past because everything still *works*, just slower; only a hit-rate or DB-load graph reveals the near-zero hit rate. **Fix:** `Date.now() + TTL_SECONDS * 1000`.
7. **Nit (Safety — shared mutable state):** On a hit, `readThrough` returns the cached object by reference (`Promise.resolve(hit.value)`); any caller that mutates the returned dashboard mutates the shared cached copy for every subsequent reader. — It slips past because it only bites when some downstream consumer mutates the result in place. **Fix:** return a clone (`structuredClone`) or `Object.freeze` the value, or treat cached values as immutable by contract.
8. **Nit (Type safety):** `readThrough` is typed `Promise<unknown>`, so `getStudentDashboard` actually returns `Promise<unknown>` and the inner `as DashboardView` cast is fiction on a cache hit — nothing validates the stored shape. — It slips past because `unknown` flows into loosely-typed callers without a compile error. **Fix:** make `readThrough<T>(key, loader: () => Promise<T>): Promise<T>` generic, and parse/validate on read if shapes can drift across deploys.
9. **Praise (Cache key design):** `getCourseCatalog` is the model to copy — `catalog:${CATALOG_SCHEMA}:${locale}` is fully qualified: it carries the `locale` dimension *and* a schema version so a deploy that changes the serialized shape can't serve stale-shaped entries, and `publishCourse` busts exactly that key. Hold this key up next to the dashboard key to make finding #1 land — same file, two keys, only one is safe.

**Senior framing to say out loud:** "Two things block the merge: the dashboard key drops `studentId` so it serves one student's private data to another, and the write path never invalidates, so scores show up a TTL late — neither ships. After that it's a fix-before-load tier — stampede, unbounded growth, negative caching — then quick correctness nits in the TTL units and the by-reference return. The good news is the catalog read already shows the right pattern: copy its fully-qualified, versioned key onto the dashboard and the worst bug collapses into a one-line change."
</details>
