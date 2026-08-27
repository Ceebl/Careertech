// Sessions, stored as rows.
//
// The cookie holds a long random token and nothing else -- no username, no
// role, no expiry the browser could edit. Everything the server needs is looked
// up from the database, so revoking a session takes effect on the very next
// request. A signed cookie cannot do that; it stays valid until it expires
// however loudly you want it not to.
//
// The database stores a SHA-256 of the token rather than the token. Read-only
// access to this file therefore gets an attacker nothing: they would have to
// reverse the hash to produce a cookie that works.

import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';

export const COOKIE = 'tasks_session';
export const COOKIE_PATH = '/tasks';

// How long a session can live at the very most, even if used constantly.
const ABSOLUTE_DAYS = 30;
// How long a session survives without being used.
const IDLE_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

const insert = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
  VALUES (?, ?, ?, ?, ?)
`);

const lookup = db.prepare(`
  SELECT s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
         s.ip, s.user_agent,
         u.username, u.display_name, u.is_admin, u.must_change, u.disabled_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.token_hash = ?
     AND s.revoked_at IS NULL
     AND s.expires_at > datetime('now')
     AND s.last_seen_at > datetime('now', ?)
`);

const touch = db.prepare(
  "UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?",
);

const revokeOne = db.prepare(
  "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL",
);

const revokeUser = db.prepare(
  "UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL",
);

const revokeUserExcept = db.prepare(`
  UPDATE sessions SET revoked_at = datetime('now')
   WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL
`);

const listForUser = db.prepare(`
  SELECT token_hash, created_at, last_seen_at, ip, user_agent
    FROM sessions
   WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
   ORDER BY last_seen_at DESC
`);

/** @param {string} token */
export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Start a session and set the cookie.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} userId
 * @returns {string} the token hash, used to derive this session's CSRF token
 */
export function startSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + ABSOLUTE_DAYS * DAY).toISOString().replace('T', ' ').slice(0, 19);

  insert.run(
    tokenHash,
    userId,
    expires,
    req.ip || '',
    String(req.get('user-agent') || '').slice(0, 200),
  );

  res.cookie(COOKIE, token, {
    // Script on the page cannot read it, so an XSS bug -- if one ever slipped
    // through -- still could not walk off with the session.
    httpOnly: true,
    // Forced on in production rather than trusting a proxy header to be read
    // correctly; a misread header would silently ship the cookie over HTTP.
    secure: process.env.NODE_ENV === 'production' || req.secure,
    // Lax, not Strict, so following a link to a board from an email still lands
    // you signed in. Every state-changing request is protected by a CSRF token
    // instead, which is the stronger half of the pair anyway.
    sameSite: 'lax',
    // Scoped to this app, so it is never sent to /kb/, /api/ or any other
    // project on the domain.
    path: COOKIE_PATH,
    maxAge: ABSOLUTE_DAYS * DAY,
  });

  return tokenHash;
}

/**
 * Read the token out of the request's cookies.
 * Written by hand so the app has no cookie-parser dependency.
 */
export function readToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve a request to a signed-in user, or null.
 *
 * @returns {null | {
 *   tokenHash: string, id: string, username: string, displayName: string,
 *   isAdmin: boolean, mustChange: boolean
 * }}
 */
export function resolveSession(req) {
  const token = readToken(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = lookup.get(tokenHash, `-${IDLE_DAYS} days`);
  if (!row) return null;

  // A disabled account keeps its session rows but stops being able to use them.
  if (row.disabled_at) return null;

  // Rolling expiry: using the app keeps you signed in, walking away does not.
  touch.run(tokenHash);

  return {
    tokenHash,
    id: row.user_id,
    username: row.username,
    displayName: row.display_name || row.username,
    isAdmin: row.is_admin === 1,
    mustChange: row.must_change === 1,
  };
}

export function endSession(req, res) {
  const token = readToken(req);
  if (token) revokeOne.run(hashToken(token));
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
}

/** Sign a user out everywhere. Used when their password changes. */
export function endAllSessions(userId) {
  revokeUser.run(userId);
}

/** Sign a user out everywhere except the session making the request. */
export function endOtherSessions(userId, keepTokenHash) {
  revokeUserExcept.run(userId, keepTokenHash);
}

export function sessionsFor(userId) {
  return listForUser.all(userId);
}

// Revoked and expired rows are of no use to anyone, and the ip and user-agent
// they carry are worth not keeping around. Cleared out hourly.
const purge = db.prepare(`
  DELETE FROM sessions
   WHERE expires_at < datetime('now', '-1 day')
      OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-1 day'))
`);

export function startSessionSweeper() {
  const run = () => {
    try { purge.run(); } catch (err) { console.error('session sweep failed:', err.message); }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}
