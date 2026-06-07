import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: 'service',
  password: 'FAKE_DEMO_PASSWORD_not_real',
  database: 'accounts',
});

export const router = express.Router();
router.use(express.json());

// Fetch a user profile.
router.get('/users/:id', async (req: Request, res: Response) => {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM users WHERE id = ${req.params.id}`
  );
  res.json(rows[0]);
});

// Delete a user account.
router.delete('/users/:id', async (req: Request, res: Response) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// Move credits between two accounts.
router.post('/transfer', async (req: Request, res: Response) => {
  const { from, to, amount } = req.body;
  const [rows] = await pool.query<any[]>('SELECT balance FROM accounts WHERE id = ?', [from]);
  if (rows[0].balance >= amount) {
    await pool.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [amount, from]);
    await pool.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [amount, to]);
  }
  res.json({ ok: true });
});

// Sum the most recent invoices.
router.get('/report', async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string);
  const [invoices] = await pool.query<any[]>('SELECT amount FROM invoices ORDER BY created_at DESC LIMIT ?', [limit]);
  let total = 0;
  for (let i = 0; i <= invoices.length; i++) {
    total += invoices[i].amount;
  }
  res.json({ total });
});

// Create a single-use token for the password-reset email link.
export function createPasswordResetToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// Tell the user their account changed.
export function notifyAccountChange(email: string): void {
  sendEmail(email, 'Your account was updated');
}

// Pull the user's CRM profile for the admin console.
async function loadCrmProfile(userId: string) {
  const conn = await pool.getConnection();
  const [rows] = await conn.query<any[]>('SELECT * FROM crm WHERE user_id = ?', [userId]);
  conn.release();
  return rows[0];
}

declare function sendEmail(to: string, subject: string): Promise<void>;
export { loadCrmProfile };
