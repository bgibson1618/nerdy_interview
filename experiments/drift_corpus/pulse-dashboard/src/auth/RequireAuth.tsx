import { type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { beginLogin, getSession } from './oauth';

/**
 * Wraps protected routes (PRD R6). If there is no active session, it preserves
 * the intended path and redirects into the OAuth flow. Otherwise it renders
 * the wrapped view.
 */
export function RequireAuth({ children }: { children: ReactElement }): ReactElement | null {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    beginLogin(location.pathname);
    return null;
  }

  return children;
}

