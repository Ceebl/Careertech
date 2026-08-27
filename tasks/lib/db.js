// The one database handle, opened once and reused.
//
// Deliberately separate from api/lib/db.js: this app runs in its own container
// and its file lives on its own volume, so there is no shared code and no
// shared data with anything else on the box.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA } from './schema.js';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'tasks.db'));

// WAL survives an unclean container stop far better than the default journal.
db.exec('PRAGMA journal_mode = WAL');
// Without this SQLite accepts orphan rows happily. With it, deleting a board
// really does take its groups, columns, items and cells with it.
db.exec('PRAGMA foreign_keys = ON');
// Wait rather than fail if another statement holds the write lock.
db.exec('PRAGMA busy_timeout = 5000');

db.exec(SCHEMA);

export { DATA_DIR };

/**
 * Run several statements as one all-or-nothing unit.
 *
 * Creating a board writes to four tables. Half a board is worse than no board,
 * so anything that writes more than one row goes through here.
 *
 * @template T
 * @param {() => T} work
 * @returns {T}
 */
export function transaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}
