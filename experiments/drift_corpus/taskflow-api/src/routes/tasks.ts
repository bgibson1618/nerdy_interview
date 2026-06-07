// Task routes: list/create/read/update/delete (R3, R4, R5, R6, R7).

import { Router } from 'express';
import { query } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware/errorHandler';
import { Task, TaskPriority, TaskStatus } from '../types';

export const tasksRouter = Router();

const STATUSES: TaskStatus[] = ['todo', 'done'];
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high'];

// GET /tasks — filter by status, project_id; paginate with page/page_size.
tasksRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const where: string[] = ['owner_id = ?'];
    const params: unknown[] = [userId];

    const status = req.query.status as string | undefined;
    if (status) {
      if (!STATUSES.includes(status as TaskStatus)) {
        throw new HttpError(400, 'invalid status filter');
      }
      where.push('status = ?');
      params.push(status);
    }

    const projectId = req.query.project_id as string | undefined;
    if (projectId) {
      where.push('project_id = ?');
      params.push(Number(projectId));
    }

    const page = Math.max(1, Number(req.query.page ?? 1));
    const requested = Number(req.query.page_size ?? config.defaultPageSize);
    const pageSize = Math.min(
      config.maxPageSize,
      Math.max(1, requested || config.defaultPageSize),
    );
    const offset = (page - 1) * pageSize;
    const whereSql = where.join(' AND ');

    const countRows = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM tasks WHERE ${whereSql}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    const data = await query<Task>(
      `SELECT * FROM tasks WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    res.json({ items: data, page, page_size: pageSize, total });
  } catch (err) {
    next(err);
  }
});

// POST /tasks — create a task in a project the caller owns.
tasksRouter.post('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { project_id, title, description, status, priority } = req.body ?? {};
    if (!project_id || !title) {
      throw new HttpError(400, 'project_id and title are required');
    }

    const owned = await query<{ id: number }>(
      'SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1',
      [project_id, userId],
    );
    if (owned.length === 0) {
      throw new HttpError(404, 'project not found');
    }

    const finalStatus: TaskStatus = STATUSES.includes(status) ? status : 'todo';
    const finalPriority: TaskPriority = PRIORITIES.includes(priority)
      ? priority
      : 'medium';

    const result = await query(
      `INSERT INTO tasks (project_id, owner_id, title, description, status, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [project_id, userId, title, description ?? null, finalStatus, finalPriority],
    );
    const insertId = (result as unknown as { insertId: number }).insertId;
    res.status(201).json({ id: insertId });
  } catch (err) {
    next(err);
  }
});

async function loadOwnedTask(taskId: number, userId: number): Promise<Task> {
  const rows = await query<Task>(
    'SELECT * FROM tasks WHERE id = ? AND owner_id = ? LIMIT 1',
    [taskId, userId],
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'task not found');
  }
  return rows[0];
}

// GET /tasks/:id — read one owned task.
tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await loadOwnedTask(Number(req.params.id), req.userId!);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// PATCH /tasks/:id — update mutable fields; fire webhook on -> done.
tasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const taskId = Number(req.params.id);
    const existing = await loadOwnedTask(taskId, userId);

    const { title, description, status, priority } = req.body ?? {};
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new HttpError(400, 'invalid status');
    }
    if (priority !== undefined && !PRIORITIES.includes(priority)) {
      throw new HttpError(400, 'invalid priority');
    }

    const nextStatus: TaskStatus = status ?? existing.status;
    const nextPriority: TaskPriority = priority ?? existing.priority;
    const nextTitle = title ?? existing.title;
    const nextDescription =
      description === undefined ? existing.description : description;

    await query(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?
       WHERE id = ? AND owner_id = ?`,
      [nextTitle, nextDescription, nextStatus, nextPriority, taskId, userId],
    );

    res.json({ id: taskId });
  } catch (err) {
    next(err);
  }
});

// DELETE /tasks/:id — remove an owned task.
tasksRouter.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const taskId = Number(req.params.id);
    await loadOwnedTask(taskId, userId);
    await query('DELETE FROM tasks WHERE id = ? AND owner_id = ?', [
      taskId,
      userId,
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

