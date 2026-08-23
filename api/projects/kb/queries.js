// All database access for the knowledge base lives here, so the routes stay
// readable and every statement is parameterised in one place.

import { store } from './schema.js';

const LIVE = 'deleted_at IS NULL';

/* ---------------------------------------------------------------- categories */

export function listCategories() {
  return store.prepare(
    `SELECT c.*, (
       SELECT COUNT(*) FROM entry_categories ec
       JOIN entries e ON e.id = ec.entry_id
       WHERE ec.category_id = c.id AND e.${LIVE}
     ) AS count
     FROM categories c ORDER BY c.position, c.name`
  ).all();
}

export function categoryBySlug(slug) {
  return store.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
}

/** Categories that would be left with orphaned entries if this one went. */
export function entriesOnlyIn(categoryId) {
  return store.prepare(
    `SELECT e.id, e.title FROM entries e
     JOIN entry_categories ec ON ec.entry_id = e.id
     WHERE ec.category_id = ? AND e.${LIVE}
       AND (SELECT COUNT(*) FROM entry_categories x WHERE x.entry_id = e.id) = 1`
  ).all(categoryId);
}

/* ------------------------------------------------------------------- entries */

function decorate(entries) {
  if (!entries.length) return entries;
  const cats = store.prepare(
    `SELECT ec.entry_id, c.* FROM entry_categories ec
     JOIN categories c ON c.id = ec.category_id
     WHERE ec.entry_id = ? ORDER BY c.position`
  );
  const tags = store.prepare(
    `SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id
     WHERE et.entry_id = ? ORDER BY t.name`
  );
  for (const entry of entries) {
    entry.categories = cats.all(entry.id);
    entry.tags = tags.all(entry.id).map((row) => row.name);
  }
  return entries;
}

export function recentEntries(limit = 12) {
  return decorate(store.prepare(
    `SELECT * FROM entries WHERE ${LIVE} ORDER BY updated_at DESC LIMIT ?`
  ).all(limit));
}

export function getEntry(id) {
  const entry = store.prepare(`SELECT * FROM entries WHERE id = ? AND ${LIVE}`).get(id);
  return entry ? decorate([entry])[0] : null;
}

export function entriesInCategory(categoryId) {
  return decorate(store.prepare(
    `SELECT e.* FROM entries e
     JOIN entry_categories ec ON ec.entry_id = e.id
     WHERE ec.category_id = ? AND e.${LIVE}
     ORDER BY e.updated_at DESC`
  ).all(categoryId));
}

export function searchEntries(query) {
  const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  return decorate(store.prepare(
    `SELECT DISTINCT e.* FROM entries e
     LEFT JOIN entry_tags et ON et.entry_id = e.id
     LEFT JOIN tags t ON t.id = et.tag_id
     WHERE e.${LIVE}
       AND (e.title LIKE ? ESCAPE '\\'
            OR e.body LIKE ? ESCAPE '\\'
            OR t.name LIKE ? ESCAPE '\\')
     ORDER BY e.updated_at DESC LIMIT 100`
  ).all(like, like, like));
}

/* ---------------------------------------------------------------------- tags */

/** Tags are lowercased and trimmed so "Reporting" and "reporting" cannot split. */
export function normaliseTags(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  for (const item of raw) {
    const name = String(item).trim().toLowerCase().replace(/\s+/g, ' ');
    if (name && name.length <= 40) seen.add(name);
  }
  return [...seen];
}

export function listTags() {
  return store.prepare(
    `SELECT t.name, COUNT(*) AS count
     FROM tags t
     JOIN entry_tags et ON et.tag_id = t.id
     JOIN entries e ON e.id = et.entry_id AND e.${LIVE}
     GROUP BY t.id ORDER BY count DESC, t.name`
  ).all();
}

export function entriesWithTag(name) {
  return decorate(store.prepare(
    `SELECT e.* FROM entries e
     JOIN entry_tags et ON et.entry_id = e.id
     JOIN tags t ON t.id = et.tag_id
     WHERE t.name = ? AND e.${LIVE}
     ORDER BY e.updated_at DESC`
  ).all(name));
}

function setTags(entryId, names) {
  store.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
  const find = store.prepare('SELECT id FROM tags WHERE name = ?');
  const make = store.prepare('INSERT INTO tags (name) VALUES (?)');
  const link = store.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
  for (const name of names) {
    const tag = find.get(name) || { id: make.run(name).lastInsertRowid };
    link.run(entryId, tag.id);
  }
}

function setCategories(entryId, ids) {
  store.prepare('DELETE FROM entry_categories WHERE entry_id = ?').run(entryId);
  const link = store.prepare(
    'INSERT INTO entry_categories (entry_id, category_id) VALUES (?, ?)'
  );
  const valid = store.prepare('SELECT id FROM categories WHERE id = ?');
  for (const id of ids) {
    if (valid.get(id)) link.run(entryId, id);
  }
}

/* --------------------------------------------------------------------- write */

export function createEntry({ title, body, status, link, categoryIds, tags }) {
  const result = store.prepare(
    'INSERT INTO entries (title, body, status, link) VALUES (?, ?, ?, ?)'
  ).run(title, body, status, link);
  const id = Number(result.lastInsertRowid);
  setCategories(id, categoryIds);
  setTags(id, tags);
  return id;
}

export function updateEntry(id, { title, body, status, link, categoryIds, tags }) {
  store.prepare(
    `UPDATE entries SET title = ?, body = ?, status = ?, link = ?,
     updated_at = datetime('now') WHERE id = ?`
  ).run(title, body, status, link, id);
  setCategories(id, categoryIds);
  setTags(id, tags);
}

/** Hidden rather than destroyed, so a mis-tap is recoverable. */
export function softDeleteEntry(id) {
  store.prepare(
    `UPDATE entries SET deleted_at = datetime('now') WHERE id = ?`
  ).run(id);
}
