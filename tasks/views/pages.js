// The screens between signing in and a board: workspaces, boards, settings.

import { html } from '../lib/html.js';
import {
  PALETTE, TYPES, TYPE_NAMES, paletteColour, colourClass, hasLabels,
} from '../lib/columns.js';

export function homePage({ workspaces, csrf }) {
  return html`<div class="page-head">
    <div>
      <h1>Your workspaces</h1>
      <p class="lede">A workspace is one area of life. Boards live inside them.</p>
    </div>
    <div class="actions">
      <a class="btn primary" href="#new-workspace">New workspace</a>
    </div>
  </div>

  ${workspaces.length === 0
    ? html`<div class="empty">
        <p>You are not in any workspaces yet.</p>
        <p class="small">Make one below — "Work" and "Home" is a good start.</p>
      </div>`
    : html`<div class="cards">
        ${workspaces.map((workspace) => html`<a class="card bl-${colourClass(workspace.colour)}" href="/tasks/w/${workspace.id}">
          <span class="name">${workspace.name}</span>
          <span class="meta">
            ${workspace.board_count} ${workspace.board_count === 1 ? 'board' : 'boards'}
            · ${workspace.member_count} ${workspace.member_count === 1 ? 'person' : 'people'}
            ${workspace.role === 'owner' ? html` · <span class="tag owner">owner</span>` : ''}
            ${workspace.role === 'viewer' ? html` · <span class="tag viewer">view only</span>` : ''}
          </span>
        </a>`)}
      </div>`}

  <div class="panel mt-2" id="new-workspace">
    <h2>New workspace</h2>
    <form method="post" action="/tasks/workspace">
      <input type="hidden" name="_csrf" value="${csrf}">
      <div class="row">
        <label class="field">Name
          <input type="text" name="name" maxlength="80" required placeholder="Work">
        </label>
        <label class="field w-10">Colour
          ${colourSelect('colour', PALETTE[0])}
        </label>
      </div>
      <button class="btn primary" type="submit">Create workspace</button>
    </form>
  </div>`;
}

export function workspacePage({
  workspace, boards, members, csrf, canEdit, isOwner, allUsers, notice = '',
}) {
  return html`<div class="page-head">
    <div>
      <h1>${workspace.name}</h1>
      <p class="lede">${boards.length} ${boards.length === 1 ? 'board' : 'boards'}
        · ${members.length} ${members.length === 1 ? 'person' : 'people'}</p>
    </div>
  </div>

  ${notice ? html`<p class="notice ok">${notice}</p>` : ''}

  ${boards.length === 0
    ? html`<div class="empty"><p>No boards yet.</p></div>`
    : html`<div class="cards">
        ${boards.map((board) => html`<a class="card bl-${colourClass(workspace.colour)}" href="/tasks/b/${board.id}">
          <span class="name">${board.name}</span>
          <span class="meta">${board.item_count}
            ${board.item_count === 1 ? 'item' : 'items'}</span>
        </a>`)}
      </div>`}

  ${canEdit ? html`<div class="panel mt-2">
    <h2>New board</h2>
    <form method="post" action="/tasks/w/${workspace.id}/board" class="row bottom">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">Name
        <input type="text" name="name" maxlength="80" required
               placeholder="Bathroom renovation">
      </label>
      <div class="grow-0"><button class="btn primary" type="submit">Create board</button></div>
    </form>
    <p class="small muted note">
      New boards start with a Status, Owner and Due column, and two groups.
      All of it is renameable.
    </p>
  </div>` : ''}

  <div class="panel">
    <h2>People</h2>
    <table class="list">
      <thead><tr><th>Name</th><th>Username</th><th>Role</th>
        ${isOwner ? html`<th class="right">Change</th>` : ''}</tr></thead>
      <tbody>
        ${members.map((member) => html`<tr>
          <td>${member.display_name || member.username}
            ${member.disabled_at ? html`<span class="tag off">disabled</span>` : ''}</td>
          <td class="muted">${member.username}</td>
          <td><span class="tag ${member.role}">${member.role}</span></td>
          ${isOwner ? html`<td class="right">
            <form method="post" action="/tasks/w/${workspace.id}/member"
                  class="inline-form right">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="hidden" name="userId" value="${member.id}">
              <select name="role" aria-label="Role for ${member.username}">
                <option value="owner" ${member.role === 'owner' ? 'selected' : ''}>owner</option>
                <option value="member" ${member.role === 'member' ? 'selected' : ''}>member</option>
                <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>viewer</option>
                <option value="remove">remove</option>
              </select>
              <button class="btn small" type="submit">Apply</button>
            </form>
          </td>` : ''}
        </tr>`)}
      </tbody>
    </table>

    ${isOwner && allUsers.length ? html`<form method="post"
      action="/tasks/w/${workspace.id}/member" class="row bottom mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">Add someone
        <select name="userId">
          ${allUsers.map((user) => html`<option value="${user.id}">
            ${user.display_name || user.username} (${user.username})</option>`)}
        </select>
      </label>
      <label class="field tight w-9">As
        <select name="role">
          <option value="member">member</option>
          <option value="viewer">viewer</option>
          <option value="owner">owner</option>
        </select>
      </label>
      <div class="grow-0"><button class="btn" type="submit">Add</button></div>
    </form>` : ''}

    ${isOwner && !allUsers.length
    ? html`<p class="small muted mt-1">
        Everyone with an account is already in this workspace.</p>` : ''}
  </div>

  ${isOwner ? html`<div class="panel">
    <h2>Workspace settings</h2>
    <form method="post" action="/tasks/w/${workspace.id}/rename" class="row bottom">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">Name
        <input type="text" name="name" maxlength="80" value="${workspace.name}" required>
      </label>
      <label class="field tight w-10">Colour
        ${colourSelect('colour', workspace.colour)}
      </label>
      <div class="grow-0"><button class="btn" type="submit">Save</button></div>
    </form>

    <hr class="divider">

    <form method="post" action="/tasks/w/${workspace.id}/archive">
      <input type="hidden" name="_csrf" value="${csrf}">
      <p class="small muted">
        Archiving hides the workspace and everything in it from everyone. The
        data is kept, so it can be brought back by hand if it turns out to have
        been a mistake.
      </p>
      <button class="btn danger" type="submit">Archive this workspace</button>
    </form>
  </div>` : ''}`;
}

