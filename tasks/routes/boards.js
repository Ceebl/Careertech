// Workspaces, boards, groups, columns and items.
//
// Every route that touches something with an id goes through one of the
// require* guards from lib/access.js. Those fetch the row and the caller's role
// in the same query, so there is no moment in this file where we are holding a
// board without already knowing the caller is allowed to have it.

import { Router } from 'express';
import { render, notice } from '../views/layout.js';
import { homePage, workspacePage, boardSettingsPage, labelsPage, groupEditPage } from '../views/pages.js';
import { tableView, kanbanView, itemPage } from '../views/board.js';
import {
  requireWorkspace, requireBoard, requireItem, requireGroup, requireColumn,
  columnFor, itemFor, atLeast,
} from '../lib/access.js';
import {
  createWorkspace, workspacesFor, members, setMember, dropMember, rename, archive,
} from '../store/workspaces.js';
import {
  createBoard, boardsInWorkspace, groupsOf, columnsOf, renameBoard, archiveBoard,
  addGroup, renameGroup, deleteGroup, addColumn, updateColumn, deleteColumn,
} from '../store/boards.js';
import {
  boardContents, createItem, renameItem, archiveItem, setCell, cellsOf,
  addComment, commentsFor, blockersOf, blockingFrom, addBlocker, dropBlocker,
  wouldLoop, blockersByItem, itemsOnBoard, releaseDependents, releaseItem,
} from '../store/items.js';
import { listUsers } from '../store/users.js';
import {
  settingsOf, isType, paletteColour, doneLabelIds, isVirtual,
} from '../lib/columns.js';
import { html } from '../lib/html.js';
import { log } from '../lib/audit.js';
import { wantsJson } from '../lib/http.js';

const router = Router();

/* ------------------------------------------------------------- workspaces */

router.get('/', (req, res) => {
  render(res, {
    title: 'Workspaces',
    crumbs: [{ label: 'Workspaces' }],
    body: homePage({ workspaces: workspacesFor(req.user.id), csrf: res.locals.csrf }),
  });
});

router.post('/workspace', (req, res) => {
  const id = createWorkspace({
    name: req.body?.name,
    colour: req.body?.colour,
    userId: req.user.id,
  });
  log(req, 'workspace.create', id);
  res.redirect(`/tasks/w/${id}`);
});

router.get('/w/:workspaceId', requireWorkspace('viewer', 'workspaceId'), (req, res) => {
  const people = members(req.workspace.id);
  const inWorkspace = new Set(people.map((person) => person.id));

  render(res, {
    title: req.workspace.name,
    crumbs: [{ label: 'Workspaces', href: '/tasks/' }, { label: req.workspace.name }],
    body: workspacePage({
      workspace: req.workspace,
      boards: boardsInWorkspace(req.workspace.id),
      members: people,
      // Only offered for adding; nobody's account details leak beyond a name.
      allUsers: req.workspace.role === 'owner'
        ? listUsers().filter((user) => !inWorkspace.has(user.id) && !user.disabled_at)
        : [],
      csrf: res.locals.csrf,
      canEdit: atLeast(req.workspace.role, 'member'),
      isOwner: req.workspace.role === 'owner',
      notice: req.query.saved ? 'Saved.' : '',
    }),
  });
});

router.post('/w/:workspaceId/rename', requireWorkspace('owner', 'workspaceId'), (req, res) => {
  rename(req.workspace.id, req.body?.name, req.body?.colour);
  log(req, 'workspace.rename', req.workspace.id);
  res.redirect(`/tasks/w/${req.workspace.id}?saved=1`);
});

router.post('/w/:workspaceId/archive', requireWorkspace('owner', 'workspaceId'), (req, res) => {
  archive(req.workspace.id);
  log(req, 'workspace.archive', `${req.workspace.id} (${req.workspace.name})`);
  res.redirect('/tasks/');
});

