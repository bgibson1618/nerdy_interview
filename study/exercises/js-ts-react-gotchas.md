# Code-Review Gotcha Exercises (JS / TS / React)

Hands-on companion to the "JS/TS-specific gotchas" checklist in `../../NERDY_STUDY_PLAN.md`.
Each exercise: a buggy snippet, how it slips past review, and the fix. Do them out loud.

## JavaScript runtime gotchas


Each exercise: a buggy snippet, a short note on how it slips through review, and the fix.
Snippets are TypeScript but the bugs are runtime/JS-semantics bugs the compiler will not always catch.

---

### Missing `await` (floating promise used as a condition)

```ts
async function isExpired(session: Session): Promise<boolean> {
  return Date.now() > session.expiresAt;
}

async function reap(session: Session) {
  if (isExpired(session)) {            // missing await
    await db.sessions.delete(session.id);
  }
}
```

**Why it slips review:** `isExpired(...)` returns a `Promise`, and a Promise is always truthy, so the
branch runs unconditionally — every session gets deleted. Plain TypeScript does not flag the truthiness
of a Promise (only the `no-misused-promises` lint rule does), so the diff reads as correct.

```ts
async function reap(session: Session) {
  if (await isExpired(session)) {
    await db.sessions.delete(session.id);
  }
}
```

---

### `.forEach(async …)` — floating promises

```ts
async function saveAll(items: Item[]) {
  items.forEach(async (item) => {
    await db.save(item);               // each promise floats; forEach discards it
  });
  console.log('all saved');            // logs before a single save resolves
}
```

**Why it slips review:** the `await` inside looks like it makes the loop wait, but `forEach` ignores the
returned promises. Errors become unhandled rejections and the function "completes" before any write lands.

```ts
async function saveAll(items: Item[]) {
  await Promise.all(items.map((item) => db.save(item)));
  console.log('all saved');
}
```

---

### Serial `await` in a loop that should be `Promise.all`

```ts
async function loadAll(ids: string[]): Promise<User[]> {
  const users: User[] = [];
  for (const id of ids) {
    users.push(await fetchUser(id));   // requests run strictly one after another
  }
  return users;
}
```

**Why it slips review:** the code is correct, just needlessly serial — N independent fetches run
back-to-back instead of concurrently. It only shows up as latency under load, never in a quick read.

```ts
async function loadAll(ids: string[]): Promise<User[]> {
  return Promise.all(ids.map(fetchUser));
}
```

---

### `==` coercion vs `===`

```ts
function isReset(value: unknown): boolean {
  return value == 0;                   // matches 0, '', '0', false, and []
}
```

**Why it slips review:** `==` triggers type coercion, so `isReset('')`, `isReset(false)`, and even
`isReset([])` all return `true`. Reviewers read "is it zero?" and move on. (`value == null` to catch both
`null` and `undefined` is the one idiomatic loose-equality use; everything else should be `===`.)

```ts
function isReset(value: unknown): boolean {
  return value === 0;
}
```

---

### Falsy traps with `||` defaults

```ts
function withDefaults(opts: { retries?: number; name?: string }) {
  const retries = opts.retries || 3;   // an explicit 0 becomes 3
  const name = opts.name || 'anon';    // an explicit '' becomes 'anon'
  return { retries, name };
}
```

**Why it slips review:** `||` falls through on every falsy value, not just `undefined`. A caller who
deliberately passes `retries: 0` or `name: ''` silently gets the default instead of their value.

```ts
function withDefaults(opts: { retries?: number; name?: string }) {
  const retries = opts.retries ?? 3;   // only undefined/null falls through
  const name = opts.name ?? 'anon';
  return { retries, name };
}
```

---

### Mutating an input argument

```ts
function addAdmin(users: User[], admin: User): User[] {
  users.push(admin);                   // mutates the caller's array
  return users;
}
```

**Why it slips review:** it returns a value, so it looks pure, but the caller's original array is now
modified too. Aliased state like this causes "spooky action at a distance" bugs far from this function —
especially painful with React props or shared cache entries.

```ts
function addAdmin(users: User[], admin: User): User[] {
  return [...users, admin];
}
```

---

### In-place `.sort()` mutating the caller's array

```ts
function topThree(scores: number[]): number[] {
  return scores.sort((a, b) => b - a).slice(0, 3);  // sort reorders scores in place
}
```

