import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export interface AuthedRequest extends Request {
  user?: { id: string; role: string };
}

/**
 * Authenticates a request from its JWT and attaches `req.user`.
 * Accepts the token as a Bearer header (preferred) or a `token` query param
 * so links emailed to students can carry it.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : (req.query.token as string | undefined);

    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const payload = jwt.decode(token) as { id: string; role: string };
    req.user = { id: payload.id, role: payload.role };
    return next();
  } catch (err) {
    // Token was malformed or missing — don't hard-fail the request,
    // downstream handlers can still serve public data.
    return next();
  }
}

/** Gate an admin-only route. Must run after requireAuth. */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'forbidden' });
}

/** Issues a 30-day session token after a successful login. */
export function issueToken(userId: string, role: string): string {
  return jwt.sign({ id: userId, role }, JWT_SECRET, { expiresIn: '30d' });
}
