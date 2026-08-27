// Workspaces and who is in them.

import { db, transaction } from '../lib/db.js';
import { newId } from '../lib/ids.js';
import { paletteColour } from '../lib/columns.js';
import { ROLES } from '../lib/schema.js';

const insertWorkspace = db.prepare(`
  INSERT INTO workspaces (id, name, colour, created_by) VALUES (?, ?, ?, ?)
`);

const insertMember = db.prepare(`
  INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role
`);

// The list on the front page. Counting boards in the same query keeps it to one
// round trip, and the join to workspace_members is what makes it impossible for
// this to return somebody else's workspace.
const mine = db.prepare(`
  SELECT w.id, w.name, w.colour, w.created_at, m.role,
         (SELECT COUNT(*) FROM boards b
           WHERE b.workspace_id = w.id AND b.archived_at IS NULL) AS board_count,
         (SELECT COUNT(*) FROM workspace_members m2
           WHERE m2.workspace_id = w.id) AS member_count
    FROM workspaces w
    JOIN workspace_members m ON m.workspace_id = w.id
   WHERE m.user_id = ? AND w.archived_at IS NULL
   ORDER BY w.name COLLATE NOCASE
`);

const membersOf = db.prepare(`
  SELECT u.id, u.username, u.display_name, u.disabled_at, m.role, m.added_at
    FROM workspace_members m
    JOIN users u ON u.id = m.user_id
   WHERE m.workspace_id = ?
   ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
            u.username COLLATE NOCASE
`);

const removeMember = db.prepare(
  'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
);

const countOwners = db.prepare(`
  SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'owner'
`);

const renameWorkspace = db.prepare('UPDATE workspaces SET name = ?, colour = ? WHERE id = ?');
const archiveWorkspace = db.prepare(
  "UPDATE workspaces SET archived_at = datetime('now') WHERE id = ?",
);

/**
 * Create a workspace, with its creator as owner.
 * Both writes or neither -- a workspace nobody owns is unreachable forever.
 */
export function createWorkspace({ name, colour, userId }) {
  return transaction(() => {
    const id = newId();
    insertWorkspace.run(id, cleanName(name, 'Untitled workspace'), paletteColour(colour, '#496DDB'), userId);
    insertMember.run(id, userId, 'owner');
    return id;
  });
}

export function workspacesFor(userId) {
  return mine.all(userId);
}

export function members(workspaceId) {
  return membersOf.all(workspaceId);
}

/** Every user id in a workspace, for validating a Person cell. */
export function memberIds(workspaceId) {
  return new Set(membersOf.all(workspaceId).map((row) => row.id));
}

/**
 * Add somebody, or change the role they already have.
 * @param {'viewer'|'member'|'owner'} role
 */
export function setMember(workspaceId, userId, role) {
  const value = ROLES.includes(role) ? role : 'member';
  return transaction(() => {
    // Demoting the only owner would leave a workspace nobody can administer.
    if (value !== 'owner' && isOnlyOwner(workspaceId, userId)) return false;
    insertMember.run(workspaceId, userId, value);
    return true;
  });
}

export function dropMember(workspaceId, userId) {
  return transaction(() => {
    if (isOnlyOwner(workspaceId, userId)) return false;
    removeMember.run(workspaceId, userId);
    return true;
  });
}

function isOnlyOwner(workspaceId, userId) {
  const current = db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId);
  return current?.role === 'owner' && countOwners.get(workspaceId).n <= 1;
}

export function rename(workspaceId, name, colour) {
  renameWorkspace.run(cleanName(name, 'Untitled workspace'), paletteColour(colour, '#496DDB'), workspaceId);
}

/**
 * Archive rather than delete.
 *
 * Every lookup in access.js already filters on archived_at, so an archived
 * workspace vanishes from the app completely -- but the rows are still there
 * if it turns out to have been a mistake, which "DELETE FROM" cannot offer.
 */
export function archive(workspaceId) {
  archiveWorkspace.run(workspaceId);
}

function cleanName(value, fallback) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}
