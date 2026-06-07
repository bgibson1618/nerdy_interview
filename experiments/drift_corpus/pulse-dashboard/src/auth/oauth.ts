/**
 * OAuth 2.0 Authorization Code (PKCE) redirect flow (PRD R6).
 * No client secret is stored in the browser; this is a public client.
 */

const AUTHORIZE_URL = 'https://auth.pulse.example.com/oauth/authorize';
const CLIENT_ID = 'pulse-dashboard-web';
const REDIRECT_URI = 'http://localhost:5173/auth/callback';
const SCOPE = 'metrics:read';

/** sessionStorage key holding the active session JSON. */
export const SESSION_KEY = 'pulse.auth';

export interface Session {
  accessToken: string;
  /** Epoch milliseconds at which the token expires. */
  expiresAt: number;
}

/** Reads the active session, or null if none / malformed. */
export function getSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

/** Clears the active session. */
export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Redirects the browser to the provider's authorize endpoint. */
export function beginLogin(intendedPath: string): void {
  sessionStorage.setItem('pulse.intendedPath', intendedPath);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
  });
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/**
 * Handles the provider redirect back to /auth/callback: exchanges the code for
 * a token and stores the session. Returns the path to navigate to next.
 */
export async function handleCallback(code: string): Promise<string> {
  const session = await exchangeCode(code);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  const intended = sessionStorage.getItem('pulse.intendedPath') ?? '/';
  sessionStorage.removeItem('pulse.intendedPath');
  return intended;
}

/** Exchanges an authorization code for a session (token endpoint call). */
async function exchangeCode(code: string): Promise<Session> {
  const res = await fetch('https://auth.pulse.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed with ${res.status}`);
  }
  return (await res.json()) as Session;
}

