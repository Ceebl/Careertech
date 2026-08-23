// Database shape for the knowledge base.
//
// Entries belong to MANY categories and MANY tags. Categories are a curated
// set you manage; tags are free-form. Both are proper tables rather than
// comma-separated text, so counting and browsing stay simple.

import { db } from '../../lib/db.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    emoji       TEXT    NOT NULL DEFAULT '',
    colour      TEXT    NOT NULL DEFAULT '#6b7280',
    description TEXT    NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT '',
    link       TEXT NOT NULL DEFAULT '',
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entry_categories (
    entry_id    INTEGER NOT NULL REFERENCES entries(id)    ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(deleted_at);
`;

// Seeded on first run only. After that they are yours to edit.
const DEFAULT_CATEGORIES = [
  ['kb-gaps',    'Knowledge Base Gaps', '🟠', '#f97316', 'Areas where documentation is missing or incomplete'],
  ['updates',    'Updates',             '🟢', '#22c55e', 'Latest changes, improvements, and announcements'],
  ['product-gaps', 'Product Gaps',      '🟡', '#eab308', 'Features or functionality that need attention'],
  ['known-issues', 'Known Issues',      '🔴', '#ef4444', 'Bugs, limitations, and workarounds'],
  ['code',       'Code',                '🔵', '#3b82f6', 'Code snippets, technical references, and implementation guides'],
  ['sales',      'Sales & Marketing',   '🟣', '#a855f7', 'Go-to-market materials, positioning, and resources'],
  ['data',       'Data / Reporting',    '🩷', '#ec4899', 'Analytics, dashboards, and reporting documentation'],
];

export const store = db('kb', SCHEMA);

const existing = store.prepare('SELECT COUNT(*) AS n FROM categories').get();
if (existing.n === 0) {
  const insert = store.prepare(
    `INSERT INTO categories (slug, name, emoji, colour, description, position)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  DEFAULT_CATEGORIES.forEach((row, i) => insert.run(...row, i));
  console.log(`kb: seeded ${DEFAULT_CATEGORIES.length} categories`);
}

export const STATUSES = ['', 'open', 'resolved'];
