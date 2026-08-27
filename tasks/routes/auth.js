// Signing in and out, and looking after your own account.

import { Router } from 'express';
import { render } from '../views/layout.js';
import { loginPage, passwordPage, accountPage } from '../views/auth.js';
import {
  findByUsername, findById, setPassword, setDisplayName, recordLogin,
} from '../store/users.js';
import { verifyPassword, hashPassword, passwordProblem } from '../lib/passwords.js';
import {
  startSession, endSession, endOtherSessions, sessionsFor,
} from '../lib/sessions.js';
import {
  loginLockout, recordLoginFailure, clearLoginFailures, isInternal,
} from '../lib/auth.js';
import { log } from '../lib/audit.js';

export const publicRoutes = Router();
export const accountRoutes = Router();

// Verifying a password takes about a tenth of a second by design. If we skipped
// that work when the username does not exist, the reply would come back visibly
// faster -- and that difference is enough to work out which usernames are real.
// So a miss is checked against this throwaway hash instead, and takes exactly
// as long as a hit.
const DECOY = await hashPassword(`decoy-${Math.random()}-${Date.now()}`);

publicRoutes.get('/login', (req, res) => {
  if (req.user) return res.redirect('/tasks/');
  const next = isInternal(req.query.next) ? String(req.query.next) : '/tasks/';
  return render(res, {
    title: 'Sign in',
    bodyClass: 'plain',
    body: loginPage({ next, notice: req.query.out ? 'You have been signed out.' : '' }),
  });
});

publicRoutes.post('/login', async (req, res, next) => {
  try {
    if (req.user) return res.redirect('/tasks/');

    const wait = loginLockout(req);
    if (wait) {
      log(req, 'login.throttled', `locked for ${wait} more minute(s)`);
      res.status(429);
      return render(res, {
        title: 'Too many attempts',
        bodyClass: 'plain',
        body: loginPage({
          error: `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`,
        }),
      });
    }

    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const user = findByUsername(username);

    const { ok, needsRehash } = await verifyPassword(password, user?.password_hash ?? DECOY);

    // One message for every kind of failure. "No such user" and "wrong
    // password" as separate messages hands over a list of real usernames.
    if (!user || !ok || user.disabled_at) {
      recordLoginFailure(req);
      log(req, 'login.fail', user?.disabled_at ? 'account disabled' : 'bad credentials');
      res.status(401);
      return render(res, {
        title: 'Sign in',
        bodyClass: 'plain',
        body: loginPage({
          next: isInternal(req.body?.next) ? String(req.body.next) : '/tasks/',
          error: 'That username and password did not match.',
        }),
      });
    }

    clearLoginFailures(req);

    // The cost settings have gone up since this password was stored, and we
    // happen to be holding the plain text this once. Quietly upgrade it.
    if (needsRehash) {
      await setPassword(user.id, password, { mustChange: user.must_change === 1, keepSessions: true });
    }

    startSession(req, res, user.id);
    recordLogin(user.id);
    req.user = { id: user.id, username: user.username };
    log(req, 'login.ok');

    const target = isInternal(req.body?.next) ? String(req.body.next) : '/tasks/';
    return res.redirect(target);
  } catch (err) {
    return next(err);
  }
});

/* ------------------------------------------------------- signed-in account */

accountRoutes.post('/logout', (req, res) => {
  log(req, 'logout');
  endSession(req, res);
  res.redirect('/tasks/login?out=1');
});

accountRoutes.get('/account', (req, res) => {
  render(res, {
    title: 'Your account',
    crumbs: [{ label: 'Your account' }],
    body: accountPage({
      user: req.user,
      sessions: sessionsFor(req.user.id),
      currentToken: req.user.tokenHash,
      csrf: res.locals.csrf,
      notice: req.query.saved ? 'Saved.' : '',
    }),
  });
});

accountRoutes.post('/account/name', (req, res) => {
  setDisplayName(req.user.id, req.body?.displayName);
  log(req, 'account.rename');
  res.redirect('/tasks/account?saved=1');
});

accountRoutes.get('/account/password', (req, res) => {
  render(res, {
    title: 'Change password',
    crumbs: [{ label: 'Password' }],
    body: passwordPage({ csrf: res.locals.csrf, first: Boolean(req.query.first) }),
  });
});

accountRoutes.post('/account/password', async (req, res, next) => {
  try {
    const current = String(req.body?.current ?? '');
    const password = String(req.body?.password ?? '');
    const confirm = String(req.body?.confirm ?? '');

    const fail = (status, error) => {
      res.status(status);
      return render(res, {
        title: 'Change password',
        crumbs: [{ label: 'Password' }],
        body: passwordPage({ csrf: res.locals.csrf, error, first: req.user.mustChange }),
      });
    };

    const row = findById(req.user.id);
    const { ok } = await verifyPassword(current, row.password_hash);
    if (!ok) {
      log(req, 'password.change.fail', 'current password wrong');
      return fail(401, 'Your current password was not right.');
    }
    if (password !== confirm) {
      return fail(400, 'The two new passwords did not match.');
    }
    const problem = passwordProblem(password, { username: req.user.username });
    if (problem) return fail(400, problem);
    if (password === current) {
      return fail(400, 'That is the password you already have.');
    }

    // Signs out everywhere, this browser included -- if the reason for the
    // change is that the old password leaked, leaving sessions alive would
    // undo the point of changing it.
    await setPassword(req.user.id, password, { mustChange: false });
    log(req, 'password.change.ok');
    return res.redirect('/tasks/login?out=1');
  } catch (err) {
    return next(err);
  }
});

accountRoutes.post('/account/sessions/revoke', (req, res) => {
  endOtherSessions(req.user.id, req.user.tokenHash);
  log(req, 'sessions.revoke.others');
  res.redirect('/tasks/account?saved=1');
});
