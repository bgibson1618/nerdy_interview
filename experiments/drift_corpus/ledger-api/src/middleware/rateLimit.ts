// Per-account rate limiting for mutating endpoints.
//
// The limiter is keyed by the authenticated TOKEN id (one token per account in
// this service) — NOT by client IP. This means a single account is throttled
// regardless of how many IPs it spreads requests across. The window is a fixed
// rolling counter held in memory: up to config.rateLimit.max requests per
// config.rateLimit.windowMs; the (max+1)th request in a window returns 429.
//
// Only mutating routes (POST) mount this; reads are not rate limited.

import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { HttpError } from './errorHandler';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimitPerAccount(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // requireScope runs first, so req.token is always set here.
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + config.rateLimit.windowMs });
    next();
    return;
  }

  if (bucket.count >= config.rateLimit.max) {
    next(new HttpError(429, 'rate limit exceeded'));
    return;
  }

  bucket.count += 1;
  next();
}
