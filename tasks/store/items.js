// Items -- the rows -- their cell values, and their comments.

import { db, transaction } from '../lib/db.js';
import { newId } from '../lib/ids.js';
import { normaliseValue, settingsOf } from '../lib/columns.js';

const insertItem = db.prepare(`
  INSERT INTO items (id, board_id, group_id, title, position, created_by)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const itemsOn = db.prepare(`
  SELECT id, group_id, title, position, created_at, updated_at, created_by
    FROM items
   WHERE board_id = ? AND archived_at IS NULL
   ORDER BY position, rowid
`);

// Every cell for the whole board in one query. The alternative -- one query per
// item -- is what makes a board of 300 rows take a second to draw.
const cellsOn = db.prepare(`
  SELECT c.item_id, c.column_id, c.value
    FROM cells c
    JOIN items i ON i.id = c.item_id
   WHERE i.board_id = ? AND i.archived_at IS NULL
`);

const upsertCell = db.prepare(`
  INSERT INTO cells (item_id, column_id, value) VALUES (?, ?, ?)
  ON CONFLICT (item_id, column_id) DO UPDATE SET value = excluded.value
`);

const clearCell = db.prepare('DELETE FROM cells WHERE item_id = ? AND column_id = ?');
const touchItem = db.prepare("UPDATE items SET updated_at = datetime('now') WHERE id = ?");
const renameItemRow = db.prepare(
  "UPDATE items SET title = ?, updated_at = datetime('now') WHERE id = ?",
);
const moveItemRow = db.prepare(
  "UPDATE items SET group_id = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
);
const archiveItemRow = db.prepare("UPDATE items SET archived_at = datetime('now') WHERE id = ?");
const nextItemPosition = db.prepare(
  'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM items WHERE board_id = ?',
);
const cellsForItem = db.prepare('SELECT column_id, value FROM cells WHERE item_id = ?');

const insertComment = db.prepare(
  'INSERT INTO comments (id, item_id, user_id, body) VALUES (?, ?, ?, ?)',
);
const commentsOn = db.prepare(`
  SELECT c.id, c.body, c.created_at, u.username, u.display_name
    FROM comments c
    LEFT JOIN users u ON u.id = c.user_id
   WHERE c.item_id = ?
   ORDER BY c.created_at, c.rowid
`);
const commentCountsOn = db.prepare(`
  SELECT c.item_id, COUNT(*) AS n
    FROM comments c
    JOIN items i ON i.id = c.item_id
   WHERE i.board_id = ? AND i.archived_at IS NULL
   GROUP BY c.item_id
`);
const deleteCommentRow = db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?');

/**
 * Everything needed to draw a board, in three queries.
 *
 * Returns items already carrying their cells as a plain object keyed by column
 * id, so the view never has to go looking anything up.
 */
export function boardContents(boardId) {
  const items = itemsOn.all(boardId);
  const byId = new Map(items.map((item) => [item.id, { ...item, cells: {}, comments: 0 }]));

  for (const cell of cellsOn.all(boardId)) {
    const item = byId.get(cell.item_id);
    if (item) item.cells[cell.column_id] = cell.value;
  }
  for (const row of commentCountsOn.all(boardId)) {
    const item = byId.get(row.item_id);
    if (item) item.comments = row.n;
  }

  return [...byId.values()];
}

export function createItem({ boardId, groupId, title, userId }) {
  const id = newId();
  insertItem.run(
    id,
    boardId,
    groupId,
    cleanTitle(title),
    nextItemPosition.get(boardId).next,
    userId,
  );
  return id;
}

export function renameItem(itemId, title) {
  renameItemRow.run(cleanTitle(title), itemId);
}

export function archiveItem(itemId) {
  archiveItemRow.run(itemId);
}

export function moveItem(itemId, groupId, position) {
  moveItemRow.run(groupId, Number.isFinite(position) ? position : 0, itemId);
}

export function cellsOf(itemId) {
  const out = {};
  for (const row of cellsForItem.all(itemId)) out[row.column_id] = row.value;
  return out;
}

/**
 * Write one cell.
 *
 * The value is cleaned by its column's own rules first, so what lands in the
 * database is always something that column can mean. An empty result is stored
 * as no row at all rather than an empty string, which keeps "never filled in"
 * and "deliberately cleared" the same thing -- they are, for a to-do list.
 *
 * @returns {string} the value actually stored
 */
export function setCell(item, column, rawValue) {
  const value = normaliseValue(column, rawValue);
  transaction(() => {
    if (value === '') clearCell.run(item.id, column.id);
    else upsertCell.run(item.id, column.id, value);
    touchItem.run(item.id);
  });
  return value;
}

/* --------------------------------------------------------------- comments */

export function addComment(itemId, userId, body) {
  const text = String(body ?? '').trim().slice(0, 4000);
  if (!text) return null;
  const id = newId();
  insertComment.run(id, itemId, userId, text);
  touchItem.run(itemId);
  return id;
}

export function commentsFor(itemId) {
  return commentsOn.all(itemId);
}

/** You can delete your own comments and nobody else's. */
export function deleteComment(commentId, userId) {
  deleteCommentRow.run(commentId, userId);
}

/* ---------------------------------------------------------- blocked by */

const insertBlocker = db.prepare(`
  INSERT INTO item_blockers (item_id, blocker_id) VALUES (?, ?)
  ON CONFLICT (item_id, blocker_id) DO NOTHING
`);

const removeBlocker = db.prepare(
  'DELETE FROM item_blockers WHERE item_id = ? AND blocker_id = ?',
);

// What this item is waiting on.
const blockersOfItem = db.prepare(`
  SELECT b.id, b.title, b.group_id
    FROM item_blockers ib
    JOIN items b ON b.id = ib.blocker_id
   WHERE ib.item_id = ? AND b.archived_at IS NULL
   ORDER BY b.position, b.rowid
`);

// What is waiting on this item.
const blockingFromItem = db.prepare(`
  SELECT i.id, i.title
    FROM item_blockers ib
    JOIN items i ON i.id = ib.item_id
   WHERE ib.blocker_id = ? AND i.archived_at IS NULL
   ORDER BY i.position, i.rowid
`);

// Just the ids, for walking the graph.
const blockerIdsOf = db.prepare(
  'SELECT blocker_id FROM item_blockers WHERE item_id = ?',
);

// Every dependency on one board, with each blocker's status value, so the board
// can be drawn in one query rather than one per row.
const blockersOnBoard = db.prepare(`
  SELECT ib.item_id, b.id AS blocker_id, b.title AS blocker_title,
         (SELECT value FROM cells WHERE item_id = b.id AND column_id = ?) AS blocker_status
    FROM item_blockers ib
    JOIN items i ON i.id = ib.item_id
    JOIN items b ON b.id = ib.blocker_id
   WHERE i.board_id = ? AND i.archived_at IS NULL AND b.archived_at IS NULL
   ORDER BY b.position, b.rowid
`);

// Titles only, for the "what should this wait on?" picker.
const titlesOnBoard = db.prepare(`
  SELECT id, title FROM items
   WHERE board_id = ? AND archived_at IS NULL
   ORDER BY position, rowid
`);

/** Every live item on a board, id and title only. */
export function itemsOnBoard(boardId) {
  return titlesOnBoard.all(boardId);
}

/**
 * @param {string} itemId
 * @returns {Array<{ id: string, title: string, group_id: string }>}
 */
export function blockersOf(itemId) {
  return blockersOfItem.all(itemId);
}

/** @param {string} itemId */
export function blockingFrom(itemId) {
  return blockingFromItem.all(itemId);
}

/**
 * Would making `itemId` wait on `blockerId` create a loop?
 *
 * Two items each waiting on the other can never both start, and neither can
 * anything downstream of them -- a knot nobody would spot from the board and
 * nothing in the app would ever complain about. So the graph is walked before
 * the row is written: follow what the proposed blocker is itself waiting on,
 * and if that leads back to the item, refuse.
 *
 * @returns {boolean}
 */
export function wouldLoop(itemId, blockerId) {
  const seen = new Set();
  const queue = [blockerId];

  while (queue.length) {
    const current = queue.pop();
    if (current === itemId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const row of blockerIdsOf.all(current)) queue.push(row.blocker_id);
  }
  return false;
}

export function addBlocker(itemId, blockerId) {
  insertBlocker.run(itemId, blockerId);
}

export function dropBlocker(itemId, blockerId) {
  removeBlocker.run(itemId, blockerId);
}

/**
 * Every dependency on a board, keyed by the item that is waiting.
 *
 * Finished blockers are included rather than filtered out, because the board's
 * Blocked by column shows them struck through -- "this was waiting on the bath,
 * and the bath is done" is more use than showing nothing at all.
 *
 * @param {string} boardId
 * @param {{ id: string } | null} statusColumn the board's status column, if any
 * @param {Set<string>} doneIds label ids that count as finished
 * @returns {Map<string, Array<{ id: string, title: string, finished: boolean }>>}
 */
export function blockersByItem(boardId, statusColumn, doneIds) {
  const out = new Map();

  for (const row of blockersOnBoard.all(statusColumn?.id ?? null, boardId)) {
    if (!out.has(row.item_id)) out.set(row.item_id, []);
    out.get(row.item_id).push({
      id: row.blocker_id,
      title: row.blocker_title,
      // A deleted blocker is already excluded by the query, so the only way to
      // be out of the way is to have reached a finished status.
      finished: Boolean(row.blocker_status && doneIds.has(row.blocker_status)),
    });
  }
  return out;
}

/* ------------------------------------------------------- moving on again */

// Everything currently waiting on one item.
const dependentsOfItem = db.prepare(`
  SELECT i.id FROM item_blockers ib
    JOIN items i ON i.id = ib.item_id
   WHERE ib.blocker_id = ? AND i.archived_at IS NULL
`);

/**
 * Move one item on, if nothing is in its way any more.
 *
 * This is the point of the whole feature: the last thing you were waiting on
 * gets marked Done, and the task that was waiting quietly becomes "Working on
 * it" without anybody having to remember to go and change it.
 *
 * Two things stop it firing. An item already on a finished label is left alone,
 * so being unblocked can never undo a completion. And an item still waiting on
 * something else stays put -- it is only free when every blocker is clear.
 *
 * @returns {boolean} whether it moved
 */
function releaseOne(itemId, statusColumn, settings) {
  const releaseId = settings.unblockedLabelId;
  // Blank means "leave the status alone", which is a legitimate choice.
  if (!releaseId) return false;

  const labels = settings.labels ?? [];
  const doneIds = new Set(labels.filter((label) => label.done).map((label) => label.id));
  if (!doneIds.size) return false;

  const current = cellsOf(itemId)[statusColumn.id] ?? '';
  if (current === releaseId) return false;
  if (doneIds.has(current)) return false;

  // Still waiting on anything else? Then it stays where it is.
  const outstanding = blockersOfItem.all(itemId)
    .some((blocker) => !doneIds.has(cellsOf(blocker.id)[statusColumn.id] ?? ''));
  if (outstanding) return false;

  transaction(() => {
    upsertCell.run(itemId, statusColumn.id, releaseId);
    touchItem.run(itemId);
  });
  return true;
}

/**
 * One item just changed status -- move on anything that was waiting for it.
 *
 * @param {string} blockerId the item whose status changed
 * @param {object|null} statusColumn the board's status column
 * @returns {number} how many items were moved on
 */
export function releaseDependents(blockerId, statusColumn) {
  if (!statusColumn || statusColumn.type !== 'status') return 0;
  const settings = settingsOf(statusColumn);

  let moved = 0;
  for (const dependent of dependentsOfItem.all(blockerId)) {
    if (releaseOne(dependent.id, statusColumn, settings)) moved += 1;
  }
  return moved;
}

/**
 * A dependency was removed by hand -- check whether that frees this item.
 *
 * @returns {boolean}
 */
export function releaseItem(itemId, statusColumn) {
  if (!statusColumn || statusColumn.type !== 'status') return false;
  return releaseOne(itemId, statusColumn, settingsOf(statusColumn));
}

function cleanTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Untitled';
}
