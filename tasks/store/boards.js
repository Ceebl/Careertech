// Boards, their groups, and their columns.

import { db, transaction } from '../lib/db.js';
import { newId } from '../lib/ids.js';
import { TYPES, isType, normaliseSettings, PALETTE, paletteColour } from '../lib/columns.js';

const insertBoard = db.prepare(`
  INSERT INTO boards (id, workspace_id, name, description, position)
  VALUES (?, ?, ?, ?, ?)
`);

const insertGroup = db.prepare(`
  INSERT INTO board_groups (id, board_id, name, colour, position) VALUES (?, ?, ?, ?, ?)
`);

const insertColumn = db.prepare(`
  INSERT INTO board_columns (id, board_id, name, type, settings, position)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const boardsIn = db.prepare(`
  SELECT b.id, b.name, b.description, b.position, b.created_at,
         (SELECT COUNT(*) FROM items i
           WHERE i.board_id = b.id AND i.archived_at IS NULL) AS item_count
    FROM boards b
   WHERE b.workspace_id = ? AND b.archived_at IS NULL
   ORDER BY b.position, b.name COLLATE NOCASE
`);

const groupsIn = db.prepare(
  'SELECT * FROM board_groups WHERE board_id = ? ORDER BY position, rowid',
);

const columnsIn = db.prepare(
  'SELECT * FROM board_columns WHERE board_id = ? ORDER BY position, rowid',
);

const nextBoardPosition = db.prepare(
  'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM boards WHERE workspace_id = ?',
);
const nextGroupPosition = db.prepare(
  'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM board_groups WHERE board_id = ?',
);
const nextColumnPosition = db.prepare(
  'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM board_columns WHERE board_id = ?',
);

const renameBoardRow = db.prepare('UPDATE boards SET name = ?, description = ? WHERE id = ?');
const archiveBoardRow = db.prepare("UPDATE boards SET archived_at = datetime('now') WHERE id = ?");
const renameGroupRow = db.prepare('UPDATE board_groups SET name = ?, colour = ? WHERE id = ?');
const deleteGroupRow = db.prepare('DELETE FROM board_groups WHERE id = ?');
const countGroups = db.prepare('SELECT COUNT(*) AS n FROM board_groups WHERE board_id = ?');
const renameColumnRow = db.prepare('UPDATE board_columns SET name = ?, settings = ? WHERE id = ?');
const deleteColumnRow = db.prepare('DELETE FROM board_columns WHERE id = ?');

/**
 * Create a board, ready to use.
 *
 * A brand new board with no groups and no columns is not a board, it is a
 * puzzle. So it arrives the way monday.com does: two groups and a status
 * column, all of them renameable.
 */
export function createBoard({ workspaceId, name, description = '' }) {
  return transaction(() => {
    const id = newId();
    insertBoard.run(
      id,
      workspaceId,
      cleanName(name, 'Untitled board'),
      String(description ?? '').trim().slice(0, 300),
      nextBoardPosition.get(workspaceId).next,
    );

    insertGroup.run(newId(), id, 'To do', '#496DDB', 0);
    insertGroup.run(newId(), id, 'Done', '#3E8E5F', 1);

    const status = TYPES.status.defaultSettings();
    insertColumn.run(newId(), id, 'Status', 'status', JSON.stringify(status), 0);
    insertColumn.run(newId(), id, 'Owner', 'person', '{}', 1);
    insertColumn.run(newId(), id, 'Due', 'date', '{}', 2);

    return id;
  });
}

export function boardsInWorkspace(workspaceId) {
  return boardsIn.all(workspaceId);
}

export function groupsOf(boardId) {
  return groupsIn.all(boardId);
}

export function columnsOf(boardId) {
  return columnsIn.all(boardId);
}

export function renameBoard(boardId, name, description) {
  renameBoardRow.run(
    cleanName(name, 'Untitled board'),
    String(description ?? '').trim().slice(0, 300),
    boardId,
  );
}

export function archiveBoard(boardId) {
  archiveBoardRow.run(boardId);
}

/* ------------------------------------------------------------------ groups */

export function addGroup(boardId, name, colour) {
  const id = newId();
  const position = nextGroupPosition.get(boardId).next;
  insertGroup.run(
    id,
    boardId,
    cleanName(name, 'New group'),
    paletteColour(colour, PALETTE[position % PALETTE.length]),
    position,
  );
  return id;
}

export function renameGroup(groupId, name, colour) {
  renameGroupRow.run(cleanName(name, 'Group'), paletteColour(colour, '#496DDB'), groupId);
}

/**
 * Delete a group and everything in it.
 *
 * Refused if it is the last one, because items have to live somewhere and a
 * board with no groups has nowhere to put the next thing you add.
 */
export function deleteGroup(boardId, groupId) {
  return transaction(() => {
    if (countGroups.get(boardId).n <= 1) return false;
    deleteGroupRow.run(groupId);
    return true;
  });
}

/* ----------------------------------------------------------------- columns */

export function addColumn(boardId, { name, type }) {
  if (!isType(type)) return null;
  const id = newId();
  insertColumn.run(
    id,
    boardId,
    cleanName(name, TYPES[type].label),
    type,
    JSON.stringify(TYPES[type].defaultSettings()),
    nextColumnPosition.get(boardId).next,
  );
  return id;
}

/**
 * Rename a column and update its settings.
 * The type is deliberately fixed once created -- changing it would leave every
 * existing cell holding a value that means nothing.
 */
export function updateColumn(column, { name, settings }) {
  renameColumnRow.run(
    cleanName(name, column.name),
    JSON.stringify(normaliseSettings(column.type, settings)),
    column.id,
  );
}

const setColumnPosition = db.prepare('UPDATE board_columns SET position = ? WHERE id = ?');

/**
 * Shuffle a column one place left or right.
 *
 * Every position on the board is rewritten rather than just swapping two, so
 * the order is renumbered 0,1,2,... each time. Positions can otherwise drift
 * into duplicates and gaps -- a column added while another was being deleted,
 * say -- and once two columns share a position the order they come back in is
 * whatever SQLite feels like.
 *
 * @param {{ id: string, board_id: string }} column
 * @param {'left'|'right'} direction
 * @returns {boolean} false if it is already at that end
 */
export function moveColumn(column, direction) {
  return transaction(() => {
    const columns = columnsIn.all(column.board_id);
    const from = columns.findIndex((candidate) => candidate.id === column.id);
    const to = from + (direction === 'left' ? -1 : 1);

    if (from < 0 || to < 0 || to >= columns.length) return false;

    const reordered = [...columns];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    reordered.forEach((moved, index) => setColumnPosition.run(index, moved.id));
    return true;
  });
}

/** Deleting a column takes its cells with it, via the foreign key. */
export function deleteColumn(columnId) {
  deleteColumnRow.run(columnId);
}

function cleanName(value, fallback) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}
