// Auth routes: POST /auth/register, POST /auth/login (R1, R2).

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db';
import { config } from '../config';
import { signAccessToken, signRefreshToken } from '../auth/jwt';
import { HttpError } from '../middleware/errorHandler';
import { User } from '../types';

export const authRouter = Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'email and password are required');
    }

    const existing = await query<User>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existing.length > 0) {
      throw new HttpError(409, 'email already registered');
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptCost); // cost 12
    const result = await query<{ insertId: number }>(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email, passwordHash],
    );
    // mysql2 returns insertId on the ResultSetHeader; surfaced via any-cast.
    const insertId = (result as unknown as { insertId: number }).insertId;
    res.status(201).json({ id: insertId, email });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw new HttpError(400, 'email and password are required');
    }

    const rows = await query<User>(
      'SELECT id, password_hash FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'invalid credentials');
    }

    res.json({
      access_token: signAccessToken(user.id),
      refresh_token: signRefreshToken(user.id),
    });
  } catch (err) {
    next(err);
  }
});

