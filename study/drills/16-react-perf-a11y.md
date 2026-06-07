## Grading queue panel — React performance & accessibility (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```tsx
import React, { useState, useEffect, memo } from "react";

type Submission = {
  id: string;
  studentName: string;
  assignment: string;
  score: number | null;
  maxScore: number;
  submittedAt: string;
  status: "ungraded" | "graded";
};

type Rubric = { passThreshold: number; allowLate: boolean };

type RowProps = {
  submission: Submission;
  rubric: Rubric;
  onScore: (id: string, score: number) => void;
};

// One submission in the grading queue. Memoized because the queue can be long.
const SubmissionRow = memo(function SubmissionRow({
  submission,
  rubric,
  onScore,
}: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(submission.score ?? 0);

  const invalid = draft < 0 || draft > submission.maxScore;

  return (
    <div className="row">
      <div className="row__open" onClick={() => setExpanded((e) => !e)}>
        <strong>{submission.studentName}</strong> — {submission.assignment}
      </div>

      <div className="row__grade">
        <span className="row__label">Score</span>
        <input
          type="number"
          className="row__score"
          value={draft}
          style={{ borderColor: invalid ? "#d33" : "#ccc" }}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={() => !invalid && onScore(submission.id, draft)}
        />
        <span className="row__max">/ {submission.maxScore}</span>
      </div>

      {expanded && (
        <p className="row__feedback">
          Submitted {submission.submittedAt} · pass ≥ {rubric.passThreshold}%
          {rubric.allowLate ? " · late accepted" : ""}
        </p>
      )}
    </div>
  );
});