**Why it slips review:** `.sort()` (and `.reverse()`, `.splice()`) mutate and return the *same* array, so
the chained `.slice` hides the side effect — the caller's `scores` is now permanently reordered. (`.sort()`
with no comparator also sorts lexicographically: `[10, 9, 1].sort()` → `[1, 10, 9]`.)

```ts
function topThree(scores: number[]): number[] {
  return [...scores].sort((a, b) => b - a).slice(0, 3);
}
```

---

### Shared object reference

```ts
const DEFAULT_ROW = { selected: false };

function makeRows(n: number) {
  return Array.from({ length: n }, () => DEFAULT_ROW);  // every slot is the SAME object
}

const rows = makeRows(3);
rows[0].selected = true;               // rows[1] and rows[2] are now selected too
```

**Why it slips review:** the factory looks like it produces independent rows, but each element points at
one shared object. Mutating one entry mutates them all. The same trap hits a single default reused as a
default parameter value or via `.fill({})`.

```ts
function makeRows(n: number) {
  return Array.from({ length: n }, () => ({ selected: false }));  // fresh object each time
}
```

---

### Floating-point equality

```ts
function chargedFull(total: number): boolean {
  return total === 0.3;                // 0.1 + 0.2 === 0.30000000000000004
}

chargedFull(0.1 + 0.2);                // false
```

**Why it slips review:** exact `===` on computed floats fails because binary floating point can't represent
most decimals precisely. The literal `0.3` looks obviously right, so the comparison reads as fine.

```ts
function chargedFull(total: number): boolean {
  return Math.abs(total - 0.3) < Number.EPSILON;
}
// Better still for money: work in integer cents and compare exactly.
```

---

### `parseInt` without a radix

```ts
const ids = ['1', '2', '3'].map(parseInt);  // -> [1, NaN, NaN]
```

**Why it slips review:** `map` passes `(value, index)` and `parseInt` takes `(string, radix)`, so this
calls `parseInt('2', 1)` and `parseInt('3', 2)` — both invalid radixes yield `NaN`. A bare
`parseInt('0x1f')` also surprises by reading hex → `31`. Always pass an explicit radix.

```ts
const ids = ['1', '2', '3'].map((s) => parseInt(s, 10));  // -> [1, 2, 3]
// or simply: ['1', '2', '3'].map(Number);
```

---

### `NaN` propagation

```ts
function total(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.price, 0);  // one missing price -> NaN
}

const t = total(cart);
if (t > 0) charge(t);                  // NaN > 0 is false, so this silently no-ops
```

**Why it slips review:** a single `undefined`/`NaN` input poisons the whole arithmetic result, and `NaN`
compares `false` against everything — including itself — so downstream guards like `t > 0` or `t === t`
quietly fail instead of throwing. Validate inputs or check `Number.isNaN` before trusting the result.

```ts
function total(items: Item[]): number {
  return items.reduce((sum, i) => {
    if (!Number.isFinite(i.price)) throw new Error(`bad price on ${i.id}`);
    return sum + i.price;
  }, 0);
}
```

---

### `this` lost in a `function` callback (arrow vs function)

```ts
class Timer {
  seconds = 0;
  start() {
    setInterval(function () {
      this.seconds++;                  // `this` is not the Timer instance
    }, 1000);
  }
}
```

**Why it slips review:** a `function` callback gets its own `this` (the timer/global object, or
`undefined` in strict mode), so `this.seconds` is wrong — it either throws or mutates the wrong object. An
arrow function inherits `this` lexically from `start`.

```ts
class Timer {
  seconds = 0;
  start() {
    setInterval(() => {
      this.seconds++;                  // arrow inherits `this` from start()
    }, 1000);
  }
}
```

---

### Detached method loses `this`

```ts
class Api {
  base = '/api';
  get(path: string) {
    return fetch(this.base + path);
  }
}

const api = new Api();
const handler = api.get;               // method pulled off the instance
handler('/users');                     // `this` is undefined -> reading this.base throws
```

**Why it slips review:** passing `api.get` as a callback (event handlers, `setTimeout`, prop drilling)
detaches it from its receiver, so `this` is no longer the instance. The call site looks innocent.

```ts
const handler = api.get.bind(api);     // or: const handler = (p: string) => api.get(p);
handler('/users');
// Or define get as an arrow class field: get = (path: string) => fetch(this.base + path);
```

