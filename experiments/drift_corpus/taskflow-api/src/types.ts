// Shared domain types for taskflow-api.

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface Project {
  id: number;
  owner_id: number;
  name: string;
  webhook_url: string | null;
  created_at: string;
}

export interface Task {
  id: number;
  project_id: number;
  owner_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  updated_at: string;
}

// Express request augmentation: requireAuth attaches the authenticated user id.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

