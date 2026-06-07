## The callback that almost shipped — OAuth 2.0 flow (timed ~12 min)
Review this as if it's a PR. Talk through your passes, severity-tag findings, *then* read the key.

```ts
// src/routes/auth/google.ts
//
// OAuth 2.0 "Sign in with Google" for LearnLoop (ed-tech SPA + JSON API).
//   GET /auth/google/start    -> bounce the learner to Google's consent screen
//   GET /auth/google/callback -> Google returns ?code & ?state; we exchange the
//                                code server-side and open a session.

import express, { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import jwt from "jsonwebtoken";
import { upsertUser } from "../../db/users";
import { createSession } from "../../auth/session-store";

const router = express.Router();

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = "GOCSPX-T8s2_9fa1Cc4e8B7d6F3a2C1e0"; // FIXME: move to secrets manager
const REDIRECT_URI = "https://app.learnloop.example/auth/google/callback";
const SCOPES = ["openid", "email", "profile"];

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
}

interface IdClaims {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

// GET /auth/google/start?returnTo=/courses/42
router.get("/auth/google/start", (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;                 // stash it to verify on the way back
  req.session.returnTo = req.query.returnTo as string;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

// GET /auth/google/callback?code=...&state=...
router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  const returnTo = (req.query.returnTo as string) || req.session.returnTo;

  console.log(`[auth] google callback code=${code} state=${state}`);

  // Trade the one-time authorization code for tokens. Runs server-side, so the
  // client secret is never exposed to the browser.
  const tokenRes = await axios.post<GoogleTokens>(GOOGLE_TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
  });

  const tokens = tokenRes.data;

  // Who just signed in? Pull it out of the ID token.
  const claims = jwt.decode(tokens.id_token) as IdClaims;

  const user = await upsertUser({
    googleId: claims.sub,
    email: claims.email,
    name: claims.name,
    avatarUrl: claims.picture,
  });

  const session = await createSession(user.id);

  // Session cookie: not readable by client-side JS.
  res.cookie("sid", session.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  // Hand the Google access token to the SPA so it can hit Google APIs itself.
  res.cookie("g_access_token", tokens.access_token, {
    secure: true,
    sameSite: "lax",
    maxAge: tokens.expires_in * 1000,
  });

  return res.redirect(returnTo || "/dashboard");
});

export default router;
```

<details>
<summary><b>Answer key — don't peek until you've reviewed</b></summary>

1. **Blocker (Security / CSRF):** The callback reads `state` into a variable and only *logs* it — it never compares it to the `req.session.oauthState` that `/start` stashed. This is login CSRF: an attacker completes consent with *their* Google account, harvests a valid `code`, then lures the victim to `…/callback?code=ATTACKER_CODE`, silently binding the victim's session to the attacker's identity — everything the learner does now lands in the attacker's account. Slips past because `state` *is* destructured and referenced, so a skimming reviewer assumes it's checked, and `SameSite=lax` *looks* like CSRF cover — but the callback is a top-level GET, which Lax permits. Fix: `if (!state || state !== req.session.oauthState) return res.status(400).send("bad state");` then delete it from the session.

2. **Blocker (Security / Token storage):** `g_access_token` is set as a cookie **without** `httpOnly`, so any XSS on the SPA reads `document.cookie` and exfiltrates a live Google bearer token. Slips past because the line right above it (`sid`) *does* set `httpOnly: true` and both share `secure`/`sameSite`, so the whole block reads as "locked down." Fix: don't ship the provider access token to the browser at all — keep it server-side and proxy Google API calls; if it absolutely must be a cookie, add `httpOnly: true`.

3. **Blocker (Security / Identity):** `jwt.decode(tokens.id_token)` only base64-decodes — it never verifies the signature, `aud`, `iss`, or `exp`, and the code then trusts `claims.email` with no `email_verified` check. A forged/wrong-audience token (or an unverified-email Google account) maps straight onto a LearnLoop user → account takeover. Slips past because "we got it straight from Google over TLS" *feels* trustworthy, and `decode` vs `verify` is a one-word difference that survives a quick read. Fix: `jwt.verify` against Google's JWKS with `audience: CLIENT_ID` and `issuer: "https://accounts.google.com"`, and reject unless `email_verified === true`.

4. **Should-fix (Correctness / Error handling):** There is no `if (req.query.error)` branch and no `try/catch`. When the learner clicks *Cancel*, Google redirects with `?error=access_denied` and **no** `code`; the handler POSTs `code: undefined`, Google answers 400, axios rejects, and the uncaught async rejection leaves the tab hanging (Express 4) or 500s with a stack trace (Express 5) instead of a friendly "sign-in cancelled." Slips past because the happy path works in every manual test — nobody clicks Cancel during a demo. Fix: handle `req.query.error` first, wrap the exchange in `try/catch`, and confirm `tokens.id_token` exists before decoding.

5. **Should-fix (Security / Open redirect):** `returnTo` comes from the query (or its session copy) and flows unvalidated into `res.redirect(returnTo || "/dashboard")`. `…/start?returnTo=https://evil.example` (or protocol-relative `//evil.example`) turns your trusted domain into a phishing bounce the moment a real login completes. Slips past because the `"/dashboard"` default makes the redirect look bounded. Fix: allow only app-relative paths — reject anything that doesn't match `^/[^/]` (and strip `//`-prefixed values).

6. **Should-fix (Secrets):** `CLIENT_SECRET` is hardcoded in source and, given the file, committed to the repo — arguably a blocker the instant it's in version control, so rotate it now. Slips past because the `// FIXME` reads as "tracked, we'll fix it later" and it's parked next to legit config constants. Fix: load from `process.env` / a secrets manager and fail closed if it's absent.

7. **Nit (Logging / Hygiene):** `console.log(... code=${code} ...)` writes the live authorization code — a single-use credential — to stdout, which ships to your log aggregator; within its short TTL it can be replayed. Slips past because it looks like ordinary request logging. Fix: log a correlation id, never the `code` or any token.

8. **Praise (Security):** Good instincts worth keeping: the code is exchanged **server-side**, so `CLIENT_SECRET` never reaches the browser, and the `sid` session cookie is correctly `httpOnly + secure + sameSite`. That's exactly the bar — which is precisely what makes the `g_access_token` cookie in #2 stand out. You clearly know the right cookie flags, so apply the same `httpOnly` there (or, better, don't hand that token to the client at all).

**Senior framing to say out loud:** "I'd block the merge on three: there's no `state` check (login CSRF), the ID token is decoded but never verified (account takeover), and a live access token sits in a non-HttpOnly cookie. I'd raise — but not block — the open redirect, the missing cancel/error path, and the hardcoded secret, each as a fast-follow with an owner. The code in the log line and the `as string` casts are linter/cleanup territory. Net: the server-side exchange and `sid` cookie hygiene show the author knows the right patterns, so this is a one-day fix, not a rewrite."
</details>
