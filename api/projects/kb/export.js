// Markdown export.
//
// Produces a .tar.gz holding one Markdown file per entry, an index, and every
// image the entries reference -- with image links rewritten to relative paths.
// A bare .md would point at /kb/file/... which sits behind the login, so the
// pictures would be broken everywhere except this site.
//
// The result imports cleanly into Obsidian, Notion and anything else that
// reads Markdown with front matter.

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { store } from './schema.js';
import { UPLOAD_DIR } from './uploads.js';

/* ------------------------------------------------------- html to markdown */

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
};

function decode(text) {
  return String(text).replace(
    /&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash);/gi,
    (m) => ENTITIES[m.toLowerCase()] ?? m
  );
}

/**
 * Convert entry HTML to Markdown.
 *
 * Handles what the editor produces. Anything it does not recognise is left as
 * raw HTML, which Markdown permits -- so unusual content (tables, embedded
 * iframes) survives the trip even though it stays as HTML.
 */
export function toMarkdown(html) {
  let out = String(html || '').replace(/\r\n/g, '\n');

  // Park code blocks first so their contents are never treated as markup.
  const parked = [];
  out = out.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
    const code = decode(inner.replace(/<\/?code[^>]*>/gi, '').replace(/<[^>]+>/g, ''));
    parked.push('```\n' + code.replace(/\n+$/, '') + '\n```');
    return `\u0000${parked.length - 1}\u0000`;
  });

  out = out
    .replace(/<br\s*\/?>/gi, '  \n')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${inline(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${inline(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${inline(t)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${inline(t)}\n`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) =>
      '\n' + inline(t).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n')
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items) => '\n' + listItems(items, false) + '\n')
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items) => '\n' + listItems(items, true) + '\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${inline(t)}\n`)
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, t) => `\n${inline(t)}\n`);

  out = inline(out);

  // Collapse the blank lines all those replacements leave behind.
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => parked[Number(i)]);
}

function listItems(html, ordered) {
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  return items
    .map((m, i) => {
      // Numbered properly rather than all "1." -- renderers cope either way,
      // but the raw file is meant to be readable on its own.
      const marker = ordered ? `${i + 1}.` : '-';
      return `${marker} ${inline(m[1]).trim().replace(/\n/g, ' ')}`;
    })
    .join('\n');
}

/** Inline formatting: emphasis, links, images, code spans. */
function inline(html) {
  return decode(
    String(html)
      .replace(/<img[^>]*?src="([^"]*)"[^>]*?alt="([^"]*)"[^>]*>/gi, '![$2]($1)')
      .replace(/<img[^>]*?alt="([^"]*)"[^>]*?src="([^"]*)"[^>]*>/gi, '![$1]($2)')
      .replace(/<img[^>]*?src="([^"]*)"[^>]*>/gi, '![]($1)')
      .replace(/<a[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<\/?(span|font)[^>]*>/gi, '')
  );
}

/* -------------------------------------------------------------- filenames */

function slugify(title, id) {
  const base = String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'entry';
  return `${String(id).padStart(4, '0')}-${base}.md`;
}

function frontMatter(entry) {
  const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const lines = [
    '---',
    `title: ${quote(entry.title)}`,
    `categories: [${entry.categories.map((c) => quote(c.name)).join(', ')}]`,
    `tags: [${entry.tags.map(quote).join(', ')}]`,
  ];
  if (entry.status) lines.push(`status: ${entry.status}`);
  if (entry.link) lines.push(`link: ${quote(entry.link)}`);
  lines.push(`created: ${entry.created_at}`, `updated: ${entry.updated_at}`, '---', '');
  return lines.join('\n');
}

/* ----------------------------------------------------------------- bundle */

/** Build the export in a temporary folder and return its path. */
function build() {
  const root = mkdtempSync(join(tmpdir(), 'kb-export-'));
  mkdirSync(join(root, 'entries'));
  mkdirSync(join(root, 'images'));

  const entries = store.prepare(
    'SELECT * FROM entries WHERE deleted_at IS NULL ORDER BY id'
  ).all();
  const cats = store.prepare(
    `SELECT c.name FROM entry_categories ec JOIN categories c ON c.id = ec.category_id
     WHERE ec.entry_id = ? ORDER BY c.position`
  );
  const tags = store.prepare(
    `SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id
     WHERE et.entry_id = ? ORDER BY t.name`
  );

  const wanted = new Set();
  const byCategory = new Map();

  for (const entry of entries) {
    entry.categories = cats.all(entry.id);
    entry.tags = tags.all(entry.id).map((r) => r.name);

    let body = toMarkdown(entry.body);

    // Point image links at the copies travelling with this archive.
    body = body.replace(/\/kb\/file\/([0-9a-f]{32}\.(?:png|jpg|gif|webp))/g, (_, name) => {
      wanted.add(name);
      return `../images/${name}`;
    });

    const file = slugify(entry.title, entry.id);
    writeFileSync(join(root, 'entries', file), frontMatter(entry) + body + '\n', 'utf8');

    for (const cat of entry.categories) {
      if (!byCategory.has(cat.name)) byCategory.set(cat.name, []);
      byCategory.get(cat.name).push({ title: entry.title, file });
    }
  }

  for (const name of wanted) {
    const from = join(UPLOAD_DIR, name);
    if (existsSync(from)) copyFileSync(from, join(root, 'images', name));
  }

  const index = ['# Knowledge Base', '',
    `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, exported ${new Date().toISOString().slice(0, 10)}.`,
    ''];
  for (const [category, items] of byCategory) {
    index.push(`## ${category}`, '');
    for (const item of items) index.push(`- [${item.title}](entries/${item.file})`);
    index.push('');
  }
  writeFileSync(join(root, 'index.md'), index.join('\n'), 'utf8');

  return root;
}

/** Build the export and stream it to the browser as a .tar.gz. */
export function streamMarkdownExport(res, onError) {
  let root;
  try {
    root = build();
  } catch (err) {
    return onError(err);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition',
    `attachment; filename="knowledge-base-markdown-${stamp}.tar.gz"`);

  const tar = spawn('tar', ['-czf', '-', '-C', root, 'index.md', 'entries', 'images']);
  tar.stdout.pipe(res);
  tar.stderr.on('data', (chunk) => console.error('kb: tar:', String(chunk).trim()));

  const cleanUp = () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* gone */ } };

  tar.on('error', (err) => { cleanUp(); onError(err); });
  tar.on('close', (code) => {
    cleanUp();
    if (code !== 0 && !res.headersSent) onError(new Error(`tar exited with ${code}`));
  });
}
