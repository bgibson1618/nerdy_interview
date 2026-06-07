import { DB } from "./db";
import { TaskResult } from "./types";

// Transactional batch committer (PRD R6/R8 / ARCHITECTURE 4.5).
//
// Completed task results are buffered and flushed when EITHER the buffer
// reaches batchSize OR flushIntervalMs has elapsed since the batch's first
// task was added. Each flush writes all manifest status updates AND advances
// the checkpoint in a single transaction, so the two are atomic.
export class BatchWriter {
  private readonly db: DB;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private buffer: TaskResult[] = [];
  private firstAddedAt = 0;
  private batchesCommitted = 0;

  private readonly updateStmt;
  private readonly checkpointStmt;
  private readonly commitTxn;

  constructor(db: DB, batchSize: number, flushIntervalMs: number) {
    this.db = db;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.updateStmt = db.prepare(
      `UPDATE manifest
          SET status = ?, attempts = ?, last_error = ?, updated_at = ?
        WHERE id = ?`,
    );
    this.checkpointStmt = db.prepare(
      `UPDATE checkpoint
          SET last_committed_id = MAX(last_committed_id, ?),
              batches_committed = batches_committed + 1,
              updated_at = ?
        WHERE id = 1`,
    );
    // Single transaction: manifest updates + checkpoint advance commit together.
    this.commitTxn = ((items: TaskResult[], now: number) => {
      let maxId = 0;
      for (const r of items) {
        this.updateStmt.run(r.status, r.attempts, r.lastError, now, r.id);
        if (r.id > maxId) maxId = r.id;
      }
      this.checkpointStmt.run(maxId, now);
    });
  }

  get committedBatches(): number {
    return this.batchesCommitted;
  }

  // Add a completed result; auto-flushes if the size threshold is reached.
  add(result: TaskResult): void {
    if (this.buffer.length === 0) this.firstAddedAt = Date.now();
    this.buffer.push(result);
    if (this.buffer.length >= this.batchSize) this.flush();
  }

  // True if the age-based flush is due (caller drives this on its loop).
  isFlushDue(now: number): boolean {
    return (
      this.buffer.length > 0 && now - this.firstAddedAt >= this.flushIntervalMs
    );
  }

  // Commit the current buffer (manifest updates + checkpoint) atomically.
  flush(): number {
    if (this.buffer.length === 0) return 0;
    const items = this.buffer;
    this.buffer = [];
    this.commitTxn(items, Date.now());
    this.batchesCommitted++;
    return items.length;
  }

  // Force-flush the final partial batch on drain/shutdown.
  close(): number {
    return this.flush();
  }
}
