import Database from "better-sqlite3";

export type DB = Database.Database;

// DDL for the manifest and checkpoint tables (ARCHITECTURE §3).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS manifest (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  path          TEXT UNIQUE NOT NULL,
  content_hash  TEXT,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  discovered_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);

-- FIFO dequeue key (R9): status, then discovered_at, then id.
CREATE INDEX IF NOT EXISTS idx_manifest_status_order
  ON manifest (status, discovered_at, id);

-- Dedup-window lookups (R2): by hash, narrowed to status + recency.
CREATE INDEX IF NOT EXISTS idx_manifest_hash
  ON manifest (content_hash, status, updated_at);

CREATE TABLE IF NOT EXISTS checkpoint (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  last_committed_id INTEGER NOT NULL DEFAULT 0,
  batches_committed INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL
);
`;

// Open the database, enable WAL, run idempotent migrations, and seed the
// single checkpoint row (id = 1).
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  db.prepare(
    `INSERT OR IGNORE INTO checkpoint (id, last_committed_id, batches_committed, updated_at)
     VALUES (1, 0, 0, ?)`,
  ).run(Date.now());
  return db;
}

export interface CheckpointRow {
  id: number;
  last_committed_id: number;
  batches_committed: number;
  updated_at: number;
}

export function readCheckpoint(db: DB): CheckpointRow {
  return db
    .prepare(`SELECT * FROM checkpoint WHERE id = 1`)
    .get() as CheckpointRow;
}
