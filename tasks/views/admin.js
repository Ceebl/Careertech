// Administration: accounts and the audit trail.
//
// Being an admin means being able to create and disable accounts. It grants no
// access to anybody's workspaces -- see the note at the top of lib/access.js.

import { html } from '../lib/html.js';
import { MIN_LENGTH } from '../lib/passwords.js';

export function adminPage({ users, csrf, notice = '', error = '', me }) {
  return html`<div class="page-head">
    <div>
      <h1>Administration</h1>
      <p class="lede">Accounts, and the record of what has happened.</p>
    </div>
    <div class="actions"><a class="btn" href="/tasks/admin/audit">Audit log</a></div>
  </div>

  ${notice ? html`<p class="notice ok">${notice}</p>` : ''}
  ${error ? html`<p class="notice error">${error}</p>` : ''}

  <div class="panel">
    <h2>People</h2>
    <table class="list">
      <thead>
        <tr><th>Username</th><th>Name</th><th>Created</th><th>Last signed in</th>
          <th class="right">Actions</th></tr>
      </thead>
      <tbody>
        ${users.map((user) => html`<tr>
          <td>
            ${user.username}
            ${user.is_admin ? html` <span class="tag admin">admin</span>` : ''}
            ${user.disabled_at ? html` <span class="tag off">disabled</span>` : ''}
            ${user.must_change ? html` <span class="tag">must change password</span>` : ''}
          </td>
          <td class="muted">${user.display_name}</td>
          <td class="muted small">${user.created_at}</td>
          <td class="muted small">${user.last_login_at || 'never'}</td>
          <td class="right">
            ${user.id === me.id
    ? html`<span class="muted small">that's you</span>`
    : html`<form method="post" action="/tasks/admin/user/${user.id}"
             class="inline-form right">
        <input type="hidden" name="_csrf" value="${csrf}">
        <select name="action" aria-label="Action for ${user.username}">
          <option value="">Choose…</option>
          <option value="${user.disabled_at ? 'enable' : 'disable'}">
            ${user.disabled_at ? 'Enable account' : 'Disable account'}</option>
          <option value="${user.is_admin ? 'demote' : 'promote'}">
            ${user.is_admin ? 'Remove admin' : 'Make admin'}</option>
          <option value="reset">Reset password…</option>
          <option value="delete">Delete account</option>
        </select>
        <button class="btn small" type="submit">Go</button>
      </form>`}
          </td>
        </tr>`)}
      </tbody>
    </table>
  </div>

  <div class="panel">
    <h2>Create an account</h2>
    <p class="muted small">
      You set the first password and pass it to them however you like. They are
      made to replace it the first time they sign in, so it stops being a
      password you know as soon as they use it.
    </p>
    <form method="post" action="/tasks/admin/user">
      <input type="hidden" name="_csrf" value="${csrf}">
      <div class="row">
        <label class="field">Username
          <input type="text" name="username" maxlength="32" required
                 autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9._-]+">
        </label>
        <label class="field">Display name
          <input type="text" name="displayName" maxlength="60" placeholder="Optional">
        </label>
      </div>
      <label class="field">First password
        <input type="text" name="password" minlength="${MIN_LENGTH}" required
               autocomplete="off" value="${suggestPassword()}">
        <span class="field-hint">
          Shown rather than hidden, because you have to be able to read it out.
          A fresh suggestion is filled in each time this page loads — it is four
          random words, which is far stronger than anything either of you would
          invent.
        </span>
      </label>
      <label class="field check-field">
        <input type="checkbox" name="isAdmin" value="1" class="auto">
        Can administer accounts
      </label>
      <button class="btn primary" type="submit">Create account</button>
    </form>
  </div>`;
}

export function resetPage({ user, csrf, error = '' }) {
  return html`<div class="panel narrow">
    <h1>Reset password</h1>
    <p class="lede">For <strong>${user.username}</strong>.</p>
    ${error ? html`<p class="notice error">${error}</p>` : ''}
    <p class="notice warn small">
      This signs them out on every device immediately, and they will have to
      pick a new password of their own the next time they sign in.
    </p>
    <form method="post" action="/tasks/admin/user/${user.id}/reset">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field">New temporary password
        <input type="text" name="password" minlength="${MIN_LENGTH}" required
               autocomplete="off" value="${suggestPassword()}">
      </label>
      <button class="btn primary" type="submit">Reset it</button>
      <a class="btn" href="/tasks/admin">Cancel</a>
    </form>
  </div>`;
}

