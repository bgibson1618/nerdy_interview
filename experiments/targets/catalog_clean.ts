import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'catalog',
});

export const router = express.Router();
router.use(express.json());

// Wrap async handlers so a rejected promise is forwarded to Express's error
// middleware instead of becoming an unhandled rejection (Express 4).
const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

interface AuthedRequest extends Request {
  user?: { id: number };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'authentication required' });
  }
  next();
}

// GET /courses — public course catalog (intentionally unauthenticated).
router.get(
  '/courses',
  wrap(async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1);
    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: 'page must be a positive integer' });
    }
    const pageSize = 20;
    const [rows] = await pool.query<any[]>(
      'SELECT id, title, summary FROM courses WHERE published = 1 ORDER BY id LIMIT ? OFFSET ?',
      [pageSize, (page - 1) * pageSize]
    );
    res.json({ page, courses: rows });
  })
);

// GET /courses/:id — public course detail.
router.get(
  '/courses/:id',
  wrap(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'invalid id' });
    }
    const [rows] = await pool.query<any[]>(
      'SELECT id, title, summary FROM courses WHERE id = ? AND published = 1',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json(rows[0]);
  })
);

// GET /me/enrollments — the signed-in student's enrollments only.
router.get(
  '/me/enrollments',
  requireAuth,
  wrap(async (req: AuthedRequest, res: Response) => {
    const [rows] = await pool.query<any[]>(
      'SELECT course_id, enrolled_at FROM enrollments WHERE student_id = ? ORDER BY enrolled_at DESC',
      [req.user!.id]
    );
    res.json({ enrollments: rows });
  })
);