router.post('/w/:workspaceId/member', requireWorkspace('owner', 'workspaceId'), (req, res) => {
  const userId = String(req.body?.userId ?? '');
  const role = String(req.body?.role ?? 'member');

  // Owners cannot remove themselves by accident and leave the workspace
  // ownerless; setMember and dropMember both refuse that and say so.
  const done = role === 'remove'
    ? dropMember(req.workspace.id, userId)
    : setMember(req.workspace.id, userId, role);

  if (!done) {
    res.status(400);
    return render(res, {
      title: 'Not possible',
      body: notice(
        'A workspace has to keep at least one owner, so that change was not made.',
        `/tasks/w/${req.workspace.id}`,
      ),
    });
  }

  log(req, 'workspace.member', `${req.workspace.id} ${userId} -> ${role}`);
  return res.redirect(`/tasks/w/${req.workspace.id}?saved=1`);
});

/* ----------------------------------------------------------------- boards */

router.post('/w/:workspaceId/board', requireWorkspace('member', 'workspaceId'), (req, res) => {
  const id = createBoard({ workspaceId: req.workspace.id, name: req.body?.name });
  log(req, 'board.create', id);
  res.redirect(`/tasks/b/${id}`);
});

router.get('/b/:boardId', requireBoard('viewer', 'boardId'), (req, res) => {
  const board = req.board;
  const columns = columnsOf(board.id);
  const groups = groupsOf(board.id);
  const items = boardContents(board.id);
  const people = new Map(members(board.workspace_id).map((person) => [person.id, person]));
  const canEdit = atLeast(board.role, 'member');

  // The first status column is the one that decides whether a blocker counts as
  // finished, the same column the kanban view groups by.
  const statusColumn = columns.find((column) => column.type === 'status') ?? null;
  const byItem = blockersByItem(board.id, statusColumn, doneLabelIds(statusColumn));
  for (const item of items) {
    item.blockers = byItem.get(item.id) ?? [];
    item.blockedBy = item.blockers.filter((blocker) => !blocker.finished)
      .map((blocker) => blocker.title);
  }

  const view = String(req.query.view ?? 'table') === 'kanban' ? 'kanban' : 'table';

  render(res, {
    title: board.name,
    wide: true,
    crumbs: [
      { label: 'Workspaces', href: '/tasks/' },
      { label: board.workspace_name, href: `/tasks/w/${board.workspace_id}` },
      { label: board.name },
    ],
    actions: viewTabs(board.id, view, canEdit),
    body: view === 'kanban'
      ? kanbanView({ items, groups, column: columns.find((c) => c.type === 'status') })
      : tableView({ board, groups, columns, items, people, csrf: res.locals.csrf, canEdit }),
  });
});

function viewTabs(boardId, current, canEdit) {
  return html`<nav class="view-tabs">
    <a class="${current === 'table' ? 'on' : ''}" href="/tasks/b/${boardId}">Table</a>
    <a class="${current === 'kanban' ? 'on' : ''}" href="/tasks/b/${boardId}?view=kanban">Kanban</a>
    ${canEdit ? html`<a href="/tasks/b/${boardId}/settings">Settings</a>` : ''}
  </nav>`;
}

router.get('/b/:boardId/settings', requireBoard('member', 'boardId'), (req, res) => {
  render(res, {
    title: `${req.board.name} settings`,
    crumbs: [
      { label: req.board.workspace_name, href: `/tasks/w/${req.board.workspace_id}` },
      { label: req.board.name, href: `/tasks/b/${req.board.id}` },
      { label: 'Settings' },
    ],
    body: boardSettingsPage({
      board: req.board,
      columns: columnsOf(req.board.id),
      csrf: res.locals.csrf,
      notice: req.query.saved ? 'Saved.' : '',
    }),
  });
});

router.post('/b/:boardId/rename', requireBoard('member', 'boardId'), (req, res) => {
  renameBoard(req.board.id, req.body?.name, req.body?.description);
  log(req, 'board.rename', req.board.id);
  res.redirect(`/tasks/b/${req.board.id}/settings?saved=1`);
});

router.post('/b/:boardId/archive', requireBoard('member', 'boardId'), (req, res) => {
  archiveBoard(req.board.id);
  log(req, 'board.archive', `${req.board.id} (${req.board.name})`);
  res.redirect(`/tasks/w/${req.board.workspace_id}`);
});

