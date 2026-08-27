// Cross-site request forgery protection.
//
// The attack: you are signed in here, you visit some other site, and that site
// quietly submits a form to /tasks/w/xyz/delete. Your browser attaches your
// cookie because it always does, and the workspace is gone. You never clicked
// anything that looked like a delete button.
//
// The defence: every state-changing request must also carry a token that the
// other site has no way to know. It is derived from the session with a keyed
// hash, so there is nothing extra to store and it dies with the session.
//
// SameSite=Lax on the cookie blocks most of this on its own. This is the belt
// to that pair of braces -- the two failure modes are different enough that
// having both is worth the twenty lines.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { SECRET } from './secret.js';
import { refuse } from './http.js';

/**
 * The token for one session.
 *
 * @param {string} tokenHash the session's token hash
 * @returns {string}
 */
export function csrfToken(tokenHash) {
  return createHmac('sha256', SECRET).update(`csrf:${tokenHash}`).digest('base64url');
}

/**
 * Reject any write that does not carry the right token.
 *
 * Accepts it from a hidden form field or from a header, so both ordinary form
 * posts and the inline cell edits made with fetch() are covered.
 */
export function requireCsrf(req, res, next) {
  // Read-only verbs change nothing, so they need no token.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (!req.user) {
    return res.status(401).json({ error: 'not signed in' });
  }

  const given = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = csrfToken(req.user.tokenHash);

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // Almost always a genuinely stale page rather than an attack, so say so
    // plainly instead of accusing anyone.
    return refuse(req, res, 403,
      'That page was too old to submit safely. Reload it and try again.');
  }

  return next();
}
