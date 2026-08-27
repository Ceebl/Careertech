// The page shell every screen is poured into.

import { html, raw, toString } from '../lib/html.js';
import { CSS_URL, JS_URL } from '../lib/assets.js';

/**
 * @param {{
 *   title: string,
 *   user?: object|null,
 *   crumbs?: Array<{ label: string, href?: string }>,
 *   actions?: object,
 *   body: object,
 *   bodyClass?: string,
 *   csrf?: string,
 *   wide?: boolean,
 * }} page
 * @returns {string}
 */
export function layout(page) {
  const {
    title, user = null, crumbs = [], actions = null, body,
    bodyClass = '', csrf = '', wide = false, theme = 'light',
  } = page;

  return toString(html`<!doctype html>
<!-- The theme is stamped on server-side from a cookie rather than applied by a
     script on load. A strict Content-Security-Policy forbids the inline script
     that would normally do this, and doing it here avoids the white flash that
     a deferred script would cause anyway. -->
<html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<!-- Nothing here is for anyone but the person signed in, so keep it out of
     search engines and out of any browser feature that might share it. -->
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${title} · Tasks</title>
<link rel="stylesheet" href="${CSS_URL}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23496DDB'/%3E%3Cpath d='M9 16.5l4.5 4.5L23 11.5' stroke='white' stroke-width='3.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
${csrf ? html`<meta name="csrf-token" content="${csrf}">` : ''}
<script src="${JS_URL}" defer></script>
</head>
<body class="${bodyClass}">
${user ? topBar(user, crumbs, actions, csrf) : ''}
<main class="${wide ? 'wide' : ''}">
${body}
</main>
</body>
</html>`);
}

function topBar(user, crumbs, actions, csrf) {
  return html`<header class="topbar">
  <a class="mark" href="/tasks/" aria-label="All workspaces">
    <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#496DDB"/>
      <path d="M9 16.5l4.5 4.5L23 11.5" stroke="white" stroke-width="3.2"
            fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </a>

  <nav class="crumbs" aria-label="Breadcrumb">
    ${crumbs.map((crumb) => (crumb.href
    ? html`<a href="${crumb.href}">${crumb.label}</a><span class="sep" aria-hidden="true">/</span>`
    : html`<span class="here">${crumb.label}</span>`))}
  </nav>

  <div class="topbar-actions">${actions}</div>

  <!-- Light by default everywhere on this site, with the choice remembered
       rather than taken from the operating system. -->
  <button type="button" class="theme-toggle" data-theme-toggle
          aria-label="Switch between light and dark">
    <svg class="sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5"/>
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>
    </svg>
    <svg class="moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>
    </svg>
  </button>

  <details class="menu">
    <summary title="${user.displayName}">
      <span class="avatar" aria-hidden="true">${initials(user.displayName)}</span>
      <span class="who">${user.displayName}</span>
    </summary>
    <div class="menu-panel">
      <a href="/tasks/account">Your account</a>
      ${user.isAdmin ? html`<a href="/tasks/admin">Administration</a>` : ''}
      <form method="post" action="/tasks/logout">
        <input type="hidden" name="_csrf" value="${csrf}">
        <button type="submit" class="linkish">Sign out</button>
      </form>
    </div>
  </details>
</header>`;
}

/**
 * Render a page and send it.
 *
 * Every screen goes out through here, so the signed-in user and the CSRF token
 * are wired in one place rather than remembered route by route.
 */
export function render(res, page) {
  res.type('html').send(layout({
    ...page,
    user: res.locals.user,
    csrf: res.locals.csrf || '',
    theme: res.locals.theme || 'light',
  }));
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A standalone message page, for empty states and refusals. */
export function notice(text, backHref = '/tasks/', backLabel = 'Back') {
  return html`<div class="panel narrow">
    <p>${text}</p>
    <p><a class="btn" href="${backHref}">${backLabel}</a></p>
  </div>`;
}

export { html, raw };
