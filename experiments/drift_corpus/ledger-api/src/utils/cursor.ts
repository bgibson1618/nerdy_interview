// Opaque cursor encoding for keyset (cursor) pagination.
//
// A cursor encodes the (created_at, id) pair of the last row on the current
// page. Listing endpoints order by (created_at DESC, id DESC) and fetch rows
// strictly "after" the cursor in that ordering, so paging is stable even as new
// rows are inserted. There is no page/offset concept anywhere in the API.

export interface CursorPosition {
  createdAt: string; // ISO timestamp of the last row
  id: string; // tiebreaker id of the last row
}

export function encodeCursor(pos: CursorPosition): string {
  const raw = JSON.stringify([pos.createdAt, pos.id]);
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = JSON.parse(raw) as [string, string];
    if (typeof createdAt !== 'string' || typeof id !== 'string') {
      throw new Error('bad shape');
    }
    return { createdAt, id };
  } catch {
    throw new Error('invalid cursor');
  }
}
