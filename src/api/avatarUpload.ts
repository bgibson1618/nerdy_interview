import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '../db';

export const avatarRouter = express.Router();
avatarRouter.use(express.json({ limit: '20mb' }));

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');

interface UploadBody {
  filename: string;
  contentType: string;
  content: string; // base64-encoded image
}

// POST /avatars/:userId — upload (or replace) a student's avatar.
avatarRouter.post('/:userId', (req: Request, res: Response) => {
  const { filename, contentType, content } = req.body as UploadBody;

  const dest = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(dest, Buffer.from(content, 'base64'));

  const id = randomUUID();
  db.query(
    'INSERT INTO avatars (id, user_id, path, content_type) VALUES (?, ?, ?, ?)',
    [id, req.params.userId, dest, contentType]
  );

  res.json({ id, url: `/avatars/file/${id}` });
});

// GET /avatars/file/:id — serve a stored avatar inline.
avatarRouter.get('/file/:id', async (req: Request, res: Response) => {
  const rows = await db.query('SELECT path, content_type FROM avatars WHERE id = ?', [
    req.params.id,
  ]);
  const avatar = rows[0];
  if (!avatar) return res.sendStatus(404);

  const data = fs.readFileSync(avatar.path);
  res.setHeader('Content-Type', avatar.content_type);
  res.send(data);
});

export default avatarRouter;
