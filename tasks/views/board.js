// Drawing a board: the table view, the kanban view, and one item's page.

import { html } from '../lib/html.js';
import {
  settingsOf, labelFor, colourClass, isVirtual, hasLabels, TYPES, TYPE_NAMES,
} from '../lib/columns.js';

/**
 * The table view -- one table per group, monday.com style.
 *
 * @param {{ board: object, groups: object[], columns: object[], items: object[],
 *           people: Map<string, object>, csrf: string, canEdit: boolean }} view
 */
export function tableView(view) {
  const { board, groups, items, csrf, canEdit } = view;

  return html`${groups.map((group) => groupBlock(
    group,
    items.filter((item) => item.group_id === group.id),
    view,
  ))}
  ${canEdit ? html`<form method="post" action="/tasks/b/${board.id}/group" class="add-group">
    <input type="hidden" name="_csrf" value="${csrf}">
    <button class="btn small" type="submit">+ Add group</button>
  </form>` : ''}`;
}

function groupBlock(group, groupItems, view) {
  const { columns, csrf, canEdit } = view;
  const colour = colourClass(group.colour);

  return html`<section class="group">
    <div class="group-head">
      <span class="dot bg-${colour}"></span>
      <span class="title">${group.name}</span>
      <span class="count">${groupItems.length} ${groupItems.length === 1 ? 'item' : 'items'}</span>
      <span class="spacer"></span>
      ${canEdit ? groupMenu(group, csrf) : ''}
    </div>

    <div class="board-scroll">
      <table class="board-table">
        <thead>
          <tr>
            <th class="col-title">Item</th>
            ${columns.map((column, index) => html`<th
              class="col-narrow col-${column.type}">
              ${canEdit
    ? columnMenu(column, index, columns.length, csrf)
    : html`${column.name}`}
            </th>`)}
            <th class="col-add">${canEdit ? addColumnMenu(view.board, csrf) : ''}</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          ${groupItems.length === 0 && !canEdit
    ? html`<tr><td colspan="${columns.length + 3}"
             class="muted pad-note">Nothing here yet.</td></tr>`
    : ''}
          ${groupItems.map((item) => html`${itemRow(item, view)}
            ${(item.children ?? []).map((child) => itemRow(child, view, item))}
            ${canEdit ? addSubitemRow(item, view, (item.children ?? []).length === 0) : ''}`)}
          ${canEdit ? html`<tr class="add-row">
            <td colspan="${columns.length + 3}">
              <form method="post" action="/tasks/group/${group.id}/item">
                <input type="hidden" name="_csrf" value="${csrf}">
                <input type="text" name="title" maxlength="300"
                       placeholder="+ Add item" aria-label="New item in ${group.name}">
                <button type="submit" class="visually-hidden">Add item</button>
              </form>
            </td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>
  </section>`;
}

/**
 * One row. `parent` is set when this is a subitem, which indents it and marks
 * it so the collapse chevron on its parent can find it.
 */
function itemRow(item, view, parent = null) {
  const { columns, csrf, canEdit } = view;
  const children = item.children ?? [];

  return html`<tr class="${parent ? 'subitem-row' : ''}"
    ${parent ? html`data-child-of="${parent.id}"` : ''}>
    <td class="col-title">
      <div class="item-title ${parent ? 'indented' : ''}">
        <!-- The chevron is on every top-level row, not only rows that already
             have subitems: opening an empty one is how you add the first. -->
        ${parent ? html`<span class="twist-space" aria-hidden="true"></span>`
    : html`<button type="button" class="twist ${children.length ? '' : 'folded'}"
          data-twist="${item.id}" aria-expanded="${children.length ? 'true' : 'false'}"
          aria-label="Subitems of ${item.title}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
               stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>`}
        <input class="text" type="text" value="${item.title}" maxlength="300"
               data-item="${item.id}" data-field="title" aria-label="Item name"
               ${canEdit ? '' : 'readonly'}>
        ${children.length ? html`<span class="child-count"
          title="${children.length} subitem${children.length === 1 ? '' : 's'}"
          >${children.length}</span>` : ''}
        ${item.blockedBy?.length ? html`<a class="blocked-chip"
          href="/tasks/item/${item.id}"
          title="Waiting on ${item.blockedBy.join(', ')}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
               stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="4.5" y="10.5" width="15" height="10" rx="2"/>
            <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" stroke-linecap="round"/>
          </svg>${item.blockedBy.length > 1 ? item.blockedBy.length : ''}
        </a>` : ''}
        <a class="bubble" href="/tasks/item/${item.id}"
           title="Open item and comments">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
               stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>${item.comments || ''}
        </a>
      </div>
    </td>
    ${columns.map((column) => html`<td>${cell(item, column, view)}</td>`)}
    <td class="col-add"></td>
    <td class="col-actions">
      ${canEdit ? html`<details class="row-menu pop">
        <summary aria-label="Item actions">···</summary>
        <div class="pop-panel">
          <a href="/tasks/item/${item.id}">Open</a>
          <a href="/tasks/item/${item.id}#blocked-by">Blocked by…</a>
          ${parent ? '' : html`<button type="button" class="linkish"
            data-add-subitem="${item.id}">Add subitem</button>`}
          <form method="post" action="/tasks/item/${item.id}/delete">
            <input type="hidden" name="_csrf" value="${csrf}">
            <button type="submit" class="linkish danger"
              data-confirm="Delete &quot;${item.title}&quot;?">Delete item</button>
          </form>
        </div>
      </details>` : ''}
    </td>
  </tr>`;
}

// Rendered for every parent, but kept out of the way until it is wanted -- a
// board with a "+ Add subitem" line under every single row is unreadable.
// "Add subitem" in the row menu reveals it; having subitems already shows it.
/**
 * The menu on a column heading: rename, move, edit labels, delete.
 *
 * All of it was only on the Settings page before, which is a strange place to
 * go to move a column you are looking at.
 */
function columnMenu(column, index, total, csrf) {
  return html`<details class="col-menu pop">
    <summary>
      <span class="label">${column.name}</span>
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </summary>
    <div class="pop-panel">
      <form method="post" action="/tasks/column/${column.id}/rename" class="menu-form">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="back" value="board">
        <input type="text" name="name" value="${column.name}" maxlength="80"
               aria-label="Rename the ${column.name} column">
        <button class="btn small" type="submit">Rename</button>
      </form>

      ${hasLabels(column)
    ? html`<a href="/tasks/column/${column.id}/labels">Edit labels…</a>` : ''}

      <form method="post" action="/tasks/column/${column.id}/move">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="back" value="board">
        <button type="submit" name="direction" value="left" class="linkish"
                ${index === 0 ? 'disabled' : ''}>← Move left</button>
        <button type="submit" name="direction" value="right" class="linkish"
                ${index === total - 1 ? 'disabled' : ''}>Move right →</button>
      </form>

      <form method="post" action="/tasks/column/${column.id}/delete">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="back" value="board">
        <button type="submit" class="linkish danger"
          data-confirm="Delete the ${column.name} column? Everything filled in under it goes too.">Delete column</button>
      </form>
    </div>
  </details>`;
}

/** The `+` at the end of the header row. */
function addColumnMenu(board, csrf) {
  return html`<details class="col-menu add pop">
    <summary aria-label="Add a column"
      ><span aria-hidden="true">+</span></summary>
    <div class="pop-panel">
      <form method="post" action="/tasks/b/${board.id}/column" class="stacked">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="back" value="board">
        <label class="field tight">Name
          <input type="text" name="name" maxlength="80" placeholder="Priority">
        </label>
        <label class="field tight">Type
          <select name="type">
            ${TYPE_NAMES.map((name) => html`<option value="${name}"
              >${TYPES[name].label} — ${TYPES[name].hint}</option>`)}
          </select>
        </label>
        <button class="btn primary small" type="submit">Add column</button>
      </form>
    </div>
  </details>`;
}

function addSubitemRow(item, view, hidden) {
  const { columns, csrf } = view;
  return html`<tr class="add-row subitem-row" data-child-of="${item.id}"
    ${hidden ? 'hidden' : ''}>
    <td colspan="${columns.length + 3}">
      <form method="post" action="/tasks/item/${item.id}/subitem">
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="text" name="title" maxlength="300" class="indented-input"
               placeholder="+ Add subitem" aria-label="New subitem under ${item.title}">
        <button type="submit" class="visually-hidden">Add subitem</button>
      </form>
    </td>
  </tr>`;
}

/* --------------------------------------------------------------- one cell */

function cell(item, column, view) {
  const value = item.cells[column.id] ?? '';
  const editable = view.canEdit;

  switch (column.type) {
    case 'status':
    case 'priority': return statusCell(item, column, value, editable);
    case 'person': return personCell(item, column, value, view, editable);
    case 'date': return inputCell(item, column, value, 'date', editable);
    case 'number': return inputCell(item, column, value, 'number', editable);
    case 'checkbox': return tickCell(item, column, value, editable);
    case 'blockedby': return blockedByCell(item, editable);
    default: return inputCell(item, column, value, 'text', editable);
  }
}

function statusCell(item, column, value, editable) {
  const current = labelFor(column, value);
  const face = html`<span class="cell status ${current
    ? `bg-${colourClass(current.colour)}` : 'empty'}"
    >${current ? current.text : '—'}</span>`;

  if (!editable) return face;

  const labels = settingsOf(column).labels ?? [];
  return html`<details class="status-menu pop" data-item="${item.id}" data-column="${column.id}">
    <summary>${face}</summary>
    <div class="status-options pop-panel">
      ${labels.map((label) => html`<button type="button"
        class="bg-${colourClass(label.colour)}"
        data-choice="${label.id}" data-label="${label.text}"
        data-colour-class="${colourClass(label.colour)}">${label.text}</button>`)}
      <button type="button" class="clear" data-choice="" data-label="—"
              data-colour-class="">Clear</button>
      <!-- The label editor lives under board Settings, which is not where
           anyone looks when what they want is one more status. -->
      <a class="edit-labels" href="/tasks/column/${column.id}/labels">Add or edit labels…</a>
    </div>
  </details>`;
}

function personCell(item, column, value, view, editable) {
  const person = view.people.get(value);
  const face = person
    ? html`<span class="cell person"><span class="person-chip"
        title="${person.display_name || person.username}"
        >${initials(person.display_name || person.username)}</span></span>`
    : html`<span class="cell person empty">—</span>`;

  if (!editable) return face;

  return html`<details class="status-menu pop" data-item="${item.id}" data-column="${column.id}">
    <summary>${face}</summary>
    <div class="status-options pop-panel">
      ${[...view.people.values()].map((member) => html`<button type="button"
        class="bg-c5"
        data-choice="${member.id}"
        data-label="${initials(member.display_name || member.username)}"
        data-colour-class="c5">${member.display_name || member.username}</button>`)}
      <button type="button" class="clear" data-choice="" data-label="—"
              data-colour-class="">Clear</button>
    </div>
  </details>`;
}

/**
 * The Blocked by cell.
 *
 * Shows what the task is waiting on, and opens a picker to change it -- so the
 * whole feature is usable from the board without opening anything. The list
 * inside is left empty and filled in by app.js when the cell is opened; see the
 * blocker-options route for why.
 */
function blockedByCell(item, editable) {
  const blockers = item.blockers ?? [];
  const waiting = blockers.filter((blocker) => !blocker.finished);

  // Name the task rather than counting it -- "Choose the bath" tells you
  // something, "1" does not. Extra blockers become a +N after the first, and
  // the full list is in the tooltip either way.
  const all = blockers.map((blocker) => blocker.title).join(', ');
  const first = waiting[0] ?? blockers[0];
  const extra = blockers.length - 1;

  let face;
  if (!blockers.length) {
    face = html`<span class="cell blocked empty">—</span>`;
  } else if (waiting.length) {
    face = html`<span class="cell blocked waiting" title="Waiting on ${all}">
      ${padlock()}<span class="who">${first.title}</span>${extra
    ? html`<span class="more">+${extra}</span>` : ''}
    </span>`;
  } else {
    // Everything it was waiting on is finished. Struck through, the way a
    // completed date reads on a board.
    face = html`<span class="cell blocked clear" title="${all} — all finished">
      ${tickMark()}<span class="who done">${first.title}</span>${extra
    ? html`<span class="more">+${extra}</span>` : ''}
    </span>`;
  }

  if (!editable) return face;

  return html`<details class="status-menu blocked-menu pop" data-item="${item.id}" data-blockedby>
    <summary>${face}</summary>
    <div class="status-options pop-panel" data-blocker-panel>
      <p class="muted small pad-empty">Loading…</p>
    </div>
  </details>`;
}

function padlock() {
  return html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none"
    stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2"/>
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" stroke-linecap="round"/>
  </svg>`;
}