---

### Empty `catch` swallows errors

```ts
async function loadConfig(): Promise<Config> {
  try {
    return await readConfig();
  } catch (e) {
    // ignore and fall through
  }
  return DEFAULT_CONFIG;
}
```

**Why it slips review:** the empty `catch` turns *every* failure — a permissions error, a JSON parse
error, a typo'd path — into "silently use defaults." Real outages get masked as normal behavior with no
log to trace.

```ts
async function loadConfig(): Promise<Config> {
  try {
    return await readConfig();
  } catch (e) {
    if (e instanceof FileNotFoundError) return DEFAULT_CONFIG;  // only the expected case
    logger.error('readConfig failed', e);
    throw e;
  }
}
```

---

### Throwing a non-`Error` value

```ts
function parseAge(v: string): number {
  const n = Number(v);
  if (Number.isNaN(n)) throw `invalid age: ${v}`;   // throwing a string
  return n;
}

try {
  parseAge('abc');
} catch (e) {
  logger.error(e.message);             // undefined — a string has no .message or stack
}
```

**Why it slips review:** throwing a string/object "works," so it passes a smoke test, but every handler
that assumes `e instanceof Error` (`.message`, `.stack`, error reporters) breaks. You also lose the stack
trace captured at the throw site.

```ts
function parseAge(v: string): number {
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`invalid age: ${v}`);
  return n;
}
```

---

### Not awaiting inside `try` so `catch` never fires

```ts
async function safeSave(item: Item): Promise<boolean> {
  try {
    db.save(item);                     // returns a promise; not awaited
    return true;                       // always returns true
  } catch (e) {
    return false;                      // unreachable — the rejection escapes the try
  }
}
```

**Why it slips review:** the `try/catch` *looks* like it guards the save, but without `await` the rejection
settles after the `try` block has already exited, so `catch` never runs. The function reports success and
the failure resurfaces later as an unhandled rejection.

```ts
async function safeSave(item: Item): Promise<boolean> {
  try {
    await db.save(item);               // rejection now lands inside the try
    return true;
  } catch (e) {
    logger.error('save failed', e);
    return false;
  }
}
```

## TypeScript type-system gotchas


Six tight exercises for interview prep. Each has a buggy snippet, why it slips
past review, and the fix.

### `any` leaking through and silencing real errors

**Buggy:**
```ts
function parseConfig(raw: string) {
  const data: any = JSON.parse(raw);
  return {
    retries: data.retries,
    timeout: data.timout, // typo: still typed `any`, compiles fine
  };
}
```

**Why it trips reviewers:** `any` is contagious — once `data` is `any`, every
property access off it is unchecked, so the `timout` typo (and any wrong shape)
type-checks cleanly and only blows up at runtime. Reviewers see a typed-looking
return object and trust it.

**Fixed:**
```ts
interface Config {
  retries: number;
  timeout: number;
}

function isConfig(v: unknown): v is Config {
  return typeof v === "object" && v !== null
    && typeof (v as Config).retries === "number"
    && typeof (v as Config).timeout === "number";
}

function parseConfig(raw: string): Config {
  const data: unknown = JSON.parse(raw);
  if (!isConfig(data)) throw new Error("invalid config");
  return { retries: data.retries, timeout: data.timout }; // Error: 'timout' does not exist
}
```
Type `JSON.parse` as `unknown` and validate; the typo is now a compile error.

### `as` casts hiding type mismatches

**Buggy:**
```ts
interface User {
  id: string;
  name: string;
  email: string;
}

const row = { id: "1", name: "Ada" };
const user = row as User;   // missing `email`, no error
sendEmail(user.email);      // `undefined` at runtime
```

**Why it trips reviewers:** `as` is an assertion, not a check — it tells the
compiler "trust me," so the missing `email` is never flagged. Reviewers tend to
skim past casts as harmless boilerplate, when they are exactly where unsoundness
hides.

**Fixed:**
```ts
const row = { id: "1", name: "Ada" };
const user: User = row; // Error: property 'email' is missing in type
```
Annotate the variable instead of casting; the missing property becomes a
compile error.

### Non-null assertion `!` on something that can actually be null/undefined

**Buggy:**
```ts
function firstAdminName(users: User[]): string {
  const admin = users.find(u => u.role === "admin");
  return admin!.name; // `!` assumes find() always matches
}
```

