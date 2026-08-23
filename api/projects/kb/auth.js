// Two-password access control.
//
//   reader password -> can read everything
//   admin  password -> can read, write, and delete
//
// No accounts, no sign-up, no password resets. For a tool with one author and
// a handful of trusted readers, that is the right amount of machinery.

import {
  createHmac, randomBytes, timingSafeEqual, createHash,
} from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const COOKIE = 'kb_session';
const MAX_AGE_DAYS = 30;

const READER_PASSWORD = process.env.KB_READER_PASSWORD || '';
const ADMIN_PASSWORD = process.env.KB_ADMIN_PASSWORD || '';

export const configured = Boolean(READER_PASSWORD && ADMIN_PASSWORD);
if (!configured) {
  console.error('kb: KB_READER_PASSWORD / KB_ADMIN_PASSWORD are not set - the knowledge base will refuse all logins');
}

// Kept on disk so a restart does not sign everyone out. Generated once.
function sessionSecret() {
  const file = join(DATA_DIR, 'kb-session.key');
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(DATA_DIR, { recursive: true });
  const secret = randomBytes(32);
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const SECRET = sessionSecret();

// Compare hashes rather than the strings themselves: equal length, and the
// comparison takes the same time whatever the input, so it leaks nothing.
function samePassword(given, expected) {
  if (!expected) return false;
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Work out who this request is, and hang it off req.kb. */
export function session(req, res, next) {
  const payload = verify(readCookie(req));
  req.kb = {
    role: payload?.role ?? null,
    isAdmin: payload?.role === 'admin',
    isReader: payload?.role === 'admin' || payload?.role === 'reader',
  };
  next();
}

export function logIn(req, res, password) {
  let role = null;
  // Admin is checked first so the same password in both slots grants admin.
  if (samePassword(password, ADMIN_PASSWORD)) role = 'admin';
  else if (samePassword(password, READER_PASSWORD)) role = 'reader';
  if (!role) return null;

  const exp = Date.now() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE, sign({ role, exp }), {
    // JavaScript cannot read it, so pasted HTML cannot steal it.
    httpOnly: true,
    // Forced in production rather than trusting the proxy header to be read
    // correctly -- a misconfigured proxy would otherwise silently drop this.
    secure: process.env.NODE_ENV === 'production' || req.secure,
    sameSite: 'lax',
    path: '/kb',
    maxAge: MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  });
  return role;
}

export function logOut(req, res) {
  res.clearCookie(COOKIE, { path: '/kb' });
}

export function requireReader(req, res, next) {
  if (req.kb?.isReader) return next();
  const back = encodeURIComponent(req.originalUrl || '/kb/');
  res.redirect(`/kb/login?next=${back}`);
}

export function requireAdmin(req, res, next) {
  if (req.kb?.isAdmin) return next();
  if (req.kb?.isReader) {
    return res.status(403).send(
      '<p>That needs the admin password. <a href="/kb/">Back</a></p>'
    );
  }
  res.redirect('/kb/login');
}

// Login is the one place worth guarding hard: it is the only endpoint where
// guessing repeatedly gets you anywhere.
const attempts = new Map();
export function throttleLogin(req, res, next) {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const window = 15 * 60 * 1000;
  const entry = attempts.get(ip);

  if (entry && entry.until > now && entry.count >= 10) {
    const mins = Math.ceil((entry.until - now) / 60000);
    return res.status(429).send(
      `<p>Too many attempts. Try again in ${mins} minute(s).</p>`
    );
  }
  if (!entry || entry.until <= now) attempts.set(ip, { count: 0, until: now + window });
  next();
}

export function recordFailure(req) {
  const entry = attempts.get(req.ip || 'unknown');
  if (entry) entry.count += 1;
}

export function clearFailures(req) {
  attempts.delete(req.ip || 'unknown');
}
