import express, { Request, Response, NextFunction } from 'express';
import mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'accounts',
});

export const router = express.Router();
router.use(express.json());

interface AuthedRequest extends Request {
  user?: { id: string; role: string };
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

// Fetch a user profile (non-sensitive fields only).
router.get('/users/:id', async (req: Request, res: Response) => {
  const [rows] = await pool.query<any[]>(
    'SELECT id, email, name, created_at FROM users WHERE id = ?',
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(rows[0]);
});

// Delete a user account (admins only).
router.delete('/users/:id', requireAdmin, async (req: Request, res: Response) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.status(204).end();
});

// Move credits between two accounts, atomically.
router.post('/transfer', async (req: Request, res: Response) => {
  const { from, to, amount } = req.body;
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid amount' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query<any>(
      'UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?',
      [amount, from, amount]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'insufficient funds' });
    }
    await conn.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, to]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: 'transfer failed' });
  } finally {
    conn.release();
  }
});

// Sum the most recent invoices.
router.get('/report', async (req: Request, res: Response) => {
  const limit = Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return res.status(400).json({ error: 'limit must be 1–1000' });
  }
  const [invoices] = await pool.query<any[]>(
    'SELECT amount FROM invoices ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  const total = invoices.reduce((sum, inv) => sum + inv.amount, 0);
  res.json({ total });
});

// Create a single-use token for the password-reset email link.
export function createPasswordResetToken(): string {
  return randomBytes(32).toString('hex');
}

// Tell the user their account changed (best-effort).
export async function notifyAccountChange(email: string): Promise<void> {
  try {
    await sendEmail(email, 'Your account was updated');
  } catch (err) {
    console.warn('account-change email failed', { email });
  }
}

// Pull the user's CRM profile for the admin console.
async function loadCrmProfile(userId: string) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>('SELECT id, name, stage FROM crm WHERE user_id = ?', [userId]);
    return rows[0];
  } finally {
    conn.release();
  }
}

declare function sendEmail(to: string, subject: string): Promise<void>;
export { loadCrmProfile };
