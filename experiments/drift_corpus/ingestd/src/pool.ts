// Bounded-concurrency executor (PRD R3 / ARCHITECTURE 4.2).
//
// At most `concurrency` tasks run at once. submit() admits a task immediately
// if a slot is free, otherwise it waits in a FIFO queue until a slot frees up.
// drain() resolves once every submitted task has settled.
export class WorkerPool {
  private readonly concurrency: number;
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly running = new Set<Promise<void>>();

  constructor(concurrency: number) {
    if (concurrency < 1) throw new Error("concurrency must be >= 1");
    this.concurrency = concurrency;
  }

  get active(): number {
    return this.inFlight;
  }

  private acquire(): Promise<void> {
    if (this.inFlight <= this.concurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the freed slot directly to the next waiter; inFlight stays level.
      next();
    } else {
      this.inFlight--;
    }
  }

  // Submit a task. Resolves with the task's result once it has run.
  async submit<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    const p = (async () => {
      try {
        return await task();
      } finally {
        this.release();
      }
    })();
    const tracked = p.then(
      () => undefined,
      () => undefined,
    );
    this.running.add(tracked);
    tracked.finally(() => this.running.delete(tracked));
    return p;
  }

  // Wait for all in-flight and queued tasks to settle.
  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all(Array.from(this.running));
    }
  }
}
