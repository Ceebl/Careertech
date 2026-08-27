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
migrate();

export { DATA_DIR };

/**
 * Add columns that the schema gained after a database was first created.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so a
 * new column in SCHEMA above reaches a fresh database and no other. Each entry
 * here is checked against the table as it actually is and added only if it is
 * missing, which makes running this on every start safe and makes the schema
 * the single description of the shape.
 *
 * Only additive changes belong here. Anything that drops or rewrites a column
 * needs a considered migration and a backup first.
 */
function migrate() {
  const additions = [
    // Subitems, added 2026-08-27.
    { table: 'items', column: 'parent_id', definition: 'TEXT REFERENCES items(id) ON DELETE CASCADE' },
  ];

  for (const { table, column, definition } of additions) {
    // PRAGMA and ALTER TABLE cannot take bound parameters for an identifier, so
    // these are the only statements in the app built by interpolation. Every
    // value comes from the fixed list above rather than from a request, and the
    // pattern check makes that a rule the code enforces rather than a habit.
    if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(column)) {
      throw new Error(`unsafe migration identifier: ${table}.${column}`);
    }

    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!existing.length) continue; // table not created yet; SCHEMA will have it
    if (existing.some((row) => row.name === column)) continue;

    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`tasks: added ${table}.${column}`);
  }

  // Indexes on migrated columns have to wait until the columns exist, so they
  // live here rather than in SCHEMA -- on an older database SCHEMA runs first
  // and would be indexing a column that is not there yet.
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id, position)');
}

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
