// Accounts.
//
// There is no sign-up page anywhere in this app. Accounts exist because an
// admin created one, which means the answer to "how did a stranger get an
// account" is always "they did not". That is worth more than any amount of
// clever validation on a public form.

import { db, transaction } from '../lib/db.js';
import { newId } from '../lib/ids.js';
import { hashPassword } from '../lib/passwords.js';
import { endAllSessions } from '../lib/sessions.js';

const insert = db.prepare(`
  INSERT INTO users (id, username, display_name, password_hash, must_change, is_admin)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const byUsername = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const byId = db.prepare('SELECT * FROM users WHERE id = ?');

const listAll = db.prepare(`
  SELECT id, username, display_name, is_admin, disabled_at, created_at, last_login_at,
         must_change
    FROM users ORDER BY username COLLATE NOCASE
`);

const setHash = db.prepare('UPDATE users SET password_hash = ?, must_change = ? WHERE id = ?');
const setName = db.prepare('UPDATE users SET display_name = ? WHERE id = ?');
const setAdmin = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
const setDisabled = db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?');
const markLogin = db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?");
const countAdmins = db.prepare(
  'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled_at IS NULL',
);
const removeUser = db.prepare('DELETE FROM users WHERE id = ?');

/** Usernames are for typing at a login box, so keep them boring. */
export function usernameProblem(username) {
  const value = String(username ?? '').trim();
  if (value.length < 3) return 'Usernames must be at least 3 characters.';
  if (value.length > 32) return 'Usernames must be 32 characters or fewer.';
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return 'Usernames can contain letters, numbers, full stops, hyphens and underscores only.';
  }
  if (byUsername.get(value)) return 'That username is already taken.';
  return null;
}

/**
 * Create an account.
 *
 * @param {{ username: string, displayName?: string, password: string,
 *           isAdmin?: boolean, mustChange?: boolean }} details
 * @returns {Promise<string>} the new user's id
 */
export async function createUser({
  username, displayName = '', password, isAdmin = false, mustChange = true,
}) {
  const id = newId();
  const hash = await hashPassword(password);
  insert.run(
    id,
    String(username).trim(),
    String(displayName).trim().slice(0, 60),
    hash,
    mustChange ? 1 : 0,
    isAdmin ? 1 : 0,
  );
  return id;
}

export function findByUsername(username) {
  return byUsername.get(String(username ?? '').trim()) ?? null;
}

export function findById(id) {
  return byId.get(String(id ?? '')) ?? null;
}

export function listUsers() {
  return listAll.all();
}

/**
 * Replace someone's password.
 *
 * Every other session that user has is destroyed at the same time. If the
 * reason for the change is that a password leaked, leaving the old sessions
 * alive would make the change pointless.
 *
 * @param {string} userId
 * @param {string} password
 * @param {{ mustChange?: boolean, keepSessions?: boolean }} [options]
 */
export async function setPassword(userId, password, options = {}) {
  const hash = await hashPassword(password);
  setHash.run(hash, options.mustChange ? 1 : 0, userId);
  if (!options.keepSessions) endAllSessions(userId);
}

export function setDisplayName(userId, name) {
  setName.run(String(name ?? '').trim().slice(0, 60), userId);
}

export function recordLogin(userId) {
  markLogin.run(userId);
}

/**
 * Turn an account off without destroying anything it created.
 * Their sessions die immediately.
 */
export function setEnabled(userId, enabled) {
  return transaction(() => {
    if (!enabled && wouldStrandAdmins(userId)) return false;
    setDisabled.run(enabled ? null : new Date().toISOString().replace('T', ' ').slice(0, 19), userId);
    if (!enabled) endAllSessions(userId);
    return true;
  });
}

export function setIsAdmin(userId, isAdmin) {
  return transaction(() => {
    if (!isAdmin && wouldStrandAdmins(userId)) return false;
    setAdmin.run(isAdmin ? 1 : 0, userId);
    return true;
  });
}

/**
 * Delete an account outright.
 *
 * Their workspaces go with them, which is why the admin page warns first. Items
 * they created in other people's workspaces survive, with the creator blanked.
 */
export function deleteUser(userId) {
  return transaction(() => {
    if (wouldStrandAdmins(userId)) return false;
    endAllSessions(userId);
    removeUser.run(userId);
    return true;
  });
}

// Locking the last admin out of their own server is the kind of mistake that
// needs an SSH session and a sqlite prompt to undo, so it is simply refused.
function wouldStrandAdmins(userId) {
  const user = byId.get(userId);
  if (!user || user.is_admin !== 1 || user.disabled_at) return false;
  return countAdmins.get().n <= 1;
}

/**
 * Create the first admin account on an empty database.
 *
 * The username and password come from the deploy as environment variables and
 * are used exactly once, on the very first start. After that the check below
 * finds an existing user and does nothing at all, so leaving the variables set
 * is harmless -- and changing them does not reset anybody's password.
 */
export async function ensureBootstrapAdmin() {
  const anyUser = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (anyUser.n > 0) return null;

  const username = String(process.env.TASKS_ADMIN_USER || '').trim();
  const password = String(process.env.TASKS_ADMIN_PASSWORD || '');

  if (!username || password.length < 12) {
    console.error(
      'tasks: no accounts exist and TASKS_ADMIN_USER / TASKS_ADMIN_PASSWORD are not set '
      + '(the password must be at least 12 characters). Nobody can sign in.',
    );
    return null;
  }

  await createUser({
    username,
    displayName: username,
    password,
    isAdmin: true,
    // Set by hand in a deploy secret, so it counts as a password somebody else
    // has seen. It gets changed on first sign-in like any other.
    mustChange: true,
  });
  console.log(`tasks: created first admin account "${username}"`);
  return username;
}
