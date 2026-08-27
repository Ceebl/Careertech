// Account administration.
//
// Nothing here reads or writes anybody's boards. An admin can create accounts,
// disable them, reset a password and read the audit log -- and that is the
// whole of it. Seeing inside a workspace still requires being a member of it.

import { Router } from 'express';
import { render, notice } from '../views/layout.js';
import { adminPage, resetPage, confirmDeletePage, auditPage } from '../views/admin.js';
import {
  listUsers, findById, createUser, setPassword, setEnabled, setIsAdmin,
  deleteUser, usernameProblem,
} from '../store/users.js';
import { passwordProblem } from '../lib/passwords.js';
import { looksLikeId } from '../lib/ids.js';
import { log, recentEvents } from '../lib/audit.js';
import { refuse } from '../lib/http.js';

const router = Router();

function page(req, res, extra = {}) {
  return render(res, {
    title: 'Administration',
    crumbs: [{ label: 'Administration' }],
    body: adminPage({
      users: listUsers(),
      csrf: res.locals.csrf,
      me: req.user,
      ...extra,
    }),
  });
}

router.get('/', (req, res) => {
  page(req, res, { notice: req.query.saved ? String(req.query.saved).slice(0, 200) : '' });
});

router.post('/user', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

    const problem = usernameProblem(username) || passwordProblem(password, { username });
    if (problem) {
      res.status(400);
      return page(req, res, { error: problem });
    }

    const id = await createUser({
      username,
      displayName: req.body?.displayName || username,
      password,
      isAdmin: req.body?.isAdmin === '1',
      // Always. The password was typed by somebody else, so it is a way in
      // rather than a secret, until they replace it.
      mustChange: true,
    });

    log(req, 'admin.user.create', `${username} (${id})`);
    return res.redirect(`/tasks/admin?saved=${encodeURIComponent(`Account "${username}" created.`)}`);
  } catch (err) {
    return next(err);
  }
});

// The single dropdown on each row posts here and fans out, so there is one
// CSRF-protected form per user rather than five.
router.post('/user/:id', (req, res) => {
  const target = loadTarget(req, res);
  if (!target) return undefined;

  const action = String(req.body?.action ?? '');

  switch (action) {
    case 'disable':
    case 'enable': {
      const done = setEnabled(target.id, action === 'enable');
      log(req, `admin.user.${action}`, target.username);
      return finish(req, res, done,
        `${target.username} ${action === 'enable' ? 'enabled' : 'disabled'}.`,
        'That would leave the server with no admin who can sign in.');
    }
    case 'promote':
    case 'demote': {
      const done = setIsAdmin(target.id, action === 'promote');
      log(req, `admin.user.${action}`, target.username);
      return finish(req, res, done,
        `${target.username} ${action === 'promote' ? 'is now an admin' : 'is no longer an admin'}.`,
        'That would leave the server with no admins at all.');
    }
    case 'reset':
      return render(res, {
        title: 'Reset password',
        crumbs: [{ label: 'Administration', href: '/tasks/admin' }, { label: 'Reset password' }],
        body: resetPage({ user: target, csrf: res.locals.csrf }),
      });
    case 'delete':
      return render(res, {
        title: 'Delete account',
        crumbs: [{ label: 'Administration', href: '/tasks/admin' }, { label: 'Delete account' }],
        body: confirmDeletePage({ user: target, csrf: res.locals.csrf }),
      });
    default:
      return res.redirect('/tasks/admin');
  }
});

router.post('/user/:id/reset', async (req, res, next) => {
  try {
    const target = loadTarget(req, res);
    if (!target) return undefined;

    const password = String(req.body?.password ?? '');
    const problem = passwordProblem(password, { username: target.username });
    if (problem) {
      res.status(400);
      return render(res, {
        title: 'Reset password',
        body: resetPage({ user: target, csrf: res.locals.csrf, error: problem }),
      });
    }

    // Signs them out everywhere as a side effect, which is the point.
    await setPassword(target.id, password, { mustChange: true });
    log(req, 'admin.user.reset', target.username);
    return res.redirect(`/tasks/admin?saved=${encodeURIComponent(`Password reset for ${target.username}.`)}`);
  } catch (err) {
    return next(err);
  }
});

router.post('/user/:id/delete', (req, res) => {
  const target = loadTarget(req, res);
  if (!target) return undefined;

  // Typing the name is the only guard between a mis-click and an account that
  // cannot be brought back.
  if (String(req.body?.confirm ?? '').trim().toLowerCase() !== target.username.toLowerCase()) {
    res.status(400);
    return render(res, {
      title: 'Delete account',
      body: notice('The username did not match, so nothing was deleted.', '/tasks/admin'),
    });
  }

  const done = deleteUser(target.id);
  log(req, done ? 'admin.user.delete' : 'admin.user.delete.refused', target.username);
  return finish(req, res, done, `${target.username} deleted.`,
    'That is the last admin account, so it cannot be deleted.');
});

router.get('/audit', (req, res) => {
  render(res, {
    title: 'Audit log',
    crumbs: [{ label: 'Administration', href: '/tasks/admin' }, { label: 'Audit log' }],
    body: auditPage({ events: recentEvents(300) }),
  });
});

/* ------------------------------------------------------------------ helpers */

function loadTarget(req, res) {
  const id = String(req.params.id ?? '');
  const target = looksLikeId(id) ? findById(id) : null;

  if (!target) {
    refuse(req, res, 404, 'No such account.', '/tasks/admin');
    return null;
  }
  // Acting on your own account through this screen is the quickest route to
  // locking yourself out. Your own settings live on the account page.
  if (target.id === req.user.id) {
    res.status(400);
    render(res, {
      title: 'Not possible',
      body: notice('Use your own account page to change your own settings.', '/tasks/account'),
    });
    return null;
  }
  return target;
}

function finish(req, res, done, okMessage, failMessage) {
  if (!done) {
    res.status(400);
    return render(res, { title: 'Not possible', body: notice(failMessage, '/tasks/admin') });
  }
  return res.redirect(`/tasks/admin?saved=${encodeURIComponent(okMessage)}`);
}

export default router;
