// requireAuth: verifies the bearer access token and attaches req.userId.

import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from './jwt';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }

  try {
    const payload = verifyAccessToken(match[1]);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