export function confirmDeletePage({ user, csrf }) {
  return html`<div class="panel narrow">
    <h1>Delete ${user.username}?</h1>
    <p class="notice error small">
      This cannot be undone. Any workspace they own is archived along with them.
      Items they created in other people's workspaces stay, with the name
      removed. If you only want to stop them signing in, disable the account
      instead — that is reversible.
    </p>
    <form method="post" action="/tasks/admin/user/${user.id}/delete">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field">Type their username to confirm
        <input type="text" name="confirm" autocomplete="off" required autofocus
               autocapitalize="none" spellcheck="false">
      </label>
      <button class="btn danger" type="submit">Delete this account</button>
      <a class="btn" href="/tasks/admin">Cancel</a>
    </form>
  </div>`;
}

export function auditPage({ events }) {
  return html`<div class="page-head">
    <div>
      <h1>Audit log</h1>
      <p class="lede">The 300 most recent events.
        <a href="/tasks/admin">Back to administration</a></p>
    </div>
  </div>

  <div class="panel">
    <table class="list">
      <thead><tr><th>When</th><th>Who</th><th>Address</th><th>What</th><th>Detail</th></tr></thead>
      <tbody>
        ${events.map((event) => html`<tr>
          <td class="muted small nowrap">${event.at}</td>
          <td>${event.username || '—'}</td>
          <td class="muted small">${event.ip}</td>
          <td><span class="tag">${event.action}</span></td>
          <td class="muted small">${event.detail}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

// A four-word passphrase from a small word list. Not a full Diceware list, but
// 4 words from 256 is 32 bits before you count the separators -- and vastly
// better than the "Welcome123" a human would type into this box.
const WORDS = ('anchor amber apple arrow autumn basil beacon birch bishop blossom bramble breeze '
  + 'bridge bronze burrow cactus candle canvas cavern cedar chalk cherry chimney cinder cobalt '
  + 'compass copper coral cotton crimson crystal cypress daisy damson dapple dawn delta desert '
  + 'diamond dolphin domino donkey dragon dune ember emerald fable falcon fennel fern ferry fjord '
  + 'flint forest fossil fountain foxglove garnet ginger glacier granite gravel harbour harvest '
  + 'hazel heather hedge hemlock heron hollow honey hornet indigo ivory jasmine jetty juniper '
  + 'kestrel lagoon lantern lattice laurel lavender ledger lichen lilac linden lobster locket '
  + 'lumber magnet mallow maple marble marigold meadow mercury mineral minnow mistle moorland '
  + 'mortar mosaic nectar nettle nickel nimbus nutmeg oakwood obsidian ochre olive onyx opal '
  + 'orchard osprey otter oyster paddock pantry parsley pasture pebble pelican pepper petal '
  + 'pewter pigeon pillar pilot pine plover plum pollen poplar poppy prairie quarry quartz quiver '
  + 'radish rafter ragwort rapids raven reef ribbon rivet robin rosemary rowan rudder russet '
  + 'saffron sage salmon sandal sapling sapphire scarlet sceptre sedge shale shallow shingle '
  + 'sienna silver siskin slate sorrel spindle spruce starling sterling stipple stork summit '
  + 'sundial swallow sycamore tamarind tangle teasel tempest thicket thistle thorn thrush timber '
  + 'tinder topaz torrent trellis trout tulip tundra turret umber valley vellum velvet verbena '
  + 'vessel viola violet walnut warbler wattle willow window winter wisteria wolfram woodbine '
  + 'yarrow yeast yellow yonder zephyr zinnia').split(' ');

function suggestPassword() {
  const bytes = new Uint32Array(4);
  // Node's webcrypto, available as a global from Node 19.
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((n) => WORDS[n % WORDS.length]).join('-');
}
