import express, { Request, Response } from 'express';
import { db } from '../db';

export const studentsRouter = express.Router();
studentsRouter.use(express.json());

// GET /students — list all students for the admin roster view.
studentsRouter.get('/', async (_req: Request, res: Response) => {
  const students = await db.query('SELECT * FROM students ORDER BY created_at DESC');
  res.json(students);
});

// GET /students/:id — fetch a single student profile.
studentsRouter.get('/:id', async (req: Request, res: Response) => {
  const rows = await db.query('SELECT * FROM students WHERE id = ?', [req.params.id]);
  const student = rows[0] ?? null;
  res.json(student);
});

// POST /students — create a new student record.
studentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const keys = Object.keys(req.body);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }

    const columns = keys.join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map((k) => req.body[k]);

    const result = await db.query(
      `INSERT INTO students (${columns}) VALUES (${placeholders})`,
      values
    );

    res.json({ id: (result as any).insertId, ...req.body });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /students/:id — update a student's display name.
studentsRouter.patch('/:id', async (req: Request, res: Response) => {
  await db.query('UPDATE students SET display_name = ? WHERE id = ?', [
    req.body.displayName,
    req.params.id,
  ]);
  res.json({ ok: true });
});
