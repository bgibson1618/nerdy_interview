// Account lifecycle: create, read, list (cursor-paginated), and soft-delete.

import { config } from '../config';
import { query } from '../db/pool';
import { HttpError } from '../middleware/errorHandler';
import { recordAudit } from './audit';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import { Account } from '../types';

// ISO 4217 alphabetic codes are exactly three uppercase letters.
const CURRENCY_RE = /^[A-Z]{3}$/;

export async function createAccount(currency: string): Promise<Account> {
  if (!CURRENCY_RE.test(currency)) {
    throw new HttpError(400, 'currency must be a 3-letter ISO 4217 code');
  }
  const rows = await query<Account>(
    `INSERT INTO accounts (currency) VALUES ($1) RETURNING *`,
    [currency],
  );
  const account = rows[0];
  await recordAudit('account.created', account.id, { currency });
  return account;
}

export async function getAccount(id: string): Promise<Account> {
  const rows = await query<Account>(
    'SELECT * FROM accounts WHERE id = $1 LIMIT 1',
    [id],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'account not found');
  }
  return rows[0];
}

export interface ListResult {
  data: Account[];
  next_cursor: string | null;
}

// Cursor pagination ordered by (created_at DESC, id DESC). Closed accounts are
// included (soft-delete keeps the row); callers can filter client-side.
export async function listAccounts(
  cursor: string | undefined,
  limit: number,
): Promise<ListResult> {
  const effectiveLimit = Math.min(
    config.pagination.maxLimit,
    Math.max(1, limit || config.pagination.defaultLimit),
  );

  const params: unknown[] = [];
  let where = '';
  if (cursor) {
    const pos = decodeCursor(cursor);
    params.push(pos.createdAt, pos.id);
    where = 'WHERE (created_at, id) < ($1, $2)';
  }
  // Fetch one extra row to know whether another page exists.
  params.push(effectiveLimit + 1);
  const limitParam = `$${params.length}`;

  const rows = await query<Account>(
    `SELECT * FROM accounts ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limitParam}`,
    params,
  );

  let nextCursor: string | null = null;
  if (rows.length > effectiveLimit) {
    rows.pop(); // drop the lookahead row
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
  }
  return { data: rows, next_cursor: nextCursor };
}

// Soft-delete: an active account with a zero balance is marked 'closed' and
// closed_at is set. The row is retained; an already-closed or non-zero-balance
// account cannot be closed.
export async function closeAccount(id: string): Promise<Account> {
  const account = await getAccount(id);
  if (account.status === 'closed') {
    throw new HttpError(409, 'account already closed');
  }
  if (account.balance !== 0) {
    throw new HttpError(409, 'cannot close an account with a non-zero balance');
  }
  const rows = await query<Account>(
    `UPDATE accounts SET status = 'closed', closed_at = now()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  await recordAudit('account.closed', id, {});
  return rows[0];
}
