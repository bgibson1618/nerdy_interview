import { DB, openDb } from "./db";
import { Config, ManifestRow, RunSummary, SinkHandler, TaskResult } from "./types";
import { hashFile, isDuplicate } from "./dedup";
import { WorkerPool } from "./pool";
import { BatchWriter } from "./batch";
import { nextDelayMs, shouldDeadLetter, sleep } from "./retry";
import {
  Candidate,
  purgeExpired,
  softDeleteMissing,
  upsertCandidate,
  walk,
} from "./scanner";
import { Logger, createLogger } from "./logger";

// Default sink: a no-op acknowledging handler. Integrators override this.
const NOOP_SINK: SinkHandler = async () => {};

export class Ingestor {
  private readonly cfg: Config;
  private readonly db: DB;
  private readonly log: Logger;
  private readonly sink: SinkHandler;
  private stopping = false;

  constructor(
    cfg: Config,
    dbPath: string,
    opts?: { sink?: SinkHandler; logger?: Logger },
  ) {
    this.cfg = cfg;
    this.db = openDb(dbPath);
    this.sink = opts?.sink ?? NOOP_SINK;
    this.log = opts?.logger ?? createLogger({ json: false, verbose: false });
  }

  // Signal graceful shutdown: stop admitting new work; finish in-flight.
  stop(): void {
    this.stopping = true;
  }

  // Startup recovery (PRD R6 / ARCHITECTURE 4.7): rewind any in_progress rows
  // (a crash mid-batch) back to pending so they are retried, then continue.
  recover(): number {
    const now = Date.now();
    const info = this.db
      .prepare(
        `UPDATE manifest SET status = 'pending', updated_at = ? WHERE status IN ('in_progress', 'done')`,
      )
      .run(now);
    if (info.changes > 0) {
      this.log.info("recover", `rewound ${info.changes} in_progress rows`, {
        count: info.changes,
      });
    }
    return info.changes;
  }

  // Scan all sources: upsert discovered files, soft-delete missing, purge.
  private scan(): { scanned: number; enqueued: number } {
    const now = Date.now();
    const seen = new Set<string>();
    let scanned = 0;
    let enqueued = 0;
    for (const root of this.cfg.sources) {
      const candidates: Candidate[] = walk(root);
      for (const c of candidates) {
        seen.add(c.path);
        scanned++;
        const r = upsertCandidate(this.db, c, now);
        if (r === "new" || r === "changed") enqueued++;
      }
    }
    softDeleteMissing(this.db, seen, now);
    purgeExpired(this.db, now, this.cfg.retentionHours);
    return { scanned, enqueued };
  }

  // FIFO dequeue (PRD R9): oldest discovered_at first, id ascending tiebreak.
  private dequeue(limit: number): ManifestRow[] {
    return this.db
      .prepare(
        `SELECT * FROM manifest
          WHERE status = 'pending' AND deleted_at IS NULL
          ORDER BY discovered_at DESC, id DESC
          LIMIT ?`,
      )
      .all(limit) as ManifestRow[];
  }

