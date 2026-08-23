// Knowledge base. Serves its own pages at /kb so every request passes the
// login check before any content reaches the browser.

import express, { Router } from 'express';
import {
  session, logIn, logOut, requireReader, requireAdmin,
  throttleLogin, recordFailure, clearFailures, configured,
} from './auth.js';
import { esc, cleanHtml } from './sanitize.js';
import { STATUSES } from './schema.js';
import {
  layout, entryList, categoryChip, statusChip, tagChip,
} from './views.js';
import {
  listCategories, categoryBySlug, recentEntries, getEntry,
  entriesInCategory, searchEntries, listTags, entriesWithTag,
  normaliseTags, createEntry, updateEntry, softDeleteEntry,
} from './queries.js';
import { makeBackup, startBackups } from './backup.js';

export const mountPath = '/kb';

const router = Router();
router.use(express.urlencoded({ extended: false, limit: '2mb' }));
router.use(session);

startBackups();

/* --------------------------------------------------------------------- login */

function loginPage(req, error = '') {
  const next = typeof req.query.next === 'string' ? req.query.next : '/kb/';
  return layout({
    title: 'Sign in',
    kb: null,
    body: `<div class="login-wrap">
      <h1>Knowledge Base</h1>
      <p class="lede">Enter the password to continue.</p>
      ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
      <form method="post" action="/kb/login" class="editor">
        <input type="hidden" name="next" value="${esc(next)}">
        <label class="field">Password
          <input type="password" name="password" autofocus required
                 autocomplete="current-password">
        </label>
        <button class="btn primary" type="submit">Sign in</button>
      </form>
    </div>`,
  });
}

router.get('/login', (req, res) => {
  if (req.kb.isReader) return res.redirect('/kb/');
  res.send(loginPage(req));
});

router.post('/login', throttleLogin, (req, res) => {
  if (!configured) {
    return res.status(503).send(loginPage(req, 'No passwords are configured on the server yet.'));
  }
  const role = logIn(req, res, req.body?.password ?? '');
  if (!role) {
    recordFailure(req);
    return res.status(401).send(loginPage(req, 'That password was not recognised.'));
  }
  clearFailures(req);
  const next = typeof req.body?.next === 'string' && req.body.next.startsWith('/kb')
    ? req.body.next
    : '/kb/';
  res.redirect(next);
});

router.get('/logout', (req, res) => {
  logOut(req, res);
  res.redirect('/kb/login');
});

/* ------------------------------------------------------------------ browsing */

router.use(requireReader);

router.get('/', (req, res) => {
  const categories = listCategories();
  const recent = recentEntries(8);

  const tiles = categories.map((cat) => `
    <a class="tile" href="/kb/c/${esc(cat.slug)}" style="--dot:${esc(cat.colour)}">
      <div class="name">${esc(cat.emoji)} ${esc(cat.name)}</div>
      <div class="desc">${esc(cat.description)}</div>
      <div class="count">${cat.count} ${cat.count === 1 ? 'entry' : 'entries'}</div>
    </a>`).join('');

  res.send(layout({
    title: 'Knowledge Base',
    kb: req.kb,
    body: `<h1>Knowledge Base</h1>
      <p class="lede">TargetConnect reference, gaps, issues and updates.</p>
      <div class="tiles">${tiles}</div>
      <h2>Recently updated</h2>
      ${entryList(recent, 'No entries yet. Add the first one.')}`,
  }));
});

router.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const results = q ? searchEntries(q) : [];
  res.send(layout({
    title: q ? `Search: ${q}` : 'Search',
    kb: req.kb,
    search: q,
    body: `<h1>Search</h1>
      <p class="lede">${q
        ? `${results.length} result${results.length === 1 ? '' : 's'} for &ldquo;${esc(q)}&rdquo;`
        : 'Type in the box above to search titles, content and tags.'}</p>
      ${q ? entryList(results, 'Nothing matched that.') : ''}`,
  }));
});

