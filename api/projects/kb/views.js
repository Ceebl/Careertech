// Page rendering. Server-side HTML, so every page passes through the login
// check before anything reaches the browser.

import { esc, excerpt } from './sanitize.js';

const STYLES = `
:root {
  color-scheme: light dark;
  --bg:#fbfbfc; --surface:#fff; --fg:#14161a; --muted:#6b7280;
  --line:#e6e8ec; --accent:#2563eb; --accent-fg:#fff;
  --shadow:0 1px 2px rgba(16,18,22,.05), 0 1px 8px rgba(16,18,22,.04);
  --radius:12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0e1014; --surface:#161920; --fg:#e9eaec; --muted:#9aa1ad;
    --line:#252932; --accent:#5b9cff; --accent-fg:#0e1014;
    --shadow:none;
  }
}
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body {
  margin:0; background:var(--bg); color:var(--fg);
  font:16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
.wrap { max-width:62rem; margin:0 auto; padding:0 1.1rem; }

header.top {
  position:sticky; top:0; z-index:10; background:var(--bg);
  border-bottom:1px solid var(--line);
}
header.top .wrap {
  display:flex; align-items:center; gap:1rem;
  min-height:60px; flex-wrap:wrap; padding-top:.5rem; padding-bottom:.5rem;
}
.brand { font-weight:700; letter-spacing:-.02em; color:var(--fg); font-size:1.05rem; }
.brand:hover { text-decoration:none; }
.grow { flex:1 1 12rem; min-width:0; }
header.top form { display:flex; flex:1 1 12rem; min-width:0; }
header.top input[type=search] {
  width:100%; padding:.5rem .8rem; font:inherit; color:var(--fg);
  background:var(--surface); border:1px solid var(--line); border-radius:99px;
}
nav.top-links { display:flex; gap:.9rem; align-items:center; font-size:.9rem; }
nav.top-links a { color:var(--muted); }

main { padding:2.2rem 0 4rem; }
h1 { font-size:1.65rem; letter-spacing:-.02em; margin:0 0 .3rem; }
h2 { font-size:1.05rem; letter-spacing:-.01em; margin:2.2rem 0 .9rem; }
.lede { color:var(--muted); margin:0 0 2rem; }

.tiles { display:grid; gap:.8rem; grid-template-columns:repeat(auto-fill,minmax(15rem,1fr)); }
.tile {
  display:block; padding:1.05rem 1.15rem; background:var(--surface);
  border:1px solid var(--line); border-left:4px solid var(--dot,var(--muted));
  border-radius:var(--radius); box-shadow:var(--shadow); color:inherit;
}
.tile:hover { text-decoration:none; border-color:var(--dot,var(--accent)); }
.tile .name { font-weight:650; display:flex; align-items:center; gap:.5rem; }
.tile .desc { color:var(--muted); font-size:.87rem; margin-top:.35rem; }
.tile .count { color:var(--muted); font-size:.8rem; margin-top:.6rem; }

.list { display:grid; gap:.7rem; }
.item {
  display:block; padding:.95rem 1.1rem; background:var(--surface);
  border:1px solid var(--line); border-radius:var(--radius);
  box-shadow:var(--shadow); color:inherit;
}
.item:hover { text-decoration:none; border-color:var(--accent); }
.item .title { font-weight:640; }
.item .snippet { color:var(--muted); font-size:.88rem; margin-top:.3rem; }
.meta { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; margin-top:.55rem; }

.chip {
  display:inline-flex; align-items:center; gap:.35rem; font-size:.75rem;
  padding:.12rem .55rem; border-radius:99px;
  border:1px solid var(--line); color:var(--muted); background:var(--bg);
}
.chip.cat { color:var(--fg); }
.dot { width:.5rem; height:.5rem; border-radius:50%; background:var(--dot); }
.status { text-transform:uppercase; letter-spacing:.04em; font-size:.68rem; font-weight:700; }
.status.open { color:#b45309; border-color:#b4530955; }
.status.resolved { color:#15803d; border-color:#15803d55; }
@media (prefers-color-scheme: dark) {
  .status.open { color:#fbbf24; }
  .status.resolved { color:#4ade80; }
}

.btn {
  display:inline-block; padding:.5rem 1rem; font:inherit; font-weight:560;
  border-radius:9px; border:1px solid var(--line); background:var(--surface);
  color:var(--fg); cursor:pointer;
}
.btn:hover { text-decoration:none; border-color:var(--accent); }
.btn.primary { background:var(--accent); color:var(--accent-fg); border-color:transparent; }
.btn.danger { color:#dc2626; border-color:#dc262655; }
.actions { display:flex; gap:.6rem; flex-wrap:wrap; margin:1.5rem 0 0; }

article.body { margin-top:1.6rem; overflow-wrap:anywhere; }
article.body img, article.body video { max-width:100%; height:auto; border-radius:8px; }
article.body iframe { max-width:100%; border:1px solid var(--line); border-radius:8px; }
article.body pre {
  background:var(--surface); border:1px solid var(--line); border-radius:8px;
  padding:.9rem 1rem; overflow-x:auto; font-size:.88rem;
}
article.body code { font-family:ui-monospace, "Cascadia Code", Consolas, monospace; font-size:.9em; }
article.body pre code { font-size:inherit; }
article.body blockquote {
  margin:1rem 0; padding:.2rem 0 .2rem 1rem;
  border-left:3px solid var(--line); color:var(--muted);
}
article.body table { border-collapse:collapse; width:100%; display:block; overflow-x:auto; }
article.body th, article.body td { border:1px solid var(--line); padding:.45rem .6rem; text-align:left; }

form.editor { display:grid; gap:1.1rem; margin-top:1.5rem; }
label.field { display:grid; gap:.4rem; font-size:.85rem; font-weight:600; color:var(--muted); }
input[type=text], input[type=url], input[type=password], select, textarea {
  width:100%; padding:.6rem .75rem; font:inherit; color:var(--fg);
  background:var(--surface); border:1px solid var(--line); border-radius:9px;
}
textarea { min-height:20rem; font-family:ui-monospace, Consolas, monospace; font-size:.9rem; line-height:1.6; }
:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.checks { display:flex; flex-wrap:wrap; gap:.5rem; }
.checks label {
  display:inline-flex; align-items:center; gap:.45rem; cursor:pointer;
  padding:.4rem .7rem; border:1px solid var(--line); border-radius:99px;
  background:var(--surface); font-size:.85rem; font-weight:500; color:var(--fg);
}
.hint { font-weight:400; color:var(--muted); font-size:.8rem; }

.empty {
  padding:2.2rem; text-align:center; color:var(--muted);
  border:1px dashed var(--line); border-radius:var(--radius);
}
.notice {
  padding:.8rem 1rem; border-radius:9px; border:1px solid var(--line);
  background:var(--surface); margin-bottom:1.5rem;
}
.notice.error { border-color:#dc262655; color:#dc2626; }

.rte { border:1px solid var(--line); border-radius:9px; background:var(--surface); overflow:hidden; }
.rte-bar {
  display:flex; flex-wrap:wrap; gap:.25rem; padding:.4rem;
  border-bottom:1px solid var(--line); background:var(--bg);
}
.rte-bar button {
  font:inherit; font-size:.8rem; line-height:1; padding:.42rem .6rem;
  min-width:2rem; border:1px solid transparent; border-radius:6px;
  background:transparent; color:var(--fg); cursor:pointer;
}
.rte-bar button:hover { background:var(--surface); border-color:var(--line); }
.rte-toggle { margin-left:auto; color:var(--muted) !important; }
.rte-toggle.on { background:var(--accent) !important; color:var(--accent-fg) !important; }
.rte-canvas {
  min-height:22rem; padding:1rem 1.1rem; outline:none;
  overflow-wrap:anywhere; font-size:1rem;
}
.rte-canvas:focus { outline:none; }
.rte-canvas.drop { background:color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.rte-canvas img { max-width:100%; height:auto; border-radius:8px; }
.rte-canvas pre {
  background:var(--bg); border:1px solid var(--line); border-radius:8px;
  padding:.8rem .9rem; overflow-x:auto; font-family:ui-monospace, Consolas, monospace;
  font-size:.88rem;
}
.rte-canvas blockquote {
  margin:1rem 0; padding:.2rem 0 .2rem 1rem;
  border-left:3px solid var(--line); color:var(--muted);
}
.rte-canvas:empty::before { content:attr(data-placeholder); color:var(--muted); }
textarea.rte-source { border:0; border-radius:0; min-height:22rem; }
.rte-status { padding:0 1.1rem .6rem; font-size:.8rem; color:var(--muted); min-height:1.2rem; }
.rte-status.error { color:#dc2626; }

.login-wrap { max-width:22rem; margin:12vh auto; padding:0 1.1rem; }
footer.foot {
  border-top:1px solid var(--line); margin-top:3rem; padding:1.2rem 0;
  color:var(--muted); font-size:.82rem;
}
`;

