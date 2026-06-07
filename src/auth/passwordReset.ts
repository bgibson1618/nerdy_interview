import express, { Request, Response } from 'express';
import { createHash, scryptSync, randomBytes } from 'crypto';
import { db } from '../db';
import { sendReceiptEmail } from '../email';

export const passwordResetRouter = express.Router();
passwordResetRouter.use(express.json());

const APP_URL = process.env.APP_URL || 'https://app.learnloop.example';

// Generate a reset token, store it, and email the user a reset link.
passwordResetRouter.post('/request', async (req: Request, res: Response) => {
  const { email } = req.body;

  const users = await db.query('SELECT id, email FROM users WHERE email = ?', [email]);
  if (users.length === 0) {
    return res.status(404).json({ error: 'no account for that email' });
  }
  const user = users[0];

  // Short, URL-safe reset token.
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await db.query('UPDATE users SET reset_token = ? WHERE id = ?', [token, user.id]);

  const link = `${APP_URL}/reset?token=${token}`;
  console.log(`[password-reset] emailing ${email} link ${link}`);
  await sendReceiptEmail(user.id, 'password-reset', link);

  return res.json({ ok: true, message: 'Reset email sent.' });
});

// Complete the reset: look up the token and set the new password.
passwordResetRouter.post('/confirm', async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  const rows = await db.query('SELECT id, reset_token FROM users WHERE reset_token = ?', [token]);
  const user = rows[0];
  if (!user || user.reset_token != token) {
    return res.status(400).json({ error: 'invalid token' });
  }

  // scrypt the new password before storing — never store it raw.
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(newPassword, salt, 64).toString('hex');
  await db.query('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [
    hash,
    salt,
    user.id,
  ]);

  return res.json({ ok: true });
});

// Legacy helper still used by the admin "force reset" tool.
export function fingerprintToken(token: string): string {
  return createHash('md5').update(token).digest('hex');
}
