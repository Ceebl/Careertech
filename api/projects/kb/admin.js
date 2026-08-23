// Admin-only pages: managing categories, and the recycle bin.
// Kept separate so the main router stays about reading and writing entries.

import { Router } from 'express';
import { esc } from './sanitize.js';
import { layout } from './views.js';
import {
  listCategories, entriesOnlyIn, getCategory, createCategory,
  updateCategory, moveCategory, deleteCategory,
  deletedEntries, restoreEntry, purgeEntry,
} from './queries.js';
import { streamMarkdownExport } from './export.js';

const router = Router();

/* ------------------------------------------------------------- categories */

function categoriesPage(req, notice = '', isError = false) {
  const categories = listCategories();

  const rows = categories.map((cat, i) => `
    <div class="cat">
      <form method="post" action="/kb/admin/categories/${cat.id}/edit" class="cat-row">
        <input type="text" name="emoji" value="${esc(cat.emoji)}" maxlength="4"
               class="cat-emoji" aria-label="Emoji for ${esc(cat.name)}">
        <input type="color" name="colour" value="${esc(cat.colour)}"
               class="cat-colour" aria-label="Colour for ${esc(cat.name)}">
        <input type="text" name="name" value="${esc(cat.name)}" required maxlength="60"
               aria-label="Name">
        <input type="text" name="description" value="${esc(cat.description)}"
               maxlength="200" placeholder="Description" aria-label="Description">
        <button class="btn" type="submit">Save</button>
      </form>
      <div class="cat-tools">
        <span class="hint">/kb/c/${esc(cat.slug)} &middot; ${cat.count} ${cat.count === 1 ? 'entry' : 'entries'}</span>
        <form method="post" action="/kb/admin/categories/${cat.id}/move">
          <input type="hidden" name="direction" value="up">
          <button class="btn" type="submit" ${i === 0 ? 'disabled' : ''}
                  title="Move up" aria-label="Move ${esc(cat.name)} up">&uarr;</button>
        </form>
        <form method="post" action="/kb/admin/categories/${cat.id}/move">
          <input type="hidden" name="direction" value="down">
          <button class="btn" type="submit" ${i === categories.length - 1 ? 'disabled' : ''}
                  title="Move down" aria-label="Move ${esc(cat.name)} down">&darr;</button>
        </form>
        <form method="post" action="/kb/admin/categories/${cat.id}/delete"
              onsubmit="return confirm('Delete this category?')">
          <button class="btn danger" type="submit">Delete</button>
        </form>
      </div>
    </div>`).join('');

  return layout({
    title: 'Categories',
    kb: req.kb,
    body: `<h1>Categories</h1>
      <p class="lede">Renaming keeps the existing web address, so links and bookmarks
        that already point at a category keep working.</p>
      ${notice ? `<p class="notice ${isError ? 'error' : ''}">${esc(notice)}</p>` : ''}
      <div class="cat-list">${rows}</div>

      <h2>Add a category</h2>
      <form method="post" action="/kb/admin/categories/new" class="cat-row">
        <input type="text" name="emoji" value="&#9899;" maxlength="4"
               class="cat-emoji" aria-label="Emoji">
        <input type="color" name="colour" value="#6b7280" class="cat-colour" aria-label="Colour">
        <input type="text" name="name" required maxlength="60" placeholder="Name" aria-label="Name">
        <input type="text" name="description" maxlength="200"
               placeholder="Description" aria-label="Description">
        <button class="btn primary" type="submit">Add</button>
      </form>`,
  });
}

function readCategoryForm(body) {
  const colour = String(body?.colour ?? '').trim();
  return {
    name: String(body?.name ?? '').trim().slice(0, 60),
    emoji: String(body?.emoji ?? '').trim().slice(0, 4),
    colour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#6b7280',
    description: String(body?.description ?? '').trim().slice(0, 200),
  };
}

router.get('/categories', (req, res) => res.send(categoriesPage(req)));

router.post('/categories/new', (req, res) => {
  const fields = readCategoryForm(req.body);
  if (!fields.name) {
    return res.status(400).send(categoriesPage(req, 'A name is required.', true));
  }
  createCategory(fields);
  res.redirect('/kb/admin/categories');
});

router.post('/categories/:id/edit', (req, res) => {
  const cat = getCategory(Number(req.params.id));
  if (!cat) return res.status(404).send(categoriesPage(req, 'That category no longer exists.', true));

  const fields = readCategoryForm(req.body);
  if (!fields.name) {
    return res.status(400).send(categoriesPage(req, 'A name is required.', true));
  }
  updateCategory(cat.id, fields);
  res.redirect('/kb/admin/categories');
});

router.post('/categories/:id/move', (req, res) => {
  moveCategory(Number(req.params.id), req.body?.direction === 'up' ? 'up' : 'down');
  res.redirect('/kb/admin/categories');
});

// Refused when it would leave an entry with no category at all. An entry that
// also sits in another category is fine -- it still has somewhere to live.
router.post('/categories/:id/delete', (req, res) => {
  const cat = getCategory(Number(req.params.id));
  if (!cat) return res.status(404).send(categoriesPage(req, 'That category no longer exists.', true));

  const stranded = entriesOnlyIn(cat.id);
  if (stranded.length) {
    const names = stranded.slice(0, 4).map((e) => e.title).join(', ');
    const more = stranded.length > 4 ? `, and ${stranded.length - 4} more` : '';
    return res.status(409).send(categoriesPage(req,
      `Cannot delete "${cat.name}". It is the only category on ${stranded.length} ` +
      `entr${stranded.length === 1 ? 'y' : 'ies'}: ${names}${more}. ` +
      'Give those another category first, then try again.',
      true));
  }

  deleteCategory(cat.id);
  res.redirect('/kb/admin/categories');
});

/* ------------------------------------------------------------ recycle bin */

router.get('/deleted', (req, res) => {
  const entries = deletedEntries();

  const rows = entries.map((entry) => `
    <div class="item">
      <div class="title">${esc(entry.title)}</div>
      <div class="snippet">Deleted ${esc(entry.deleted_at)} UTC</div>
      <div class="actions" style="margin-top:.75rem">
        <form method="post" action="/kb/admin/entry/${entry.id}/restore">
          <button class="btn primary" type="submit">Restore</button>
        </form>
        <form method="post" action="/kb/admin/entry/${entry.id}/purge"
              onsubmit="return confirm('Delete permanently? This cannot be undone.')">
          <button class="btn danger" type="submit">Delete for good</button>
        </form>
      </div>
    </div>`).join('');

  res.send(layout({
    title: 'Recently deleted',
    kb: req.kb,
    body: `<h1>Recently deleted</h1>
      <p class="lede">Deleted entries are kept here until you remove them for good.</p>
      ${entries.length
        ? `<div class="list">${rows}</div>`
        : '<p class="empty">Nothing deleted.</p>'}`,
  }));
});

router.post('/entry/:id/restore', (req, res) => {
  const id = Number(req.params.id);
  restoreEntry(id);
  res.redirect(`/kb/entry/${id}`);
});

router.post('/entry/:id/purge', (req, res) => {
  purgeEntry(Number(req.params.id));
  res.redirect('/kb/admin/deleted');
});

/* ---------------------------------------------------------------- export */

// Markdown copy of everything, images included, for reading or importing
// elsewhere. Distinct from the backup, which is for restoring this site.
router.get('/export', (req, res) => {
  streamMarkdownExport(res, (err) => {
    console.error('kb: export failed:', err);
    if (!res.headersSent) res.status(500).send(`Export failed: ${err.message}`);
  });
});

export default router;