**Why it trips reviewers:** `!` silences the "possibly undefined" error, but
`Array.prototype.find` returns `undefined` when nothing matches. A reviewer
reads `!` as a guarantee the value exists, so the empty-list / no-admin case
crashes with "cannot read properties of undefined."

**Fixed:**
```ts
function firstAdminName(users: User[]): string | null {
  const admin = users.find(u => u.role === "admin");
  return admin ? admin.name : null; // handle the no-match case
}
```

### Loose or wrong types (`string` where a union literal belongs)

**Buggy:**
```ts
function setAlignment(align: string) {
  el.style.textAlign = align;
}

setAlignment("centre"); // typo, compiles fine
setAlignment("middle"); // invalid value, also fine
```

**Why it trips reviewers:** typing the parameter as `string` accepts every
string, so typos and invalid values sail through review and only surface at
runtime. The annotation looks safe but constrains nothing — it does no narrowing
work.

**Fixed:**
```ts
type Alignment = "left" | "center" | "right";

function setAlignment(align: Alignment) {
  el.style.textAlign = align;
}

setAlignment("centre"); // Error: '"centre"' is not assignable to 'Alignment'
```

### Unchecked index access under `noUncheckedIndexedAccess`

**Buggy:**
```ts
// tsconfig: "noUncheckedIndexedAccess": true
function lastWord(text: string): string {
  const words = text.split(" ");
  const last = words[words.length]; // off-by-one -> undefined slot
  return last!.toUpperCase();       // `!` throws away the flag's safety
}
```

**Why it trips reviewers:** `noUncheckedIndexedAccess` correctly types
`words[i]` as `string | undefined`. Reaching for `!` to quiet that error
discards exactly the safety the flag just added — and here it masks an
off-by-one (`words.length` should be `words.length - 1`), so the index reaches
an `undefined` slot and crashes.

**Fixed:**
```ts
function lastWord(text: string): string {
  const words = text.split(" ");
  const last = words[words.length - 1]; // correct index
  return last ? last.toUpperCase() : ""; // narrow away the undefined
}
```
Fix the index and narrow with a check (or optional chaining) instead of
asserting.

### Enum vs union-literal tradeoffs

**Buggy:**
```ts
enum Status {
  Active,   // 0
  Inactive, // 1
}

function setStatus(s: Status) { /* ... */ }

setStatus(0);   // works, but cryptic at the call site
setStatus(99);  // compiles! numeric enums accept any number
```

**Why it trips reviewers:** numeric enums are unsound here — any `number` is
assignable to the enum type, so `setStatus(99)` type-checks even though 99 is
not a member. Reviewers assume an enum parameter is a closed set, but it isn't,
and the enum also emits a runtime object (extra JS, weaker tree-shaking).

**Fixed:**
```ts
type Status = "active" | "inactive";

function setStatus(s: Status) { /* ... */ }

setStatus("active"); // readable and self-describing
setStatus("paused"); // Error: not assignable to 'Status'
```
Union literals are erased at compile time (zero runtime cost), are exhaustively
checkable in a `switch`, and reject non-members. **Tradeoff:** reach for an enum
(prefer a string enum, which is nominal and rejects arbitrary strings) when you
need a named runtime value to iterate over or a reverse mapping; otherwise
prefer union literals.
```

All six gotchas covered.

## React gotchas


Short review drills. Each: buggy snippet → why it slips through review → fix.

---

### Wrong / missing useEffect dependency array

```tsx
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, []); // userId used inside, but not listed

  return <div>{user?.name}</div>;
}
```

**Why it trips reviewers:** The empty array makes the fetch run once on mount, so when the `userId` prop changes the component keeps showing the first user. Reviewers skim the effect body and miss that a value referenced inside is absent from the deps.

```tsx
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]); // re-fetch when it changes

  return <div>{user?.name}</div>;
}
```

---

### Missing effect cleanup (subscriptions, timers)

```tsx
function Clock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setInterval(() => setNow(Date.now()), 1000); // never cleared
  }, []);

  return <span>{now}</span>;
}
```

**Why it trips reviewers:** With no cleanup return, every mount leaks a timer that keeps calling `setState` after unmount (and duplicates under StrictMode/remounts). It "works" in the happy path, so reviewers don't notice until they see update-on-unmounted warnings or memory growth.

```tsx
function Clock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id); // tear down on unmount/re-run
  }, []);

  return <span>{now}</span>;
}
```

---

### Stale closures over props/state

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
  }, []); // closure captures count === 0 forever

  return <span>{count}</span>;
}
```