router.post('/b/:boardId/group', requireBoard('member', 'boardId'), (req, res) => {
  addGroup(req.board.id, req.body?.name || 'New group', req.body?.colour);
  log(req, 'group.create', req.board.id);
  res.redirect(`/tasks/b/${req.board.id}`);
});

router.post('/b/:boardId/column', requireBoard('member', 'boardId'), (req, res) => {
  const type = String(req.body?.type ?? '');
  if (!isType(type)) {
    res.status(400);
    return render(res, {
      title: 'Unknown column type',
      body: notice('That is not a column type this app knows about.',
        `/tasks/b/${req.board.id}/settings`),
    });
  }
  if (type === 'blockedby' && columnsOf(req.board.id).some((c) => c.type === 'blockedby')) {
    res.status(400);
    return render(res, {
      title: 'Already there',
      body: notice(
        'This board already has a Blocked by column. It shows the links between '
        + 'items rather than a value of its own, so a second one would only ever '
        + 'repeat the first.',
        `/tasks/b/${req.board.id}/settings`,
      ),
    });
  }

  addColumn(req.board.id, { name: req.body?.name, type });
  log(req, 'column.create', `${req.board.id} ${type}`);
  return res.redirect(`/tasks/b/${req.board.id}/settings?saved=1`);
});

/* ----------------------------------------------------------------- groups */

router.get('/group/:groupId/edit', requireGroup('member', 'groupId'), (req, res) => {
  render(res, {
    title: 'Rename group',
    crumbs: [{ label: 'Group' }],
    body: groupEditPage({
      group: req.group,
      board: { id: req.group.board_id },
      csrf: res.locals.csrf,
    }),
  });
});

router.post('/group/:groupId/edit', requireGroup('member', 'groupId'), (req, res) => {
  renameGroup(req.group.id, req.body?.name, req.body?.colour);
  log(req, 'group.rename', req.group.id);
  res.redirect(`/tasks/b/${req.group.board_id}`);
});

router.post('/group/:groupId/delete', requireGroup('member', 'groupId'), (req, res) => {
  const done = deleteGroup(req.group.board_id, req.group.id);
  log(req, done ? 'group.delete' : 'group.delete.refused', req.group.id);
  if (!done) {
    res.status(400);
    return render(res, {
      title: 'Not possible',
      body: notice(
        'A board needs at least one group, because items have to live somewhere.',
        `/tasks/b/${req.group.board_id}`,
      ),
    });
  }
  return res.redirect(`/tasks/b/${req.group.board_id}`);
});

router.post('/group/:groupId/item', requireGroup('member', 'groupId'), (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (title) {
    createItem({
      boardId: req.group.board_id,
      groupId: req.group.id,
      title,
      userId: req.user.id,
    });
  }
  res.redirect(`/tasks/b/${req.group.board_id}`);
});

/* ---------------------------------------------------------------- columns */

router.post('/column/:columnId/rename', requireColumn('member', 'columnId'), (req, res) => {
  updateColumn(req.column, {
    name: req.body?.name,
    settings: settingsOf(req.column),
  });
  log(req, 'column.rename', req.column.id);
  res.redirect(`/tasks/b/${req.column.board_id}/settings?saved=1`);
});

router.post('/column/:columnId/delete', requireColumn('member', 'columnId'), (req, res) => {
  deleteColumn(req.column.id);
  log(req, 'column.delete', `${req.column.id} (${req.column.name})`);
  res.redirect(`/tasks/b/${req.column.board_id}/settings?saved=1`);
});

router.get('/column/:columnId/labels', requireColumn('member', 'columnId'), (req, res) => {
  if (req.column.type !== 'status') {
    return res.redirect(`/tasks/b/${req.column.board_id}/settings`);
  }
  return render(res, {
    title: 'Labels',
    crumbs: [{ label: 'Labels' }],
    body: labelsPage({
      column: req.column,
      board: { id: req.column.board_id },
      csrf: res.locals.csrf,
    }),
  });
});

