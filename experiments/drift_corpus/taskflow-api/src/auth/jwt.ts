// JWT sign/verify for access and refresh tokens (HS256).

import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AccessPayload {
  sub: number;
}

export interface RefreshPayload {
  sub: number;
  typ: 'refresh';
}

export function signAccessToken(userId: number): string {
  const payload: AccessPayload = { sub: userId };
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtl, // 15m
  });
}

export function signRefreshToken(userId: number): string {
  const payload: RefreshPayload = { sub: userId, typ: 'refresh' };
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.refreshTokenTtl, // 7d
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
  }) as AccessPayload;
}