function inputCell(item, column, value, kind, editable) {
  const type = kind === 'date' ? 'date' : 'text';
  return html`<input class="cell ${kind} ${value ? '' : 'empty'}" type="${type}"
    value="${value}" data-item="${item.id}" data-column="${column.id}"
    ${kind === 'number' ? 'inputmode="decimal"' : ''}
    ${editable ? '' : 'readonly'}
    aria-label="${column.name} for ${item.title}"
    placeholder="${kind === 'date' ? '' : '—'}">`;
}

function tickCell(item, column, value, editable) {
  if (!editable) {
    return html`<span class="cell"><span class="tick ${value ? 'on' : ''}">${value ? tickMark() : ''}</span></span>`;
  }
  return html`<button type="button" class="cell" data-tick="${value ? '1' : '0'}"
    data-item="${item.id}" data-column="${column.id}"
    aria-label="${column.name} for ${item.title}">
    <span class="tick ${value ? 'on' : ''}">${tickMark()}</span>
  </button>`;
}

function tickMark() {
  return html`<svg viewBox="0 0 24 24" width="13" height="13" fill="none"
    stroke="currentColor" stroke-width="3.2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>`;
}

function groupMenu(group, csrf) {
  return html`<details class="row-menu pop">
    <summary aria-label="Group actions">···</summary>
    <div class="pop-panel">
      <a href="/tasks/group/${group.id}/edit">Rename or recolour</a>
      <form method="post" action="/tasks/group/${group.id}/delete">
        <input type="hidden" name="_csrf" value="${csrf}">
        <button type="submit" class="linkish danger"
          data-confirm="Delete the ${group.name} group and everything in it?">Delete group and its items</button>
      </form>
    </div>
  </details>`;
}