export function GradingPanel({ submissions }: { submissions: Submission[] }) {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Debounce the filter box so we don't re-filter on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), 250);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  const visible = submissions
    .filter((s) =>
      s.studentName.toLowerCase().includes(query.toLowerCase())
    )
    .sort((a, b) => a.studentName.localeCompare(b.studentName));

  const ungraded = submissions.filter((s) => s.status === "ungraded").length;

  async function handleScore(id: string, score: number) {
    setSaving(true);
    try {
      await fetch(`/api/submissions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ score }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grading-panel">
      <header className="grading-panel__head">
        <h1>Grading queue</h1>
        <p className="grading-panel__count">{ungraded} ungraded</p>
        <input
          type="search"
          aria-label="Filter by student name"
          placeholder="Filter students…"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
        />
      </header>

      {saving && <div className="toast">Saving grade…</div>}

      <div className="grading-panel__list">
        {visible.length === 0 && <p>No matching submissions.</p>}
        {visible.map((submission, index) => (
          <SubmissionRow
            key={index}
            submission={submission}
            rubric={{ passThreshold: 60, allowLate: true }}
            onScore={handleScore}
          />
        ))}
      </div>
    </section>
  );
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (A11y):** The `row__open` element is the *only* control that opens a submission's details, but it's a `<div>` with just `onClick`. — It works perfectly in a mouse-driven demo and the stock React ESLint config won't flag it without `jsx-a11y` rules, so it sails through review. Keyboard users can't Tab to it and screen readers announce only static text, so no one on assistive tech can ever open a submission. Fix: make it a `<button type="button">` (native focus + Enter/Space), or at minimum add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handling Enter/Space.

2. **Blocker (Correctness):** `key={index}` on the filtered `visible` list while each `SubmissionRow` owns local state (`draft`, `expanded`). — It renders correctly on first paint so a quick visual pass looks clean; the bug only appears after you filter or the order shifts. Because React reconciles by position, filtering remaps the in-progress `draft` score from row 0 onto whatever student is now first — you can save the wrong grade to the wrong student. Fix: use the stable `key={submission.id}`.

3. **Should-fix (Perf):** `visible` is built with `.filter().sort()` straight in the render body. — On small seed data it's instant during review, so nobody clocks it; it re-runs on *every* render — each keystroke (because `rawQuery` updates state) and each save toggle — even though the debounced `query` rarely changes. On a real queue that drops frames and lags typing. Fix: wrap it in `useMemo(() => …, [submissions, query])`.

4. **Should-fix (Perf):** `React.memo` on `SubmissionRow` is defeated because the parent passes a fresh `rubric={{ passThreshold: 60, allowLate: true }}` literal and a new `onScore={handleScore}` reference every render. — "It's memoized" reads as done, but the inline object and the un-memoized handler hand each row new prop identities, so every row re-renders anyway. Fix: hoist the static rubric to a module-level `const`, and wrap `handleScore` in `useCallback(…, [])`.

5. **Should-fix (A11y):** The score `<input>` has no programmatic label — the visible "Score" is a sibling `<span>`, not associated with the field. — It looks labeled on screen so reviewers skim past it; screen readers announce a bare number spinner and clicking the word "Score" doesn't focus the input. Fix: use `<label htmlFor={`score-${submission.id}`}>Score</label>` with a matching `id`, or wrap the input inside a `<label>`.

6. **Should-fix (A11y):** The "Saving grade…" toast is conditionally mounted (`{saving && <div className="toast">…}`) with no live region. — Sighted reviewers watch it flash and assume feedback exists; because the node is *inserted* rather than updated inside a persistent live region, screen readers stay silent and AT users get no confirmation the grade saved. Fix: always render a `<div role="status" aria-live="polite">` container and inject the message inside it.

7. **Nit (A11y):** An invalid score is signaled only by `style={{ borderColor: invalid ? "#d33" : "#ccc" }}`. — Reads as clear validation feedback to a sighted reviewer; color-blind/low-vision users and screen readers get nothing. Fix: add `aria-invalid={invalid}`, show explicit text (e.g. `Must be 0–{submission.maxScore}`), and don't rely on hue alone.

8. **Nit (Perf):** The entire `visible` array is mapped to DOM nodes with no windowing. — Fine with a handful of rows in review; a grading queue of hundreds mounts every row at once, spiking memory and initial render cost. Fix: virtualize with `react-window`/`react-virtuoso` so only on-screen rows render. (Severity climbs with real queue size.)

9. **Should-fix (Correctness):** The score field never guards `NaN`/blank. `Number(e.target.value)` turns an empty input into `0`, and the `invalid` check (`draft < 0 || draft > maxScore`) can't catch `NaN` because *every* comparison with `NaN` is `false` — so `onBlur` happily saves `0` or `NaN`, and `JSON.stringify({ score: NaN })` ships `null` to the API. *Why it slips:* the number input *looks* validated by the border-color check. *Fix:* keep `draft` as a string, handle blank explicitly, parse on submit, and gate the save on `Number.isFinite(parsed)`.

10. **Should-fix (Correctness):** `handleScore` never checks `response.ok` and has no error branch — `fetch` doesn't reject on HTTP 4xx/5xx, so a *rejected* grade save is silently treated as success (the "Saving…" toast just clears). *Fix:* check `response.ok`, surface failures in the live region (see #6), and send a `Content-Type: application/json` header.

11. **Praise (Correctness/Perf):** The filter box is debounced in a `useEffect` that returns `clearTimeout(timer)`. — Clean work: the cleanup cancels the pending timer on every keystroke and on unmount, so there's no stale `setQuery` firing after the component is gone and no leaked timer. Keep this pattern.

**Senior framing to say out loud:** "I'd block the merge on two things — the div-as-button means keyboard and screen-reader users literally can't open a submission, and `key={index}` over a filterable list with per-row draft state can write a grade to the wrong student, which is data integrity, not polish. The defeated memo, render-body filter, missing input label, and silent save toast are all should-fix *this* PR but won't corrupt data. Virtualization and the color-only invalid state I'd raise as follow-ups or hand to a `jsx-a11y` lint rule rather than hold the PR."
</details>
