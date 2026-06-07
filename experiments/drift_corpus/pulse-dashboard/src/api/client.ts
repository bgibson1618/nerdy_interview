import { config } from '../config';
import { getSession } from '../auth/oauth';

/** Thrown on any non-2xx API response (PRD R9). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Performs a GET against the Pulse Metrics API, attaching the bearer token
 * from the active session. Throws ApiError on non-2xx.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (session) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const res = await fetch(`${config.apiBaseUrl}${path}`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, `Request to ${path} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

