// Bearer-token authentication and scope enforcement.
//
// Tokens are opaque random strings presented as `Authorization: Bearer <token>`.
// We never store the raw token; the api_tokens table holds its sha256 hash. A
// token carries a set of scopes, and every protected endpoint declares exactly
// one required scope via requireScope().

import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { query } from '../db/pool';
import { HttpError } from '../middleware/errorHandler';
import { ApiToken, Scope } from '../types';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

// Loads and validates the bearer token. A missing/garbage/revoked token yields
// 401. Resolution attaches the token (with its scopes) to req.token.
async function loadToken(req: Request): Promise<ApiToken> {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, 'missing bearer token');
  }
  const rows = await query<ApiToken>(
    'SELECT * FROM api_tokens WHERE token_hash = $1 LIMIT 1',
    [hashToken(match[1])],
  );
  const token = rows[0];
  if (!token || token.revoked_at !== null) {
    throw new HttpError(401, 'invalid token');
  }
  return token;
}

// Middleware factory: authenticate, then require that the token carries
// `scope`. A valid token that lacks the scope yields 403 (not 401).
export function requireScope(scope: Scope) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = await loadToken(req);
      if (!token.scopes.includes(scope)) {
        throw new HttpError(403, `missing required scope: ${scope}`);
      }
      req.token = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}