/* ------------------------------------------------------------ kanban view */

/**
 * The same items, stacked into columns by one status column.
 *
 * Read-only by design: it is a way of looking at the board, not a second place
 * to edit it, which keeps one set of write paths rather than two.
 */
export function kanbanView({ items, column, groups }) {
  if (!column) {
    return html`<div class="empty">
      <p>The board needs a Status column before it can be shown as a kanban.</p>
    </div>`;
  }

  const labels = settingsOf(column).labels ?? [];
  const groupName = new Map(groups.map((group) => [group.id, group.name]));

  const buckets = labels.map((label) => ({
    label,
    items: items.filter((item) => item.cells[column.id] === label.id),
  }));
  const unset = items.filter((item) => !labelFor(column, item.cells[column.id] ?? ''));

  return html`<div class="kanban">
    ${buckets.map((bucket) => kanbanColumn(
    bucket.label.text, colourClass(bucket.label.colour), bucket.items, groupName,
  ))}
    ${unset.length ? kanbanColumn('No status', 'c8', unset, groupName) : ''}
  </div>`;
}

function kanbanColumn(title, colour, items, groupName) {
  return html`<div class="kanban-col">
    <h3 class="bg-${colour}">${title}<span class="n">${items.length}</span></h3>
    ${items.map((item) => html`<a class="kanban-card" href="/tasks/item/${item.id}">
      ${item.parentTitle ? html`<span class="parent-of">${item.parentTitle} ›</span>` : ''}
      ${item.title}
      <span class="meta">${groupName.get(item.group_id) ?? ''}</span>
    </a>`)}
    ${items.length === 0 ? html`<p class="muted small pad-empty">Empty</p>` : ''}
  </div>`;
}

