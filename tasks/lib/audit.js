// The record of what happened.
//
// Writes here are fire-and-forget: a failure to log must never be a failure to
// do the thing. But everything that creates, destroys, or grants access gets a
// line, because the question you eventually want answered is "when did that
// change, and who changed it", and there is no way to answer it after the fact.

import { db } from './db.js';

const insert = db.prepare(`
  INSERT INTO audit (user_id, username, ip, action, detail) VALUES (?, ?, ?, ?, ?)
`);

const recent = db.prepare(`
  SELECT at, username, ip, action, detail FROM audit
   ORDER BY id DESC LIMIT ?
`);

/**
 * @param {import('express').Request} req
 * @param {string} action  short verb, e.g. 'login.ok', 'board.delete'
 * @param {string} [detail] free text; never put a password or token in here
 */
export function log(req, action, detail = '') {
  try {
    insert.run(
      req.user?.id ?? null,
      req.user?.username ?? String(req.body?.username ?? '').slice(0, 60),
      req.ip || '',
      String(action).slice(0, 60),
      String(detail).slice(0, 500),
    );
  } catch (err) {
    console.error('audit write failed:', err.message);
  }
}

/** @param {number} limit */
export function recentEvents(limit = 200) {
  return recent.all(Math.min(Math.max(1, limit | 0), 1000));
}