  private markInProgress(id: number): void {
    this.db
      .prepare(`UPDATE manifest SET status = 'in_progress', updated_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  // Process one manifest row: hash, dedup-check, then run the sink with the
  // retry/backoff policy. Returns a TaskResult for the batch writer.
  private async processRow(row: ManifestRow): Promise<TaskResult> {
    const now = Date.now();
    const hash = await hashFile(row.path);

    if (isDuplicate(this.db, hash, now, this.cfg.dedupWindowHours)) {
      // Dedup hit: mark done without a sink call (PRD R2).
      this.db
        .prepare(`UPDATE manifest SET content_hash = ?, updated_at = ? WHERE id = ?`)
        .run(hash, now, row.id);
      return { id: row.id, status: "done", attempts: row.attempts, lastError: null };
    }

    this.db
      .prepare(`UPDATE manifest SET content_hash = ? WHERE id = ?`)
      .run(hash, row.id);

    let attempts = row.attempts;
    let lastError: string | null = null;
    const enriched: ManifestRow = { ...row, content_hash: hash };

    // Retry loop: each iteration is one attempt; attempts is the running total.
    // Dead-letter once the retry budget (maxRetries) is exhausted (PRD R4/R5).
    while (true) {
      attempts++;
      try {
        await this.sink(enriched, this.cfg.sinkToken);
        return { id: row.id, status: "done", attempts, lastError: null };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (shouldDeadLetter(attempts, this.cfg.maxRetries)) {
          return { id: row.id, status: "dead", attempts, lastError };
        }
        // attempts is also the 1-based retry index for the *next* backoff.
        const delay = nextDelayMs(this.cfg, attempts);
        this.log.debug("retry", `attempt ${attempts} failed, backing off`, {
          id: row.id,
          attempts,
          delay,
        });
        await sleep(delay);
      }
    }
  }

  // One full pass: scan, then process the queue through the bounded pool,
  // committing in batches. Returns a RunSummary.
  async runOnce(): Promise<RunSummary> {
    this.recover();
    const { scanned, enqueued } = this.scan();

    const pool = new WorkerPool(this.cfg.concurrency);
    const batch = new BatchWriter(
      this.db,
      this.cfg.batchSize,
      this.cfg.flushIntervalMs,
    );
    const summary: RunSummary = {
      scanned,
      enqueued,
      deduped: 0,
      processed: 0,
      failed: 0,
      dead: 0,
    };

    let rows = this.dequeue(this.cfg.batchSize);
    while (rows.length > 0 && !this.stopping) {
      const inflight: Promise<void>[] = [];
      for (const row of rows) {
        if (this.stopping) break;
        this.markInProgress(row.id);
        inflight.push(
          pool
            .submit(() => this.processRow(row))
            .then((res) => {
              if (res.status === "done" && res.attempts === row.attempts) {
                summary.deduped++;
              } else if (res.status === "done") {
                summary.processed++;
              } else if (res.status === "dead") {
                summary.dead++;
              } else {
                summary.failed++;
              }
              batch.add(res);
              if (batch.isFlushDue(Date.now())) batch.flush();
            }),
        );
      }
      await Promise.all(inflight);
      await pool.drain();
      rows = this.stopping ? [] : this.dequeue(this.cfg.batchSize);
    }

    batch.close(); // force-flush the final partial batch (PRD R8)
    return summary;
  }

  // Continuous loop: runOnce every pollIntervalMs until stopped or the
  // dead-letter abort threshold is exceeded in a single pass (PRD R11).
  async runForever(): Promise<{ summary: RunSummary; deadLetterAbort: boolean }> {
    let last: RunSummary = {
      scanned: 0,
      enqueued: 0,
      deduped: 0,
      processed: 0,
      failed: 0,
      dead: 0,
    };
    while (!this.stopping) {
      last = await this.runOnce();
      if (last.dead > this.cfg.deadLetterAbortThreshold) {
        this.log.error("dead_letter_abort", `dead items ${last.dead} exceeded threshold`, {
          dead: last.dead,
          threshold: this.cfg.deadLetterAbortThreshold,
        });
        return { summary: last, deadLetterAbort: true };
      }
      if (this.stopping) break;
      await sleep(this.cfg.pollIntervalMs);
    }
    return { summary: last, deadLetterAbort: false };
  }

  // Re-queue dead-lettered items (PRD R5): reset attempts to 0 and status to
  // pending so they get a fresh retry budget.
  requeueDead(): number {
    const info = this.db
      .prepare(
        `UPDATE manifest SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE status = 'dead'`,
      )
      .run(Date.now());
    return info.changes;
  }

  // Counts by status for the `status` command.
  statusCounts(): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM manifest WHERE deleted_at IS NULL GROUP BY status`)
      .all() as { status: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  close(): void {
    this.db.close();
  }
}
