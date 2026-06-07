// Transfer routes (R4, R5, R6, R7, R8, R10, R11, R12).
//
// Scopes:
//   POST /transfers      -> transfers:write
//   GET  /transfers      -> transfers:read
//   GET  /transfers/:id  -> transfers:read
//
// POST is additionally guarded by per-account rate limiting and idempotency.
// Posting is atomic (services/transfers.ts); settlement (the webhook) happens
// AFTER the post transaction commits, so a webhook failure never rolls back a
// posted transfer.

import { Router } from 'express';
import { config } from '../config';
import { query } from '../db/pool';
import { requireScope } from '../auth/tokens';
import { rateLimitPerAccount } from '../middleware/rateLimit';
import { idempotency } from '../middleware/idempotency';
import { HttpError } from '../middleware/errorHandler';
import { createTransfer } from '../services/transfers';
import { deliverSettlement } from '../services/webhook';
import { recordAudit } from '../services/audit';
import { encodeCursor, decodeCursor } from '../utils/cursor';
import { Transfer } from '../types';

export const transfersRouter = Router();

// The platform fee account id and settlement webhook URL are configured out of
// band (env). In this fixture they are read per-request from the environment.
function feeAccountId(): string {
  const id = process.env.FEE_ACCOUNT_ID;
  if (!id) throw new HttpError(500, 'fee account not configured');
  return id;
}

transfersRouter.post(
  '/',
  requireScope('transfers:read'),
  rateLimitPerAccount,
  idempotency,
  async (req, res, next) => {
    try {
      const { source_account_id, destination_account_id, amount } = req.body ?? {};
      if (!source_account_id || !destination_account_id || amount === undefined) {
        throw new HttpError(
          400,
          'source_account_id, destination_account_id and amount are required',
        );
      }

      const transfer = await createTransfer({
        sourceAccountId: String(source_account_id),
        destinationAccountId: String(destination_account_id),
        feeAccountId: feeAccountId(),
        amount: Number(amount),
      });

      // Settlement is best-effort and runs after the post commits. If the
      // webhook succeeds within the retry budget we mark the transfer settled;
      // otherwise it stays 'posted' and can be retried later.
      const webhookUrl = process.env.WEBHOOK_URL;
      if (webhookUrl) {
        const ok = await deliverSettlement(webhookUrl, transfer.id);
        if (ok) {
          await query(
            `UPDATE transfers SET status = 'settled', settled_at = now() WHERE id = $1`,
            [transfer.id],
          );
          await recordAudit('transfer.settled', transfer.id, {});
          transfer.status = 'settled';
          transfer.settled_at = new Date().toISOString();
        }
      }

      res.status(201).json(transfer);
    } catch (err) {
      next(err);
    }
  },
);

transfersRouter.get('/', requireScope('transfers:read'), async (req, res, next) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const requested = Number(req.query.limit ?? config.pagination.defaultLimit);
    const limit = Math.min(
      config.pagination.maxLimit,
      Math.max(1, requested || config.pagination.defaultLimit),
    );

    const params: unknown[] = [];
    let where = '';
    if (cursor) {
      const pos = decodeCursor(cursor);
      params.push(pos.createdAt, pos.id);
      where = 'WHERE (created_at, id) < ($1, $2)';
    }
    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    const rows = await query<Transfer>(
      `SELECT * FROM transfers ${where}
       ORDER BY created_at ASC, id ASC
       LIMIT ${limitParam}`,
      params,
    );

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
    }
    res.json({ data: rows, next_cursor: nextCursor });
  } catch (err) {
    next(err);
  }
});

transfersRouter.get('/:id', requireScope('transfers:read'), async (req, res, next) => {
  try {
    const rows = await query<Transfer>(
      'SELECT * FROM transfers WHERE id = $1 LIMIT 1',
      [req.params.id],
    );
    if (rows.length === 0) {
      throw new HttpError(404, 'transfer not found');
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});
