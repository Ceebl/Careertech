// Who is allowed to see and touch what.
//
// This is the most important file in the app. The way multi-user tools leak
// data is almost never a broken password -- it is a signed-in user changing an
// id in the URL and being handed somebody else's board because the code looked
// the board up by id and forgot to ask whose it was.
//
// So there is no function here that fetches a board by id. Every lookup joins
// through workspace_members with the current user bound into the query, which
// means "not yours" and "does not exist" are the same code path and produce the
// same 404. Nothing elsewhere in the app is allowed to query boards, items or
// cells directly by id -- it goes through here, gets the row and the caller's
// role together, or gets nothing.
//
// One deliberate omission: being a server admin does NOT grant access to
// anyone's boards. Admins create accounts; that is all. Privacy inside the app
// comes from membership only, with no override, because an override is exactly
// the thing that gets misused or forgotten about.

import { db } from './db.js';
import { refuse } from './http.js';
import { looksLikeId } from './ids.js';
import { ROLES } from './schema.js';

const RANK = Object.fromEntries(ROLES.map((role, i) => [role, i]));

/**
 * Does `role` meet the bar set by `needed`?
 * @param {string} role
 * @param {'viewer'|'member'|'owner'} needed
 */
export function atLeast(role, needed) {
  return (RANK[role] ?? -1) >= (RANK[needed] ?? 99);
}

/* ------------------------------------------------------------------ lookups */

const workspaceQuery = db.prepare(`
  SELECT w.id, w.name, w.colour, w.created_at, m.role
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE w.id = ? AND m.user_id = ? AND w.archived_at IS NULL
`);

const boardQuery = db.prepare(`
  SELECT b.id, b.workspace_id, b.name, b.description, b.created_at,
         w.name AS workspace_name, w.colour AS workspace_colour,
         m.role
    FROM boards b
    JOIN workspaces w        ON w.id = b.workspace_id
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE b.id = ? AND m.user_id = ?
     AND b.archived_at IS NULL AND w.archived_at IS NULL
`);

const itemQuery = db.prepare(`
  SELECT i.id, i.board_id, i.group_id, i.parent_id, i.title,
         i.created_at, i.updated_at,
         b.workspace_id, b.name AS board_name,
         w.name AS workspace_name,
         m.role
    FROM items i
    JOIN boards b            ON b.id = i.board_id
    JOIN workspaces w        ON w.id = b.workspace_id
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE i.id = ? AND m.user_id = ?
     AND i.archived_at IS NULL AND b.archived_at IS NULL AND w.archived_at IS NULL
`);

const groupQuery = db.prepare(`
  SELECT g.id, g.board_id, g.name, g.colour, m.role
    FROM board_groups g
    JOIN boards b            ON b.id = g.board_id
    JOIN workspaces w        ON w.id = b.workspace_id
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE g.id = ? AND m.user_id = ?
     AND b.archived_at IS NULL AND w.archived_at IS NULL
`);

const columnQuery = db.prepare(`
  SELECT c.id, c.board_id, c.name, c.type, c.settings, c.position, m.role
    FROM board_columns c
    JOIN boards b            ON b.id = c.board_id
    JOIN workspaces w        ON w.id = b.workspace_id
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE c.id = ? AND m.user_id = ?
     AND b.archived_at IS NULL AND w.archived_at IS NULL
`);

/** @returns {object|null} the workspace plus the caller's role in it */
export function workspaceFor(userId, workspaceId) {
  if (!looksLikeId(workspaceId)) return null;
  return workspaceQuery.get(workspaceId, userId) ?? null;
}

/** @returns {object|null} the board plus the caller's role in its workspace */
export function boardFor(userId, boardId) {
  if (!looksLikeId(boardId)) return null;
  return boardQuery.get(boardId, userId) ?? null;
}

/** @returns {object|null} the item plus the caller's role */
export function itemFor(userId, itemId) {
  if (!looksLikeId(itemId)) return null;
  return itemQuery.get(itemId, userId) ?? null;
}

/** @returns {object|null} the group plus the caller's role */
export function groupFor(userId, groupId) {
  if (!looksLikeId(groupId)) return null;
  return groupQuery.get(groupId, userId) ?? null;
}

/** @returns {object|null} the column plus the caller's role */
export function columnFor(userId, columnId) {
  if (!looksLikeId(columnId)) return null;
  return columnQuery.get(columnId, userId) ?? null;
}

/* -------------------------------------------------------------- middleware */

// The two are separated so the reason for a refusal is honest: 404 when you
// have no business knowing the thing exists, 403 when you may look but not
// touch. Telling a viewer "you cannot edit this" is fine. Telling a stranger
// "this board exists but is not yours" is not.
function guard(fetch, attach) {
  /**
   * @param {'viewer'|'member'|'owner'} needed
   * @param {string} param name of the route parameter holding the id
   */
  return (needed, param) => (req, res, next) => {
    const found = fetch(req.user.id, req.params[param]);
    if (!found) return notFound(req, res);

    if (!atLeast(found.role, needed)) return forbidden(req, res, found.role);

    req[attach] = found;
    return next();
  };
}

export const requireWorkspace = guard(workspaceFor, 'workspace');
export const requireBoard = guard(boardFor, 'board');
export const requireItem = guard(itemFor, 'item');
export const requireGroup = guard(groupFor, 'group');
export const requireColumn = guard(columnFor, 'column');

function notFound(req, res) {
  return refuse(req, res, 404, 'Not found.');
}

function forbidden(req, res, role) {
  return refuse(req, res, 403, role === 'viewer'
    ? 'You have view-only access to this workspace, so you cannot change it.'
    : 'Only the workspace owner can do that.');
}