**Why it trips reviewers:** It looks correct — deps array *and* cleanup are present — but the interval closes over `count` from the first render, so it sets `0 + 1` every tick and the counter sticks at 1. The bug is in the captured value, not the obvious checklist items reviewers scan for.

```tsx
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCount(c => c + 1), 1000); // functional update
    return () => clearInterval(id);
  }, []);

  return <span>{count}</span>;
}
```

---

### Array index as key

```tsx
function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul>
      {todos.map((todo, i) => (
        <li key={i}>
          <input defaultValue={todo.text} />
        </li>
      ))}
    </ul>
  );
}
```

**Why it trips reviewers:** `key={i}` silences the missing-key warning, so it looks done. But keying by position makes React reuse DOM nodes by slot — after a reorder or a delete, the uncontrolled input state stays attached to the wrong row.

```tsx
function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id}> {/* stable identity */}
          <input defaultValue={todo.text} />
        </li>
      ))}
    </ul>
  );
}
```

---

### Derived state stored in state instead of computed

```tsx
function Cart({ items }: { items: Item[] }) {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setTotal(items.reduce((sum, it) => sum + it.price, 0));
  }, [items]); // total is fully derivable from items

  return <div>Total: {total}</div>;
}
```

**Why it trips reviewers:** The effect is tidy, so it reads as correct. But `total` is 100% a function of `items`; storing it adds an extra render and a one-render lag window where `total` and `items` disagree. The fix is to delete the state, which is easy to miss when the code "already handles" the update.

```tsx
function Cart({ items }: { items: Item[] }) {
  const total = useMemo(
    () => items.reduce((sum, it) => sum + it.price, 0),
    [items],
  ); // compute during render; no state, no lag

  return <div>Total: {total}</div>;
}
```

---

### Needless re-renders from unstable props/deps

```tsx
const Child = React.memo(({ onSave }: { onSave: () => void }) => {
  return <button onClick={onSave}>Save</button>;
});

function Parent({ id }: { id: string }) {
  const [n, setN] = useState(0);
  // new function identity every render → memo can never skip
  return <Child onSave={() => save(id)} />;
}
```

**Why it trips reviewers:** Seeing `React.memo` on `Child`, a reviewer assumes re-renders are handled. The inline arrow creates a fresh reference each render, so memo's prop comparison always fails and the optimization is silently dead. The same trap defeats `useEffect`/`useMemo` deps that receive a fresh object/array literal.

```tsx
const Child = React.memo(({ onSave }: { onSave: () => void }) => {
  return <button onClick={onSave}>Save</button>;
});

function Parent({ id }: { id: string }) {
  const [n, setN] = useState(0);
  const onSave = useCallback(() => save(id), [id]); // stable identity
  return <Child onSave={onSave} />;
}
```

---

### Mutating state directly instead of replacing

```tsx
function TagEditor() {
  const [tags, setTags] = useState<string[]>([]);

  const add = (t: string) => {
    tags.push(t);   // mutates existing array
    setTags(tags);  // passes the same reference back
  };

  return <button onClick={() => add("new")}>Add tag</button>;
}
```

**Why it trips reviewers:** `setTags` *is* called, so the line-by-line read looks fine. But React compares by `Object.is`; the reference is unchanged, so it bails out and the UI never updates (and the mutation can corrupt later renders/memoization).

```tsx
function TagEditor() {
  const [tags, setTags] = useState<string[]>([]);

  const add = (t: string) => {
    setTags(prev => [...prev, t]); // new array, functional update
  };

  return <button onClick={() => add("new")}>Add tag</button>;
}
```

---

### XSS via dangerouslySetInnerHTML

```tsx
function Comment({ html }: { html: string }) {
  // `html` comes straight from a user-submitted comment
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

**Why it trips reviewers:** It's a one-liner that "just renders a comment," and the `html` prop name doesn't announce that it's untrusted user input — so the raw injection (allowing `<script>` / `<img onerror>` payloads) gets waved through.

```tsx
import DOMPurify from "dompurify";

function Comment({ html }: { html: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
// Better still: render as plain text ({html}) unless rich markup is truly required.
```
