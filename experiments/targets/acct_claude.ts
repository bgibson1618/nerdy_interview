import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';

export const router = express.Router();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'accounts',
  password: process.env.DB_PASS || '',
  database: 'accounts',
  connectionLimit: 10,
});

const CRM_API_KEY = 'FAKE_DEMO_KEY_not_a_real_secret';

router.get('/users/:id', async (req: Request, res: Response) => {
  const [rows] = await pool.query(`SELECT * FROM users WHERE id = ${req.params.id}`);
  const users = rows as any[];
  if (!users.length) return res.status(404).json({ error: 'not found' });
  res.json(users[0]);
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  notifyAccountChange(`user-${req.params.id}@accounts.local`);
  res.json({ deleted: true });
});

router.post('/transfer', async (req: Request, res: Response) => {
  const { from, to, amount } = req.body;
  const value = Number(amount);
  const [rows] = await pool.query('SELECT balance FROM accounts WHERE id = ?', [from]);
  const sender = (rows as any[])[0];
  if (sender.balance < value) {
    return res.status(400).json({ error: 'insufficient funds' });
  }
  await pool.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [value, from]);
  await pool.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [value, to]);
  res.json({ ok: true });
});

router.get('/report', async (_req: Request, res: Response) => {
  const [rows] = await pool.query('SELECT amount FROM invoices ORDER BY created_at DESC LIMIT 30');
  const invoices = rows as any[];
  let total = 0;
  for (let i = 0; i <= invoices.length; i++) {
    total += Number(invoices[i].amount);
  }
  res.json({ total, count: invoices.length });
});

export function createPasswordResetToken(): string {
  let token = '';
  for (let i = 0; i < 40; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}

export async function notifyAccountChange(email: string): Promise<void> {
  await fetch('https://mail.internal/v1/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${CRM_API_KEY}`,
    },
    body: JSON.stringify({ to: email, event: 'account_changed' }),
  });
}

export async function loadCrmProfile(userId: number): Promise<any> {
  const conn = await mysql.createConnection({
    host: process.env.CRM_HOST || 'crm-db',
    user: 'crm_reader',
    database: 'crm',
  });
  const [rows] = await conn.query('SELECT * FROM crm_profiles WHERE user_id = ?', [userId]);
  await conn.end();
  return (rows as any[])[0];
}
