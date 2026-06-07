// Fire-and-forget task-completion webhook (R7).

import { query } from '../db';
import { config } from '../config';
import { Project } from '../types';

// Looks up the owning project's webhook_url and, if set, POSTs a completion
// payload. Errors are swallowed so the API response is never blocked.
export async function fireTaskCompleted(
  taskId: number,
  projectId: number,
): Promise<void> {
  try {
    const rows = await query<Project>(
      'SELECT webhook_url FROM projects WHERE id = ? LIMIT 1',
      [projectId],
    );
    const url = rows[0]?.webhook_url;
    if (!url) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs);

    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'task.completed',
        task_id: taskId,
        project_id: projectId,
        completed_at: new Date().toISOString(),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  } catch (err) {
    // Fire-and-forget: log and swallow.
    console.warn('webhook delivery failed', err);
  }
}

