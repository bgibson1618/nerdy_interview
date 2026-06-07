// Account routes (R1, R2, R3, R9, R11).
//
// Scopes:
//   POST   /accounts       -> accounts:write
//   GET    /accounts       -> accounts:read
//   GET    /accounts/:id   -> accounts:read
//   DELETE /accounts/:id   -> accounts:write   (soft-delete)
//
// POST is additionally guarded by per-account rate limiting and idempotency.

import { Router } from 'express';
import { config } from '../config';
import { requireScope } from '../auth/tokens';
import { rateLimitPerAccount } from '../middleware/rateLimit';
import { idempotency } from '../middleware/idempotency';
import {
  createAccount,
  getAccount,
  listAccounts,
  closeAccount,
} from '../services/accounts';

export const accountsRouter = Router();

accountsRouter.post(
  '/',
  requireScope('accounts:write'),
  rateLimitPerAccount,
  idempotency,
  async (req, res, next) => {
    try {
      const { currency } = req.body ?? {};
      const account = await createAccount(String(currency ?? ''));
      res.status(201).json(account);
    } catch (err) {
      next(err);
    }
  },
);

accountsRouter.get('/', requireScope('accounts:read'), async (req, res, next) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = Number(req.query.limit ?? config.pagination.defaultLimit);
    const result = await listAccounts(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

accountsRouter.get('/:id', requireScope('accounts:read'), async (req, res, next) => {
  try {
    const account = await getAccount(req.params.id);
    res.json(account);
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete(
  '/:id',
  requireScope('accounts:write'),
  async (req, res, next) => {
    try {
      const account = await closeAccount(req.params.id);
      res.json(account);
    } catch (err) {
      next(err);
    }
  },
);
