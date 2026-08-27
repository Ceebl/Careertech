// Sign in, change password, and your own account page.

import { html } from '../lib/html.js';
import { MIN_LENGTH } from '../lib/passwords.js';

export function loginPage({ next = '/tasks/', error = '', notice = '' }) {
  return html`<div class="login-wrap">
  <div class="login-card">
    <h1>
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <rect width="32" height="32" rx="6" fill="#496DDB"/>
        <path d="M9 16.5l4.5 4.5L23 11.5" stroke="white" stroke-width="3.2"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Tasks
    </h1>
    <p class="lede">Sign in to continue.</p>

    ${error ? html`<p class="notice error">${error}</p>` : ''}
    ${notice ? html`<p class="notice ok">${notice}</p>` : ''}

    <form method="post" action="/tasks/login">
      <input type="hidden" name="next" value="${next}">
      <label class="field">Username
        <input type="text" name="username" autocomplete="username"
               autocapitalize="none" spellcheck="false" required autofocus>
      </label>
      <label class="field">Password
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <button class="btn primary full-width" type="submit">
        Sign in
      </button>
    </form>

    <p class="small muted foot-note">
      Accounts here are created by the administrator. There is no sign-up.
    </p>
  </div>
</div>`;
}

export function passwordPage({ csrf, error = '', first = false }) {
  return html`<div class="panel narrow">
  <h1>${first ? 'Choose your password' : 'Change your password'}</h1>
  <p class="lede">
    ${first
    ? 'Your account was set up with a password somebody else chose. Replace it with one only you know.'
    : 'You will be signed out on your other devices.'}
  </p>

  ${error ? html`<p class="notice error">${error}</p>` : ''}

  <form method="post" action="/tasks/account/password">
    <input type="hidden" name="_csrf" value="${csrf}">
    <label class="field">Current password
      <input type="password" name="current" autocomplete="current-password" required autofocus>
    </label>
    <label class="field">New password
      <input type="password" name="password" autocomplete="new-password"
             minlength="${MIN_LENGTH}" required>
      <span class="field-hint">
        At least ${MIN_LENGTH} characters. Three or four unrelated words is both
        the easiest to remember and the hardest to guess.
      </span>
    </label>
    <label class="field">New password again
      <input type="password" name="confirm" autocomplete="new-password"
             minlength="${MIN_LENGTH}" required>
    </label>
    <button class="btn primary" type="submit">Save new password</button>
  </form>
</div>`;
}

export function accountPage({ user, sessions, csrf, notice = '', currentToken }) {
  return html`<div class="page-head">
    <div>
      <h1>Your account</h1>
      <p class="lede">Signed in as <strong>${user.username}</strong></p>
    </div>
  </div>

  ${notice ? html`<p class="notice ok">${notice}</p>` : ''}

  <div class="panel">
    <h2>Display name</h2>
    <form method="post" action="/tasks/account/name" class="row bottom">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">Name shown to other people
        <input type="text" name="displayName" maxlength="60" value="${user.displayName}">
      </label>
      <div class="grow-0"><button class="btn" type="submit">Save</button></div>
    </form>
  </div>

  <div class="panel">
    <h2>Password</h2>
    <p class="muted small">Changing it signs you out everywhere else.</p>
    <p><a class="btn" href="/tasks/account/password">Change password</a></p>
  </div>

  <div class="panel">
    <h2>Where you are signed in</h2>
    <p class="muted small">
      One line per browser holding a live session. If you see something you do
      not recognise, sign the others out and then change your password.
    </p>
    <table class="list">
      <thead>
        <tr><th>Signed in</th><th>Last used</th><th>Address</th><th>Browser</th></tr>
      </thead>
      <tbody>
        ${sessions.map((session) => html`<tr>
          <td>${session.created_at}${session.token_hash === currentToken
    ? html` <span class="tag">this one</span>` : ''}</td>
          <td>${session.last_seen_at}</td>
          <td class="muted">${session.ip}</td>
          <td class="muted small">${shortAgent(session.user_agent)}</td>
        </tr>`)}
      </tbody>
    </table>

    ${sessions.length > 1 ? html`<form method="post" action="/tasks/account/sessions/revoke"
      class="mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="btn danger" type="submit">Sign out everywhere else</button>
    </form>` : ''}
  </div>

  <div class="panel">
    <h2>Two-factor authentication</h2>
    <p class="muted">
      Not switched on yet. The account is built to take it, so it can be added
      later without anybody having to start again.
    </p>
  </div>`;
}

// User-agent strings are long and mostly noise; the interesting part is which
// browser on which kind of machine.
function shortAgent(agent) {
  const value = String(agent ?? '');
  const browser = /Firefox\/[\d.]+/.exec(value)?.[0]
    ?? (/Edg\//.test(value) ? 'Edge' : null)
    ?? (/Chrome\//.test(value) ? 'Chrome' : null)
    ?? (/Safari\//.test(value) ? 'Safari' : null)
    ?? 'Unknown browser';
  const platform = /Windows/.test(value) ? 'Windows'
    : /Android/.test(value) ? 'Android'
      : /iPhone|iPad/.test(value) ? 'iOS'
        : /Mac OS X/.test(value) ? 'macOS'
          : /Linux/.test(value) ? 'Linux' : '';
  return platform ? `${browser} · ${platform}` : browser;
}
