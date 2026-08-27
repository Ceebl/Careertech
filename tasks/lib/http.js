// Deciding whether a reply should be a page or a JSON object.
//
// Most of this app is ordinary pages, but the inline cell editing talks to it
// with fetch(), and those calls want a JSON error they can read out rather than
// a mouthful of HTML. The trouble is that fetch() sends a wildcard Accept
// header by default, so asking "does this accept HTML?" answers yes to
// everything and settles nothing.
//
// What actually distinguishes the two is that the script sends a JSON body and
// asks for JSON back. That is what gets checked.

import { esc } from './html.js';

/**
 * @param {import('express').Request} req
 * @returns {boolean} true if the caller is script rather than a browser window
 */
export function wantsJson(req) {
  if (req.is('application/json')) return true;

  const accept = String(req.get('accept') || '');
  if (accept.includes('application/json')) return true;

  // Set by browsers on fetch()/XHR, absent on a normal page navigation.
  if (req.get('sec-fetch-dest') === 'empty') return true;

  return false;
}

/**
 * Send the same refusal in whichever form the caller can use.
 *
 * The message is escaped even though every caller passes a fixed string of our
 * own: the day somebody passes a name or a title through here, it should not
 * become the one hole in an app that is otherwise escaped end to end.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message
 * @param {string} [backHref] must be an internal path
 */
export function refuse(req, res, status, message, backHref = '/tasks/') {
  if (wantsJson(req)) {
    return res.status(status).json({ error: message });
  }
  const href = String(backHref).startsWith('/tasks') ? backHref : '/tasks/';
  return res.status(status).type('html').send(
    `<p>${esc(message)} <a href="${esc(href)}">Back</a>.</p>`,
  );
}