export function layout({ title, body, kb, search = '' }) {
  const nav = kb?.isReader
    ? `<nav class="top-links">
         <a href="/kb/tags">Tags</a>
         ${kb.isAdmin ? '<a href="/kb/new">+ New</a>' : ''}
         <a href="/kb/logout">Log out</a>
       </nav>`
    : '';

  const header = kb?.isReader
    ? `<header class="top"><div class="wrap">
         <a class="brand" href="/kb/">Knowledge Base</a>
         <form action="/kb/search" method="get" class="grow">
           <input type="search" name="q" placeholder="Search..." value="${esc(search)}" aria-label="Search">
         </form>
         ${nav}
       </div></header>`
    : '';

  const footer = kb?.isReader
    ? `<footer class="foot"><div class="wrap">Signed in as ${esc(kb.role)}${
        kb.isAdmin ? ' &middot; <a href="/kb/backup">Download backup</a>' : ''
      }</div></footer>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${header}
<main><div class="wrap">${body}</div></main>
${footer}
</body>
</html>`;
}

export function categoryChip(cat) {
  // The emoji already carries the colour, so no separate dot.
  return `<span class="chip cat" style="border-color:${esc(cat.colour)}66">` +
    `${esc(cat.emoji)} ${esc(cat.name)}</span>`;
}

export function statusChip(status) {
  if (!status) return '';
  return `<span class="chip status ${esc(status)}">${esc(status)}</span>`;
}

export function tagChip(name) {
  return `<a class="chip" href="/kb/tag/${encodeURIComponent(name)}">#${esc(name)}</a>`;
}

export function entryItem(entry) {
  return `<a class="item" href="/kb/entry/${entry.id}">
    <div class="title">${esc(entry.title)}</div>
    <div class="snippet">${esc(excerpt(entry.body, 150))}</div>
    <div class="meta">
      ${(entry.categories || []).map(categoryChip).join('')}
      ${statusChip(entry.status)}
    </div>
  </a>`;
}

export function entryList(entries, emptyMessage = 'Nothing here yet.') {
  if (!entries.length) return `<p class="empty">${esc(emptyMessage)}</p>`;
  return `<div class="list">${entries.map(entryItem).join('')}</div>`;
}