/* -------------------------------------------------------- board settings */

export function boardSettingsPage({ board, columns, csrf, notice = '' }) {
  return html`<div class="page-head">
    <div>
      <h1>${board.name} settings</h1>
      <p class="lede"><a href="/tasks/b/${board.id}">Back to the board</a></p>
    </div>
  </div>

  ${notice ? html`<p class="notice ok">${notice}</p>` : ''}

  <div class="panel">
    <h2>Name</h2>
    <form method="post" action="/tasks/b/${board.id}/rename">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field">Board name
        <input type="text" name="name" maxlength="80" value="${board.name}" required>
      </label>
      <label class="field">Description
        <input type="text" name="description" maxlength="300" value="${board.description}">
      </label>
      <button class="btn" type="submit">Save</button>
    </form>
  </div>

  <div class="panel">
    <h2>Columns</h2>
    <table class="list">
      <thead><tr><th>Name</th><th>Type</th><th class="right">Actions</th></tr></thead>
      <tbody>
        ${columns.map((column) => html`<tr>
          <td>
            <form method="post" action="/tasks/column/${column.id}/rename"
                  class="inline-form">
              <input type="hidden" name="_csrf" value="${csrf}">
              <input type="text" name="name" value="${column.name}" maxlength="80"
                     aria-label="Name of the ${column.name} column">
              <button class="btn small" type="submit">Rename</button>
            </form>
          </td>
          <td><span class="tag">${TYPES[column.type]?.label ?? column.type}</span></td>
          <td class="right">
            ${hasLabels(column)
    ? html`<a class="btn small" href="/tasks/column/${column.id}/labels">Edit labels</a> `
    : ''}
            <form method="post" action="/tasks/column/${column.id}/delete"
                  class="inline-block">
              <input type="hidden" name="_csrf" value="${csrf}">
              <button class="btn small danger" type="submit">Delete</button>
            </form>
          </td>
        </tr>`)}
      </tbody>
    </table>

    <form method="post" action="/tasks/b/${board.id}/column" class="row bottom mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">New column name
        <input type="text" name="name" maxlength="80" placeholder="Priority">
      </label>
      <label class="field tight w-12">Type
        <select name="type">
          ${TYPE_NAMES.map((name) => html`<option value="${name}">
            ${TYPES[name].label} — ${TYPES[name].hint}</option>`)}
        </select>
      </label>
      <div class="grow-0"><button class="btn" type="submit">Add column</button></div>
    </form>
    <p class="small muted note">
      A column's type is fixed once it exists. Changing it would leave every
      value on the board meaning something different, so add a new column and
      delete the old one instead.
    </p>
  </div>

  <div class="panel">
    <h2>Danger zone</h2>
    <form method="post" action="/tasks/b/${board.id}/archive">
      <input type="hidden" name="_csrf" value="${csrf}">
      <p class="small muted">Archiving hides the board and its items from everyone.</p>
      <button class="btn danger" type="submit">Archive this board</button>
    </form>
  </div>`;
}

