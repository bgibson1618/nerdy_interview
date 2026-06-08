# OOP essentials (2-day version)

**Why this is rank #1:** OOP is the most learnable track in 2 days and it shows up *directly* in live
coding ("model these classes," "refactor this," "what principle does this violate?"). Examples are in
**TypeScript** since that's your language and the likely live-coding language. Type the snippets
yourself — don't just read.

The interviewer is checking whether you can **model a problem into clean, well-separated objects** and
**talk about why** one design is better than another. That's it. The vocabulary below is the toolkit.

---

## 1. The four pillars (know these cold — common warm-up question)

**Encapsulation** — bundle data with the methods that operate on it, and **hide internal state** behind
a controlled interface. *Why:* callers can't put the object in a bad state; you can change internals
freely.
```ts
class BankAccount {
  #balance = 0;                          // private — no outside code can touch it directly
  deposit(amount: number) {
    if (amount <= 0) throw new Error("amount must be positive");
    this.#balance += amount;             // the ONLY way balance changes — invariant protected
  }
  get balance() { return this.#balance; } // read-only window
}
```

**Abstraction** — expose *what* an object does, hide *how*. Callers depend on a simple interface, not
the messy implementation.
```ts
interface PaymentGateway { charge(cents: number): Promise<boolean>; }
// Callers know charge(). They don't know (or care) if it's Stripe, PayPal, or a mock.
```

**Inheritance** — a subclass reuses/extends a base class (`is-a`). Powerful but **easy to overuse** —
see composition-over-inheritance below.
```ts
class Animal { move() { return "moving"; } }
class Dog extends Animal { speak() { return "woof"; } } // a Dog is-an Animal
```

**Polymorphism** — one interface, many implementations; the caller treats them uniformly and the right
behavior runs at runtime. **This is the one interviewers love** — it's how you replace `if/else` chains
with clean object dispatch.
```ts
interface Shape { area(): number; }
class Circle implements Shape { constructor(public r: number) {} area() { return Math.PI*this.r**2; } }
class Square implements Shape { constructor(public s: number) {} area() { return this.s**2; } }

const shapes: Shape[] = [new Circle(2), new Square(3)];
const total = shapes.reduce((sum, s) => sum + s.area(), 0); // no type-checking, no switch — polymorphism
```

---

## 2. SOLID (5 principles — the senior vocabulary)

Each is "a smell it fixes." Be able to name the principle *and* the smell.

- **S — Single Responsibility.** A class should have **one reason to change** / one job. *Smell:* a
  `User` class that also formats emails and writes to the DB. *Fix:* split into `User`,
  `EmailFormatter`, `UserRepository`.

- **O — Open/Closed.** Open for **extension**, closed for **modification** — add behavior by adding new
  code, not editing existing code. *Smell:* a `switch (shape.type)` you must edit every time a new shape
  is added. *Fix:* polymorphism — each shape implements `area()`; adding a shape adds a class, touches
  nothing else. **(This is the most-asked SOLID principle — tie it to polymorphism above.)**

- **L — Liskov Substitution.** A subclass must be usable **anywhere its base is** without breaking
  behavior. *Smell:* `Square extends Rectangle` but overriding `setWidth` to also change height — code
  written for `Rectangle` now breaks. *Fix:* don't force an `is-a` that isn't truly substitutable.

- **I — Interface Segregation.** Many small, focused interfaces beat one fat one — don't force a class
  to implement methods it doesn't use. *Smell:* a `Machine` interface with `print/scan/fax` that a
  simple printer must stub out. *Fix:* split `Printer`, `Scanner`, `Fax`.

- **D — Dependency Inversion.** Depend on **abstractions (interfaces), not concretions.** *Smell:*
  `OrderService` does `new StripeClient()` inside it — now it's welded to Stripe and untestable. *Fix:*
  inject a `PaymentGateway` interface; pass Stripe (or a mock) in.
```ts
class OrderService {
  constructor(private payment: PaymentGateway) {} // depends on the interface, not Stripe
}
// Test with a fake gateway; swap providers without touching OrderService. That's D + abstraction + testability in one move.
```

---

## 3. Composition over inheritance (say this phrase — it's a senior signal)

**Inheritance models `is-a`; composition models `has-a`.** Prefer composition: build behavior by
*combining* small objects rather than growing deep class trees. Deep inheritance is rigid (change the
base, break everything) and forces awkward hierarchies.

```ts
// Inheritance trap: what about a RobotDog that moves but doesn't eat? The tree fights you.
// Composition: assemble capabilities.
interface Mover { move(): string; }
interface Eater { eat(): string; }
class Walks implements Mover { move() { return "walking"; } }
class Dog { constructor(private mover: Mover) {} move() { return this.mover.move(); } } // has-a Mover
```
*Interview line:* "I'd favor composition here — it keeps the pieces swappable and avoids a rigid class
hierarchy."

---

## 4. Design patterns worth naming (just the high-frequency ones)

You don't need all 23 Gang-of-Four patterns. Know these few — be able to say *what problem each solves*
and recognize when to reach for it.

- **Strategy** — encapsulate interchangeable algorithms behind one interface; pick at runtime. *Solves:*
  a growing `if/else` over "which algorithm." (e.g., `SortStrategy`, `PricingStrategy`.) **Most-useful
  pattern for interviews** — it's polymorphism applied to behavior.

- **Factory** — a method/class that creates objects so callers don't `new` concretions directly.
  *Solves:* "construction logic is duplicated / depends on a type flag." Returns an interface type.