router.get('/c/:slug', (req, res) => {
  const cat = categoryBySlug(req.params.slug);
  if (!cat) return res.status(404).send(notFound(req));
  const entries = entriesInCategory(cat.id);
  res.send(layout({
    title: cat.name,
    kb: req.kb,
    body: `<h1>${esc(cat.emoji)} ${esc(cat.name)}</h1>
      <p class="lede">${esc(cat.description)}</p>
      ${entryList(entries, 'Nothing in this category yet.')}`,
  }));
});

router.get('/tags', (req, res) => {
  const tags = listTags();
  res.send(layout({
    title: 'Tags',
    kb: req.kb,
    body: `<h1>Tags</h1>
      <p class="lede">${tags.length} tag${tags.length === 1 ? '' : 's'} in use.</p>
      ${tags.length
        ? `<div class="meta">${tags.map((t) =>
            `<a class="chip" href="/kb/tag/${encodeURIComponent(t.name)}">#${esc(t.name)} &middot; ${t.count}</a>`
          ).join('')}</div>`
        : '<p class="empty">No tags yet.</p>'}`,
  }));
});

router.get('/tag/:name', (req, res) => {
  const name = String(req.params.name).toLowerCase();
  const entries = entriesWithTag(name);
  res.send(layout({
    title: `#${name}`,
    kb: req.kb,
    body: `<h1>#${esc(name)}</h1>
      <p class="lede">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} tagged.</p>
      ${entryList(entries, 'Nothing carries this tag.')}`,
  }));
});

router.get('/entry/:id', (req, res) => {
  const entry = getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send(notFound(req));

  const admin = req.kb.isAdmin ? `
    <div class="actions">
      <a class="btn" href="/kb/entry/${entry.id}/edit">Edit</a>
      <form method="post" action="/kb/entry/${entry.id}/delete"
            onsubmit="return confirm('Delete this entry?')">
        <button class="btn danger" type="submit">Delete</button>
      </form>
    </div>` : '';

  res.send(layout({
    title: entry.title,
    kb: req.kb,
    body: `<h1>${esc(entry.title)}</h1>
      <div class="meta">
        ${entry.categories.map(categoryChip).join('')}
        ${statusChip(entry.status)}
        ${entry.tags.map(tagChip).join('')}
      </div>
      ${entry.link ? `<p class="lede" style="margin-top:1rem">
        <a href="${esc(entry.link)}" rel="noopener noreferrer" target="_blank">${esc(entry.link)}</a></p>` : ''}
      <article class="body">${cleanHtml(entry.body)}</article>
      <p class="lede" style="margin-top:2rem;font-size:.85rem">
        Added ${esc(entry.created_at)} &middot; updated ${esc(entry.updated_at)}</p>
      ${admin}`,
  }));
});

/* -------------------------------------------------------------------- editing */

