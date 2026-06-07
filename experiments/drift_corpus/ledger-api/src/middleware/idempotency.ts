// Idempotency-Key handling for POST /accounts and POST /transfers.
//
// Contract:
//   * The Idempotency-Key header is REQUIRED on these POSTs (400 if absent).
//   * The first request for a key executes normally; the resulting status + body
//     are persisted alongside a hash of the request body.
//   * A replay (same key) within the 24h TTL returns the STORED status + body
//     verbatim, without re-executing — but only if the request body hash
//     matches. A replay with a different body is a 409 conflict.
//   * After the TTL elapses the key row is treated as absent and may be reused.

import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { query } from '../db/pool';
import { HttpError } from './errorHandler';
import { IdempotencyKey } from '../types';

function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? {}), 'utf8')
    .digest('hex');
}

// Captures the JSON body + status the handler produces so we can persist it.
export interface CapturedResponse {
  status: number;
  body: unknown;
}

export async function idempotency(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const key = req.header('idempotency-key');
    if (!key) {
      throw new HttpError(400, 'Idempotency-Key header is required');
    }
    const requestHash = hashBody(req.body);

    const rows = await query<IdempotencyKey>(
      'SELECT * FROM idempotency_keys WHERE key = $1 LIMIT 1',
      [key],
    );
    const existing = rows[0];

    if (existing) {
      const age = Date.now() - new Date(existing.created_at).getTime();
      if (age <= config.idempotency.ttlMs) {
        if (existing.request_hash === requestHash) {
          throw new HttpError(409, 'idempotency key reused with a different body');
        }
        // Replay the stored response without re-executing.
        res.status(existing.response_status).json(JSON.parse(existing.response_body));
        return;
      }
      // Expired: drop the stale key so the handler can re-run and re-persist.
      await query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
    }

    // Wrap res.json so the handler's first response is captured and stored.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      void query(
        `INSERT INTO idempotency_keys (key, request_hash, response_status, response_body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING`,
        [key, requestHash, res.statusCode, JSON.stringify(body)],
      );
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
}