router.post('/column/:columnId/labels', requireColumn('member', 'columnId'), (req, res) => {
  const existing = settingsOf(req.column).labels ?? [];

  const labels = existing
    .map((label, index) => ({
      id: String(req.body?.[`id${index}`] ?? label.id),
      text: String(req.body?.[`text${index}`] ?? label.text),
      colour: paletteColour(req.body?.[`colour${index}`], label.colour),
      done: req.body?.[`done${index}`] === '1',
      remove: req.body?.[`delete${index}`] === '1',
    }))
    .filter((label) => !label.remove);

  const added = String(req.body?.newText ?? '').trim();
  if (added) {
    labels.push({
      id: undefined,
      text: added,
      colour: paletteColour(req.body?.newColour),
      done: req.body?.newDone === '1',
    });
  }

  updateColumn(req.column, {
    name: req.column.name,
    settings: { labels, unblockedLabelId: String(req.body?.unblockedLabelId ?? '') },
  });
  log(req, 'column.labels', req.column.id);
  res.redirect(`/tasks/b/${req.column.board_id}/settings?saved=1`);
});

/* ------------------------------------------------------------------ items */

router.get('/item/:itemId', requireItem('viewer', 'itemId'), (req, res) => {
  const columns = columnsOf(req.item.board_id);
  const people = new Map(members(req.item.workspace_id).map((p) => [p.id, p]));

  const statusColumn = columns.find((column) => column.type === 'status') ?? null;
  const doneIds = doneLabelIds(statusColumn);
  const blockers = blockersOf(req.item.id).map((blocker) => ({
    ...blocker,
    finished: doneIds.has(cellsOf(blocker.id)[statusColumn?.id] ?? ''),
  }));
  const alreadyBlocking = new Set(blockers.map((blocker) => blocker.id));

  render(res, {
    title: req.item.title,
    crumbs: [
      { label: req.item.workspace_name, href: `/tasks/w/${req.item.workspace_id}` },
      { label: req.item.board_name, href: `/tasks/b/${req.item.board_id}` },
      { label: req.item.title },
    ],
    body: itemPage({
      item: req.item,
      board: { id: req.item.board_id, name: req.item.board_name },
      columns,
      cells: cellsOf(req.item.id),
      comments: commentsFor(req.item.id),
      people,
      blockers,
      blocking: blockingFrom(req.item.id),
      // Anything else on this board that is not already in the list. A choice
      // that would make a loop is refused on submit, with a reason.
      candidates: itemsOnBoard(req.item.board_id)
        .filter((other) => other.id !== req.item.id && !alreadyBlocking.has(other.id)),
      hasStatusColumn: Boolean(statusColumn),
      notice: req.query.problem ? String(req.query.problem).slice(0, 200) : '',
      csrf: res.locals.csrf,
      canEdit: atLeast(req.item.role, 'member'),
    }),
  });
});

/* -------------------------------------------------------------- blocked by */

/**
 * What this item is waiting on, and what it could wait on.
 *
 * Fetched when a Blocked by cell is opened rather than baked into the board.
 * A board of 200 items would otherwise carry 200 copies of a 200-entry list in
 * its HTML, which is 40,000 options nobody asked for.
 */
router.get('/item/:itemId/blocker-options', requireItem('viewer', 'itemId'), (req, res) => {
  const columns = columnsOf(req.item.board_id);
  const statusColumn = columns.find((column) => column.type === 'status') ?? null;
  const doneIds = doneLabelIds(statusColumn);

  const blockers = blockersOf(req.item.id).map((blocker) => ({
    id: blocker.id,
    title: blocker.title,
    finished: doneIds.has(cellsOf(blocker.id)[statusColumn?.id] ?? ''),
  }));
  const taken = new Set(blockers.map((blocker) => blocker.id));

  res.json({
    canEdit: atLeast(req.item.role, 'member'),
    blockers,
    candidates: itemsOnBoard(req.item.board_id)
      .filter((other) => other.id !== req.item.id && !taken.has(other.id)),
  });
});