- **Observer** — subjects notify a list of subscribers when state changes (pub/sub). *Solves:*
  "many things must react to one event" without the subject knowing who's listening. (Event systems,
  UI updates.)

- **Singleton** — one shared instance globally. *Solves:* "exactly one of this thing" (a config or
  connection pool). **Name its downside too** — global mutable state, hard to test; many treat it as an
  anti-pattern. Saying that is the senior move.

- **Adapter** — wraps an incompatible interface to look like the one your code expects. *Solves:*
  "this third-party API doesn't match my interface." (Your `agent_roster` backends are basically
  adapters over codex/gemini/claude CLIs — a real example you can cite.)

- **Decorator** — wrap an object to add behavior without changing it (and stack wrappers). *Solves:*
  "add logging/caching/auth around an existing object." Composition in action.

---

## 5. How to attack an OOD ("design these classes") problem

When they say "design a parking lot / deck of cards / elevator / vending machine," use this loop —
it's the OOP cousin of the system-design framework:

1. **Clarify requirements & scope.** What must it do? What's out of scope? (Same as always — don't
   start coding classes yet.)
2. **Find the nouns → candidate classes.** ("parking lot, level, spot, vehicle, ticket" → classes.)
3. **Find the verbs → methods.** ("park, leave, find spot, pay" → methods on those classes.)
4. **Assign responsibilities (apply SRP).** Each class owns one job. Who knows what? Who talks to whom?
5. **Define relationships.** has-a (composition) vs is-a (inheritance). Prefer composition. Use an
   interface/enum for variants (vehicle *types*, spot *sizes*).
6. **Walk a scenario end to end** out loud ("a car arrives → `ParkingLot.park(car)` → finds a free
   compatible `Spot` → issues a `Ticket`"). This proves the design works and surfaces gaps.

---

## 6. Worked OOD — parking lot (the classic; in TypeScript)

```ts
enum VehicleSize { Motorcycle, Car, Truck }

abstract class Vehicle {
  constructor(public readonly plate: string, public readonly size: VehicleSize) {}
}
class Car extends Vehicle { constructor(plate: string) { super(plate, VehicleSize.Car); } }
class Motorcycle extends Vehicle { constructor(plate: string) { super(plate, VehicleSize.Motorcycle); } }

class Spot {
  private occupiedBy: Vehicle | null = null;
  constructor(public readonly id: string, public readonly size: VehicleSize) {}
  isFree() { return this.occupiedBy === null; }
  // SRP: a Spot only knows whether IT can hold a vehicle. It doesn't search or price.
  fits(v: Vehicle) { return this.isFree() && v.size <= this.size; }
  occupy(v: Vehicle) { this.occupiedBy = v; }
  vacate() { this.occupiedBy = null; }
}

class Ticket {
  constructor(public readonly plate: string, public readonly spotId: string, public readonly issuedAt: number) {}
}

class ParkingLot {
  private spots: Spot[];
  private active = new Map<string, Ticket>();         // plate -> ticket
  constructor(spots: Spot[]) { this.spots = spots; }

  park(v: Vehicle, now: number): Ticket {
    const spot = this.spots.find(s => s.fits(v));      // polymorphic over vehicle size
    if (!spot) throw new Error("lot full for this size");
    spot.occupy(v);
    const ticket = new Ticket(v.plate, spot.id, now);
    this.active.set(v.plate, ticket);
    return ticket;
  }

  leave(plate: string): void {
    const ticket = this.active.get(plate);
    if (!ticket) throw new Error("no active ticket");
    this.spots.find(s => s.id === ticket.spotId)?.vacate();
    this.active.delete(plate);
  }
}
```
**What to narrate while writing it:** "I'm separating `Spot` (knows if it can hold a vehicle), `Ticket`
(a record), and `ParkingLot` (orchestrates) — that's single-responsibility. Vehicle is an abstract base
with concrete types; if pricing varied by type I'd inject a `PricingStrategy` rather than `switch` on
the type — open/closed." That sentence alone shows three principles at once.

**Likely follow-ups (have a one-liner ready):**
- *"Multiple levels?"* → add a `Level` class holding `Spot[]`; `ParkingLot` composes `Level[]`.
- *"Pricing?"* → inject a `PricingStrategy` interface (Strategy pattern) — flat/hourly/by-size without
  editing `ParkingLot` (open/closed).
- *"Concurrency — two cars, one spot?"* → the `find`+`occupy` must be atomic (a lock around spot
  assignment), or you double-book. *(You know this cold from the roster's `flock` atomic-claim work —
  cite it.)*

---

## One-page cheat sheet (re-read morning-of)

**4 pillars:** Encapsulation (hide state behind methods) · Abstraction (expose what, hide how) ·
Inheritance (is-a, don't overuse) · **Polymorphism (one interface, many impls — replaces if/else).**

**SOLID:** **S**ingle responsibility (one reason to change) · **O**pen/closed (extend, don't modify →
polymorphism) · **L**iskov (subclass substitutable for base) · **I**nterface segregation (small focused
interfaces) · **D**ependency inversion (depend on interfaces, inject concretions).

**Composition over inheritance:** has-a over is-a; assemble small swappable pieces; avoid deep trees.

**Patterns:** Strategy (swappable algorithms) · Factory (centralize creation) · Observer (pub/sub) ·
Singleton (one instance — name the downside) · Adapter (wrap a mismatched interface) · Decorator
(wrap to add behavior).

**OOD loop:** clarify → nouns=classes → verbs=methods → assign one responsibility each → relationships
(prefer composition) → walk a scenario out loud.
