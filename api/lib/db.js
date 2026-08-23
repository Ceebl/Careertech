// Per-project SQLite storage.
//
// Each project gets its own database file. That separation is what keeps a
// project cheap to extract into its own container later -- there are no shared
// tables to untangle, just one file to move.
//
// Uses node:sqlite (built into Node 22.5+), so there is no native dependency
// and nothing to compile at image build time.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const open = new Map(); // project name -> DatabaseSync

/**
 * Open (or reuse) the database belonging to one project.
 *
 * @param {string} project  Project name; must match the folder under projects/.
 * @param {string} [schema] SQL run once on open, e.g. CREATE TABLE IF NOT EXISTS.
 * @returns {DatabaseSync}
 */
export function db(project, schema) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(project)) {
    throw new Error(`invalid project name: ${project}`);
  }
  if (open.has(project)) return open.get(project);

  mkdirSync(DATA_DIR, { recursive: true });
  const handle = new DatabaseSync(join(DATA_DIR, `${project}.db`));

  // WAL survives an unclean container stop far better than the default journal.
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA foreign_keys = ON');
  if (schema) handle.exec(schema);

  open.set(project, handle);
  return handle;
}