router.post('/item/:itemId/blocker/add', requireItem('member', 'itemId'), (req, res) => {
  const back = `/tasks/item/${req.item.id}`;
  // The blocker is fetched through the same membership-checked path as the
  // item, so naming something in a workspace you are not in is a 404, not a
  // dependency.
  const blocker = itemFor(req.user.id, String(req.body?.blockerId ?? ''));

  // The same refusal has to reach a form post and a click in a board cell, so
  // it is written once and delivered in whichever form the caller can use.
  const refuseWith = (message) => (wantsJson(req)
    ? res.status(400).json({ error: message })
    : res.redirect(`${back}?problem=${encodeURIComponent(message)}`));

  if (!blocker || blocker.board_id !== req.item.board_id) {
    return refuseWith('A task can only wait on something else from the same board.');
  }
  if (blocker.id === req.item.id) {
    return refuseWith('A task cannot wait on itself.');
  }
  if (wouldLoop(req.item.id, blocker.id)) {
    return refuseWith(
      `"${blocker.title}" is already waiting on this task, directly or through `
      + 'something else. Linking them this way round as well would mean neither '
      + 'could ever start.',
    );
  }

  addBlocker(req.item.id, blocker.id);
  log(req, 'item.blocker.add', `${req.item.id} <- ${blocker.id}`);
  return wantsJson(req) ? res.json({ ok: true }) : res.redirect(back);
});

router.post('/item/:itemId/blocker/remove', requireItem('member', 'itemId'), (req, res) => {
  dropBlocker(req.item.id, String(req.body?.blockerId ?? ''));
  log(req, 'item.blocker.remove', `${req.item.id} <- ${req.body?.blockerId ?? ''}`);

  // Removing the last thing in the way frees the item just as finishing it
  // would, so the same check runs here.
  const statusColumn = columnsOf(req.item.board_id).find((c) => c.type === 'status') ?? null;
  const released = releaseItem(req.item.id, statusColumn);

  if (wantsJson(req)) return res.json({ ok: true, released: released ? 1 : 0 });
  return res.redirect(`/tasks/item/${req.item.id}`);
});

router.post('/item/:itemId/title', requireItem('member', 'itemId'), (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'An item needs a name' });
  renameItem(req.item.id, title);
  return res.json({ ok: true, title });
});

/**
 * Write one cell. Called by the inline editing on the board.
 *
 * The column is fetched through the same membership-checked path as the item,
 * and then the two are checked against each other. Without that last check a
 * member of one board could aim a write at a column id belonging to a different
 * board they happen to be in -- which would not leak anything, but would write
 * nonsense into the database.
 */
router.post('/item/:itemId/cell', requireItem('member', 'itemId'), (req, res) => {
  const column = columnFor(req.user.id, String(req.body?.columnId ?? ''));
  if (!column || column.board_id !== req.item.board_id) {
    return res.status(404).json({ error: 'No such column on this board' });
  }

  if (isVirtual(column)) {
    return res.status(400).json({
      error: 'A Blocked by cell is edited by linking tasks, not by typing in it.',
    });
  }

  // A Person cell may only name somebody who is actually in this workspace.
  // Nothing else in the system would notice, and it would quietly show a name
  // from a workspace the viewer has no business seeing.
  if (column.type === 'person' && req.body?.value) {
    const allowed = new Set(members(req.item.workspace_id).map((person) => person.id));
    if (!allowed.has(String(req.body.value))) {
      return res.status(400).json({ error: 'That person is not in this workspace' });
    }
  }

  const value = setCell(req.item, column, req.body?.value);

  // Marking something finished is what frees whatever was waiting on it, so
  // this is the moment to look. The count goes back to the browser, which
  // reloads the board so the change is visible rather than merely saved.
  let released = 0;
  if (column.type === 'status') {
    released = releaseDependents(req.item.id, column);
    if (released) log(req, 'item.unblocked', `${released} released by ${req.item.id}`);
  }

  return res.json({ ok: true, value, released });
});

router.post('/item/:itemId/comment', requireItem('viewer', 'itemId'), (req, res) => {
  addComment(req.item.id, req.user.id, req.body?.body);
  res.redirect(`/tasks/item/${req.item.id}`);
});

router.post('/item/:itemId/delete', requireItem('member', 'itemId'), (req, res) => {
  archiveItem(req.item.id);
  log(req, 'item.delete', `${req.item.id} (${req.item.title})`);
  res.redirect(`/tasks/b/${req.item.board_id}`);
});

export default router;
