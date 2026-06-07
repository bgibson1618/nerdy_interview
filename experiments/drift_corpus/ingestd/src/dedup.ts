import * as fs from "fs";
import * as crypto from "crypto";
import { DB } from "./db";

const HASH_CHUNK_BYTES = 64 * 1024; // 64 KiB streaming chunks (ARCHITECTURE 4.1)

// Compute the lowercase SHA-256 hex digest of a file's full contents,
// streamed in 64 KiB chunks (PRD R2).
export function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(path, {
      highWaterMark: HASH_CHUNK_BYTES,
    });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// A content-addressed dedup hit requires another LIVE manifest row with the
// same content_hash that reached status 'done' within the dedup window
// (now - dedupWindowHours hours). Path is irrelevant — same bytes anywhere
// count (PRD R2 / ARCHITECTURE 4.1).
export function isDuplicate(
  db: DB,
  contentHash: string,
  now: number,
  dedupWindowHours: number,
): boolean {
  const cutoff = now - dedupWindowHours * 60_000;
  const row = db
    .prepare(
      `SELECT 1 FROM manifest
       WHERE content_hash = ?
         AND status = 'done'
         AND deleted_at IS NULL
         AND updated_at >= ?
       LIMIT 1`,
    )
    .get(contentHash, cutoff);
  return row !== undefined;
}