export function labelsPage({ column, board, csrf }) {
  const settings = JSON.parse(column.settings || '{}');
  const labels = settings.labels ?? [];
  // The finished/unblock machinery belongs to Status. A Priority column is
  // just labels, so those controls are left off rather than shown doing nothing.
  const isStatus = column.type === 'status';
  return html`<div class="page-head">
    <div>
      <h1>${column.name} labels</h1>
      <p class="lede"><a href="/tasks/b/${board.id}/settings">Back to board settings</a></p>
    </div>
  </div>

  <div class="panel">
    <p class="muted small">
      Renaming a label changes it everywhere at once — items keep pointing at
      the same label, so nothing on the board is lost. Deleting one clears it
      from any item that had it.
    </p>
    ${isStatus ? html`<p class="muted small">
      <strong>Counts as finished</strong> is what the <em>blocked by</em> feature
      reads. When a task reaches a status ticked here, anything that was waiting
      on it is freed, and its status moves to whatever you choose below.
    </p>` : ''}
    <form method="post" action="/tasks/column/${column.id}/labels">
      <input type="hidden" name="_csrf" value="${csrf}">
      ${labels.map((label, index) => html`<div class="row bottom">
        <input type="hidden" name="id${index}" value="${label.id}">
        <label class="field">Label ${index + 1}
          <input type="text" name="text${index}" value="${label.text}" maxlength="40">
        </label>
        <label class="field w-10">Colour
          ${colourSelect(`colour${index}`, label.colour)}
        </label>
        ${isStatus ? html`<label class="field w-9 check-field">
          <input type="checkbox" name="done${index}" value="1" class="auto"
                 ${label.done ? 'checked' : ''}>
          Counts as finished
        </label>` : ''}
        <label class="field w-7 check-field">
          <input type="checkbox" name="delete${index}" value="1" class="auto">
          Delete
        </label>
      </div>`)}

      <div class="row bottom">
        <label class="field">Add a label
          <input type="text" name="newText" maxlength="40" placeholder="e.g. Waiting on someone">
        </label>
        <label class="field w-10">Colour
          ${colourSelect('newColour', '#717EC3')}
        </label>
        ${isStatus ? html`<label class="field w-9 check-field">
          <input type="checkbox" name="newDone" value="1" class="auto">
          Counts as finished
        </label>` : ''}
      </div>

      ${isStatus ? html`<hr class="divider">

      <label class="field">
        When everything a task was waiting on is finished, move that task to
        <select name="unblockedLabelId">
          <option value="">Leave its status alone</option>
          ${labels.map((label) => html`<option value="${label.id}"
            ${settings.unblockedLabelId === label.id ? 'selected' : ''}
            >${label.text}</option>`)}
        </select>
        <span class="field-hint">
          A task already on a finished status is never moved by this, so being
          unblocked cannot undo something you have marked as done.
        </span>
      </label>` : ''}

      <button class="btn primary" type="submit">Save labels</button>
    </form>
  </div>`;
}

export function groupEditPage({ group, board, csrf }) {
  return html`<div class="panel narrow">
    <h1>Rename group</h1>
    <form method="post" action="/tasks/group/${group.id}/edit">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field">Name
        <input type="text" name="name" value="${group.name}" maxlength="80" required autofocus>
      </label>
      <label class="field">Colour
        ${colourSelect('colour', group.colour)}
      </label>
      <button class="btn primary" type="submit">Save</button>
      <a class="btn" href="/tasks/b/${board.id}">Cancel</a>
    </form>
  </div>`;
}

/* A plain select rather than a colour picker, so every colour on the site is
   one of the house six and boards stay legible. */
function colourSelect(name, current) {
  const names = {
    '#496DDB': 'Blue', '#C0BF47': 'Olive', '#EE8434': 'Orange',
    '#C95D63': 'Red', '#717EC3': 'Periwinkle', '#AE8799': 'Mauve',
    '#5B6472': 'Slate', '#8A8F98': 'Grey', '#3E8E5F': 'Green',
  };
  return html`<select name="${name}">
    ${PALETTE.map((colour) => html`<option value="${colour}"
      ${paletteColour(current) === colour ? 'selected' : ''}>${names[colour]}</option>`)}
  </select>`;
}
