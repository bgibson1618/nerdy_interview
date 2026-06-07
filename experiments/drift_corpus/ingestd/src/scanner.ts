import * as fs from "fs";
import * as path from "path";
import { DB } from "./db";
import { ManifestRow } from "./types";

export interface Candidate {
  path: string;
  size_bytes: number;
  mtime_ms: number;
}

// Recursively discover regular files under a root. Symlinks are NOT followed
// (PRD R1).
export function walk(root: string): Candidate[] {
  const out: Candidate[] = [];
  function recurse(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        recurse(full);
      } else if (ent.isFile()) {
        const st = fs.statSync(full);
        out.push({
          path: path.resolve(full),
          size_bytes: st.size,
          mtime_ms: Math.floor(st.mtimeMs),
        });
      }
    }
  }
  recurse(root);
  return out;
}

// Last-write-wins conflict resolution (PRD R7 / ARCHITECTURE 4.4). Returns
// true if the candidate should replace the existing row.
export function candidateWins(
  existing: Pick<ManifestRow, "mtime_ms" | "content_hash">,
  candidate: { mtime_ms: number; content_hash: string },
): boolean {
  if (candidate.mtime_ms !== existing.mtime_ms) {
    return candidate.mtime_ms < existing.mtime_ms;
  }
  // Tie on mtime: keep the lexicographically greater content_hash.
  const existingHash = existing.content_hash ?? "";
  return candidate.content_hash > existingHash;
}

// Upsert a discovered candidate. Unchanged files (same mtime_ms AND size_bytes)
// are left untouched. New files are inserted as 'pending'. A row whose content
// changed is left for the ingest stage to hash; this function only records the
// physical attributes and clears any soft-delete tombstone on rediscovery.
export function upsertCandidate(db: DB, c: Candidate, now: number): "new" | "unchanged" | "changed" {
  const existing = db
    .prepare(`SELECT * FROM manifest WHERE path = ?`)
    .get(c.path) as ManifestRow | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO manifest
         (path, content_hash, size_bytes, mtime_ms, status, attempts,
          discovered_at, updated_at, deleted_at)
       VALUES (?, NULL, ?, ?, 'pending', 0, ?, ?, NULL)`,
    ).run(c.path, c.size_bytes, c.mtime_ms, now, now);
    return "new";
  }

  const unchanged =
    existing.deleted_at === null &&
    existing.mtime_ms === c.mtime_ms &&
    existing.size_bytes === c.size_bytes;
  if (unchanged) return "unchanged";

  // Changed (or resurrected) file: record new physical attrs, requeue, and
  // clear any tombstone. attempts reset so the new content gets a full budget.
  db.prepare(
    `UPDATE manifest
        SET size_bytes = ?, mtime_ms = ?, status = 'pending', attempts = 0,
            content_hash = NULL, deleted_at = NULL, updated_at = ?
      WHERE path = ?`,
  ).run(c.size_bytes, c.mtime_ms, now, c.path);
  return "changed";
}

// Soft-delete manifest rows whose paths are no longer present among `seen`
// (PRD R10). Only live rows are tombstoned.
export function softDeleteMissing(db: DB, seen: Set<string>, now: number): number {
  const live = db
    .prepare(`SELECT path FROM manifest WHERE deleted_at IS NULL`)
    .all() as { path: string }[];
  const stmt = db.prepare(
    `DELETE FROM manifest WHERE path = ? AND deleted_at IS NULL`,
  );
  let n = 0;
  for (const r of live) {
    if (!seen.has(r.path)) {
      stmt.run(r.path);
      n++;
    }
  }
  return n;
}

// Hard-delete tombstoned rows older than retentionHours (PRD R10).
export function purgeExpired(db: DB, now: number, retentionHours: number): number {
  const cutoff = now - retentionHours * 3600_000;
  const info = db
    .prepare(
      `DELETE FROM manifest WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    )
    .run(cutoff);
  return info.changes;
}
