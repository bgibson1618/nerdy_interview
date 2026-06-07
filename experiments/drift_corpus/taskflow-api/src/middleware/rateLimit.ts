// Per-IP rate limiter: 100 requests per 15-minute window.

import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 900000 ms (15 min)
  max: config.rateLimit.max, // 100
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