function entryForm(req, { entry = null, error = '' } = {}) {
  const categories = listCategories();
  const chosen = new Set((entry?.categories ?? []).map((c) => c.id));
  const allTags = listTags();

  const checks = categories.map((cat) => `
    <label style="border-color:${esc(cat.colour)}55">
      <input type="checkbox" name="categories" value="${cat.id}"
             ${chosen.has(cat.id) ? 'checked' : ''}>
      <span>${esc(cat.emoji)} ${esc(cat.name)}</span>
    </label>`).join('');

  const statusOptions = STATUSES.map((s) => `
    <option value="${esc(s)}" ${entry?.status === s ? 'selected' : ''}>
      ${s === '' ? 'None' : s[0].toUpperCase() + s.slice(1)}
    </option>`).join('');

  return layout({
    title: entry ? `Edit: ${entry.title}` : 'New entry',
    kb: req.kb,
    body: `<h1>${entry ? 'Edit entry' : 'New entry'}</h1>
      ${error ? `<p class="notice error">${esc(error)}</p>` : ''}
      <form method="post" class="editor"
            action="${entry ? `/kb/entry/${entry.id}/edit` : '/kb/new'}">
        <label class="field">Title
          <input type="text" name="title" required maxlength="200"
                 value="${esc(entry?.title ?? '')}" autofocus>
        </label>

        <div class="field">Categories <span class="hint">Pick at least one</span>
          <div class="checks">${checks}</div>
        </div>

        <label class="field">Content
          <span class="hint">HTML is allowed, including iframes. Script tags are removed.</span>
          <textarea name="body">${esc(entry?.body ?? '')}</textarea>
        </label>

        <label class="field">Tags
          <span class="hint">Comma separated. Lowercased automatically.</span>
          <input type="text" name="tags" list="known-tags"
                 value="${esc((entry?.tags ?? []).join(', '))}">
          <datalist id="known-tags">
            ${allTags.map((t) => `<option value="${esc(t.name)}"></option>`).join('')}
          </datalist>
        </label>

        <label class="field">Status
          <select name="status">${statusOptions}</select>
        </label>

        <label class="field">Link <span class="hint">Optional</span>
          <input type="url" name="link" value="${esc(entry?.link ?? '')}"
                 placeholder="https://...">
        </label>

        <div class="actions">
          <button class="btn primary" type="submit">${entry ? 'Save changes' : 'Create entry'}</button>
          <a class="btn" href="${entry ? `/kb/entry/${entry.id}` : '/kb/'}">Cancel</a>
        </div>
      </form>`,
  });
}

function readForm(body) {
  const raw = body?.categories;
  const categoryIds = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map(Number).filter(Number.isInteger);
  const link = String(body?.link ?? '').trim();

  return {
    title: String(body?.title ?? '').trim().slice(0, 200),
    body: cleanHtml(String(body?.body ?? '')),
    status: STATUSES.includes(body?.status) ? body.status : '',
    link: /^https?:\/\//i.test(link) ? link.slice(0, 500) : '',
    categoryIds,
    tags: normaliseTags(body?.tags),
  };
}

function validate(fields) {
  if (!fields.title) return 'A title is required.';
  if (!fields.categoryIds.length) return 'Pick at least one category.';
  return '';
}

router.get('/new', requireAdmin, (req, res) => res.send(entryForm(req)));

router.post('/new', requireAdmin, (req, res) => {
  const fields = readForm(req.body);
  const error = validate(fields);
  if (error) return res.status(400).send(entryForm(req, { error }));
  res.redirect(`/kb/entry/${createEntry(fields)}`);
});

router.get('/entry/:id/edit', requireAdmin, (req, res) => {
  const entry = getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send(notFound(req));
  res.send(entryForm(req, { entry }));
});

router.post('/entry/:id/edit', requireAdmin, (req, res) => {
  const entry = getEntry(Number(req.params.id));
  if (!entry) return res.status(404).send(notFound(req));

  const fields = readForm(req.body);
  const error = validate(fields);
  if (error) {
    return res.status(400).send(entryForm(req, { entry: { ...entry, ...fields }, error }));
  }
  updateEntry(entry.id, fields);
  res.redirect(`/kb/entry/${entry.id}`);
});

router.post('/entry/:id/delete', requireAdmin, (req, res) => {
  softDeleteEntry(Number(req.params.id));
  res.redirect('/kb/');
});

/* -------------------------------------------------------------------- backup */

router.get('/backup', requireAdmin, (req, res) => {
  const file = makeBackup();
  if (!file) return res.status(500).send('Backup failed. Check the server logs.');
  res.download(file, `knowledge-base-${new Date().toISOString().slice(0, 10)}.db`);
});

/* --------------------------------------------------------------------- misc */

function notFound(req) {
  return layout({
    title: 'Not found',
    kb: req.kb,
    body: '<h1>Not found</h1><p class="lede">That page does not exist. <a href="/kb/">Back to the start</a>.</p>',
  });
}

router.use((req, res) => res.status(404).send(notFound(req)));

export default router;