/* -------------------------------------------------------------- item page */

export function itemPage({
  item, board, columns, cells, comments, people, csrf, canEdit,
  blockers = [], blocking = [], candidates = [], hasStatusColumn = true,
  notice = '', parent = null, children = [],
}) {
  const waitingOn = blockers.filter((blocker) => !blocker.finished);

  return html`<div class="page-head">
    <div>
      <h1>${item.title}</h1>
      <p class="lede">In <a href="/tasks/b/${board.id}">${board.name}</a>
        ${parent ? html`· a subitem of
          <a href="/tasks/item/${parent.id}">${parent.title}</a>` : ''}
        · added ${item.created_at}</p>
    </div>
  </div>

  ${notice ? html`<p class="notice error">${notice}</p>` : ''}

  ${waitingOn.length ? html`<p class="notice warn">
    <strong>Waiting on ${waitingOn.length === 1 ? 'another item' : `${waitingOn.length} other items`}.</strong>
    ${waitingOn.map((blocker) => blocker.title).join(', ')}
  </p>` : ''}

  <div class="panel">
    <h2>Details</h2>
    <table class="list">
      <tbody>
        <!-- A Blocked by column holds no value of its own, so listing it here
             would only ever show a dash. Its own panel below says the real
             thing. -->
        ${columns.filter((column) => !isVirtual(column)).map((column) => html`<tr>
          <th class="th-label">${column.name}</th>
          <td>${describe(column, cells[column.id] ?? '', people)}</td>
        </tr>`)}
      </tbody>
    </table>
    <p class="small muted note">
      Values are edited on the board itself, where clicking a cell changes it.
    </p>
  </div>

  ${!parent ? html`<div class="panel">
    <h2>Subitems</h2>
    ${children.length === 0
    ? html`<p class="muted">None yet.</p>`
    : html`<ul class="blocker-list">
        ${children.map((child) => html`<li>
          <a href="/tasks/item/${child.id}">${child.title}</a>
        </li>`)}
      </ul>`}
    ${canEdit ? html`<form method="post" action="/tasks/item/${item.id}/subitem"
      class="row bottom mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">Add a subitem
        <input type="text" name="title" maxlength="300" required
               placeholder="Something smaller that is part of this">
      </label>
      <div class="grow-0"><button class="btn" type="submit">Add</button></div>
    </form>` : ''}
    <p class="small muted note">
      Subitems live in the same group and use the same columns as the rest of
      the board, and they only go one level deep.
    </p>
  </div>` : ''}

  <div class="panel" id="blocked-by">
    <h2>Blocked by</h2>
    <p class="muted small">
      Things that have to be finished before this one can start.
      ${hasStatusColumn
    ? html`A blocker clears itself when its status is set to one ticked as
           "counts as finished" in the label editor.`
    : html`This board has no Status column, so a blocker here only clears when
           the blocking item is deleted.`}
    </p>

    ${blockers.length === 0
    ? html`<p class="muted">Nothing is in the way.</p>`
    : html`<ul class="blocker-list">
        ${blockers.map((blocker) => html`<li class="${blocker.finished ? 'finished' : ''}">
          <a href="/tasks/item/${blocker.id}">${blocker.title}</a>
          <span class="tag ${blocker.finished ? 'tag-c9' : 'tag-c3'}">
            ${blocker.finished ? 'finished' : 'still open'}</span>
          ${canEdit ? html`<form method="post"
            action="/tasks/item/${item.id}/blocker/remove" class="inline-block">
            <input type="hidden" name="_csrf" value="${csrf}">
            <input type="hidden" name="blockerId" value="${blocker.id}">
            <button class="btn small" type="submit">Remove</button>
          </form>` : ''}
        </li>`)}
      </ul>`}

    ${canEdit && candidates.length ? html`<form method="post"
      action="/tasks/item/${item.id}/blocker/add" class="row bottom mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field tight">This item is waiting on
        <select name="blockerId">
          ${candidates.map((other) => html`<option value="${other.id}"
            >${other.parent_title ? `${other.parent_title} › ` : ''}${other.title}</option>`)}
        </select>
      </label>
      <div class="grow-0"><button class="btn" type="submit">Add</button></div>
    </form>` : ''}

    ${canEdit && !candidates.length && blockers.length === 0
    ? html`<p class="small muted mt-1">
        There is nothing else on this board for it to wait on yet.</p>` : ''}

    ${blocking.length ? html`<h3 class="mt-2">Blocking</h3>
      <p class="muted small">These are waiting on this item.</p>
      <ul class="blocker-list">
        ${blocking.map((other) => html`<li>
          <a href="/tasks/item/${other.id}">${other.title}</a>
        </li>`)}
      </ul>` : ''}
  </div>

  <div class="panel">
    <h2>Comments</h2>
    ${comments.length === 0 ? html`<p class="muted">No comments yet.</p>` : ''}
    ${comments.map((comment) => html`<div class="comment">
      <span class="who">${comment.display_name || comment.username || 'Deleted user'}</span>
      <span class="when">${comment.created_at}</span>
      <p class="body">${comment.body}</p>
    </div>`)}

    <form method="post" action="/tasks/item/${item.id}/comment" class="mt-1">
      <input type="hidden" name="_csrf" value="${csrf}">
      <label class="field">Add a comment
        <textarea name="body" maxlength="4000" required
                  placeholder="What's happening with this?"></textarea>
      </label>
      <button class="btn primary" type="submit">Post comment</button>
    </form>
  </div>

  ${canEdit ? html`<div class="panel">
    <h2>Danger zone</h2>
    <form method="post" action="/tasks/item/${item.id}/delete">
      <input type="hidden" name="_csrf" value="${csrf}">
      <button class="btn danger" type="submit">Delete this item</button>
    </form>
  </div>` : ''}`;
}

function describe(column, value, people) {
  if (!value) return html`<span class="muted">—</span>`;
  switch (column.type) {
    case 'status':
    case 'priority': {
      const label = labelFor(column, value);
      return label
        ? html`<span class="tag tag-${colourClass(label.colour)}">${label.text}</span>`
        : html`<span class="muted">—</span>`;
    }
    case 'person': {
      const person = people.get(value);
      return person ? html`${person.display_name || person.username}` : html`<span class="muted">—</span>`;
    }
    case 'checkbox': return html`Yes`;
    default: return html`${value}`;
  }
}

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
