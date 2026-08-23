// Template project. Copy this folder, rename it, and it is live at
// /api/{newname} on the next push -- server.js finds it automatically.

import { Router } from 'express';
import { db } from '../../lib/db.js';

const PROJECT = 'hello';

const store = db(PROJECT, `
  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const router = Router();

// GET /api/hello -> the most recent notes
router.get('/', (req, res) => {
  const notes = store
    .prepare('SELECT id, text, created_at FROM notes ORDER BY id DESC LIMIT 20')
    .all();
  res.json({ project: PROJECT, notes });
});

// POST /api/hello { text } -> save a note
router.post('/', (req, res) => {
  // Validate every field before it reaches the database.
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 280) {
    return res.status(400).json({ error: 'text must be 280 characters or fewer' });
  }

  // Parameterised statement -- never build SQL by string concatenation.
  const result = store.prepare('INSERT INTO notes (text) VALUES (?)').run(text);
  const note = store
    .prepare('SELECT id, text, created_at FROM notes WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json({ note });
});

export default router;
