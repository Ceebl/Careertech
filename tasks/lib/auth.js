// Request-level authentication: who is this, and are they allowed in at all.
//
// Access to particular workspaces and boards is a separate question, answered
// in access.js.

import { resolveSession } from './sessions.js';
import { csrfToken } from './csrf.js';
import { refuse, wantsJson } from './http.js';

/**
 * Work out who is making this request and hang it off `req.user`.
 * Runs on every request, including the login page, where the answer is null.
 */
export function attachUser(req, res, next) {
  const user = resolveSession(req);
  req.user = user;
  // Templates need the CSRF token for their forms; nothing else needs to know
  // it exists.
  res.locals.user = user;
  res.locals.csrf = user ? csrfToken(user.tokenHash) : '';
  next();
}

/** Everything past this point needs a signed-in user. */
export function requireUser(req, res, next) {
  if (req.user) {
    // Someone whose password was set by an admin is walled into the
    // change-password page until they replace it. They are signed in, but the
    // password they used is one another person knows.
    if (req.user.mustChange && !req.path.startsWith('/account/password')
        && !req.path.startsWith('/logout')) {
      return res.redirect('/tasks/account/password?first=1');
    }
    return next();
  }

  if (req.method === 'GET' && !wantsJson(req)) {
    // Only ever bounce back to a path inside this app. Taking the `next`
    // parameter on trust is how a login page becomes an open redirect used to
    // make phishing links look legitimate.
    const wanted = req.originalUrl || '/tasks/';
    const safe = isInternal(wanted) ? wanted : '/tasks/';
    return res.redirect(`/tasks/login?next=${encodeURIComponent(safe)}`);
  }
  return res.status(401).json({ error: 'not signed in' });
}

/** Account administration only. Grants no access to anybody's data. */
export function requireAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  // 404 rather than 403: there is no reason to confirm that an administration
  // area exists to somebody who is not allowed into it.
  return refuse(req, res, 404, 'Not found.');
}

/**
 * Is this a path within this app, rather than somewhere else entirely?
 *
 * Used on the `next` parameter the login page carries -- the one place where
 * a visitor's own text decides where the browser goes next. Get it wrong and
 * the sign-in page becomes a redirector: a link that genuinely does start at
 * emaitch.co.uk and ends up somewhere else, which is what makes a phishing
 * link convincing.
 *
 * A whitelist, and each rule closes off a shape that reads as somewhere other
 * than where it looks.
 */
export function isInternal(target) {
  const value = String(target ?? '');

  // Exactly this app's own paths, and nothing that merely begins with the
  // letters "tasks". This also rules out `//evil.example.com`, which browsers
  // read as another host despite starting with a slash.
  if (value !== '/tasks' && !value.startsWith('/tasks/')) return false;

  // `/tasks/../../elsewhere` resolves to `/elsewhere` once the browser is done
  // with it. It cannot leave this origin, so it is not an escape -- but this
  // function should mean what its name says.
  if (value.includes('..')) return false;

  // Newlines, raw or percent-encoded. Express keeps the encoded form encoded,
  // so this is not a way to add a response header today; the rule is here so
  // it stays that way if anything in front ever decodes first.
  if (/[\r\n]/.test(value) || /%0[da]/i.test(value)) return false;

  // Backslashes and control characters have no legitimate place in these
  // paths, and browsers have historically disagreed about what a backslash
  // means in a URL.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;

  return true;
}

/* --------------------------------------------------------- login throttling */

// Guessing passwords is the only attack that works from the outside without
// anything else going wrong first, so the login page is the one place worth
// slowing down hard.
//
// Counted two ways on purpose. Per-account stops someone hammering one account
// from many addresses; per-address stops someone trying one password against
// many accounts, which is what credential-stuffing actually looks like and
// which a per-account counter alone never sees.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 8;
const MAX_PER_IP = 20;

const byAccount = new Map();
const byIp = new Map();

function bump(map, key, max) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || entry.until <= now) {
    entry = { count: 0, until: now + WINDOW_MS };
    map.set(key, entry);
  }
  return { entry, blocked: entry.count >= max };
}

setInterval(() => {
  const now = Date.now();
  for (const map of [byAccount, byIp]) {
    for (const [key, entry] of map) if (entry.until <= now) map.delete(key);
  }
}, WINDOW_MS).unref();

/**
 * How long the caller must wait, in minutes, or 0 if they may try now.
 *
 * @param {import('express').Request} req
 * @returns {number}
 */
export function loginLockout(req) {
  const account = String(req.body?.username ?? '').toLowerCase().slice(0, 60);
  const ip = req.ip || 'unknown';

  const a = bump(byAccount, account, MAX_PER_ACCOUNT);
  const i = bump(byIp, ip, MAX_PER_IP);

  if (!a.blocked && !i.blocked) return 0;
  const until = Math.max(a.blocked ? a.entry.until : 0, i.blocked ? i.entry.until : 0);
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

export function recordLoginFailure(req) {
  const account = String(req.body?.username ?? '').toLowerCase().slice(0, 60);
  const ip = req.ip || 'unknown';
  const a = byAccount.get(account);
  const i = byIp.get(ip);
  if (a) a.count += 1;
  if (i) i.count += 1;
}

export function clearLoginFailures(req) {
  byAccount.delete(String(req.body?.username ?? '').toLowerCase().slice(0, 60));
  byIp.delete(req.ip || 'unknown');
}
