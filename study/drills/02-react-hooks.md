## Live Tutoring Panel — React hooks & state (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```tsx
import React, { useState, useEffect } from "react";
import { track } from "./analytics";

interface Message {
  id: string;
  author: string;
  bodyHtml: string;
  ts: number;
}

interface Student {
  id: string;
  name: string;
  raisedHand: boolean;
}

interface Props {
  sessionId: string;
  durationSeconds: number;
  roster: Student[];
  onEnd: () => void;
}

export default function LiveTutoringPanel({
  sessionId,
  durationSeconds,
  roster,
  onEnd,
}: Props) {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const [messages, setMessages] = useState<Message[]>([]);
  const [students, setStudents] = useState<Student[]>(roster);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");

  // Session countdown.
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft(secondsLeft - 1);
    }, 1000);
  }, []);

  // End the session when the clock runs out.
  useEffect(() => {
    if (secondsLeft <= 0) onEnd();
  }, [secondsLeft, onEnd]);

  // Subscribe to the live message feed.
  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    source.onmessage = (e) => {
      setMessages((prev) => [...prev, JSON.parse(e.data)]);
    };
    return () => source.close();
  }, [sessionId]);

  // Report engagement to analytics.
  const analyticsCtx = { sessionId, messageCount: messages.length };
  useEffect(() => {
    track("tutoring_panel_active", analyticsCtx);
  }, [analyticsCtx]);

  const toggleHand = (id: string) => {
    setStudents((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, raisedHand: !s.raisedHand } : s
      )
    );
  };

  const sendMessage = () => {
    if (!draft.trim()) return;
    fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: draft }),
    });
    setDraft("");
  };

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  const visibleStudents = students.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="tutoring-panel">
      <header>
        <h2>Session {sessionId}</h2>
        <span className="clock">{mmss}</span>
      </header>

      <input
        className="student-search"
        placeholder="Filter students…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="roster">
        {visibleStudents.map((s, i) => (
          <li key={i} className={s.raisedHand ? "raised" : ""}>
            <span>{s.name}</span>
            <button onClick={() => toggleHand(s.id)}>✋</button>
          </li>
        ))}
      </ul>

      <ul className="messages">
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.author}</strong>
            <div
              className="message-body"
              dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
            />
          </li>
        ))}
      </ul>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the class…"
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
}
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security / XSS):** Line 115 pipes another student's `bodyHtml` straight into the DOM via `dangerouslySetInnerHTML`. That body is user-submitted content relayed from the `EventSource` stream (lines 50–52), so any student can post `<img src=x onerror=fetch('/steal?c='+document.cookie)>` and run script in every classmate's (and the tutor's) session. It slips past review because the field is *named* `bodyHtml` and "comes from the server," which reads as already-safe — but the server is just a relay for user input. Sanitize with DOMPurify before injecting, or render the content as text / through a safe markdown renderer that returns React elements.

2. **Blocker (Correctness):** Lines 37–41 — the countdown closes over `secondsLeft` from the *first* render (deps are `[]`), so every tick calls `setSecondsLeft(durationSeconds - 1)` with the same stale value. The clock freezes one second below the start, and because `secondsLeft <= 0` (line 45) is therefore never true, the session never auto-ends — the panel's whole reason to exist silently doesn't work. It passes a hasty review because "decrement a counter in `setInterval`" looks textbook. Fix with a functional update: `setSecondsLeft((s) => s - 1)`.

3. **Should-fix (Resource leak):** That same interval (lines 37–41) is never cleared — the effect returns no cleanup. Every mounted panel leaves a timer running after unmount, firing `setState` on a dead component (the classic "update on an unmounted component" warning) and stacking duplicate timers if the panel re-mounts. Easy to miss because the bug is the *absence* of a `return`. Fix: `const id = setInterval(...); return () => clearInterval(id);`.

4. **Should-fix (Design / derived state):** Line 32 seeds local state from the `roster` prop with `useState(roster)`. `useState` reads its argument only on the first render, so when a student joins or leaves and the parent passes a fresh `roster`, the panel keeps rendering the stale list forever. It sails through review because it works perfectly in any demo where the roster never changes mid-session. Either render from the prop directly and keep only the `raisedHand` overrides in local state, or resync on prop change (keyed remount / reducer).

5. **Should-fix (Performance):** Lines 58–61 rebuild `analyticsCtx` as a fresh object literal on every render and use it as the effect dependency, so `Object.is` always sees a "new" reference and `track()` fires on *every* render — every keystroke in the search box, every hand toggle, every incoming message. It looks safe because the dependency array is non-empty, which reviewers skim as "memoized." Fix: depend on the primitives (`[sessionId, messages.length]`) or wrap the object in `useMemo`.

6. **Nit (Correctness / perf):** Line 102 uses the array index as the `key` in a list that is filtered by `query` (lines 82–84). When the filter narrows or reorders the results, index `0` now points at a *different* student, so React reuses the wrong row's DOM/state — the `raised` highlight or input focus jumps to the wrong person. Use a stable `key={s.id}`.

7. **Nit (Accessibility):** Line 104 is an icon-only `✋` button with no accessible name, so a screen reader announces "button" (or just the emoji) with no context. Add `aria-label={`Toggle raised hand for ${s.name}`}` and consider `aria-pressed={s.raisedHand}`.

8. **Praise (Resource cleanup):** Lines 49–55 get the subscription exactly right — the `EventSource` is opened in an effect keyed on `[sessionId]` and torn down with `return () => source.close()`, so switching sessions or unmounting closes the stream cleanly with no leak. This is the pattern the countdown interval in #2/#3 should have copied; point to it as the in-file example of how it's done.

**Senior framing to say out loud:** "I'd block on two things: the `dangerouslySetInnerHTML` XSS, because it's a live security hole for everyone in the room, and the frozen countdown, because the core feature silently never fires `onEnd`. I'd raise the timer leak, the prop-desynced roster, and the per-render analytics as should-fix-before-merge — real but not ship-stoppers. The index `key` and the missing `aria-label` are quick nits a linter or a11y check would catch; and credit where it's due, the message-stream cleanup is textbook — the timer should just copy it."
</details>
