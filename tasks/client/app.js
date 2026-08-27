// Everything the browser does.
//
// The rule this file follows: the app must still work with it switched off.
// Adding items, creating boards, inviting people, signing in -- all of that is
// ordinary HTML forms that post and reload. What lives here is only the part
// that makes a board feel like a board: clicking a cell and having it save,
// with no save button and no page reload.
//
// One listener on the document handles everything, so rows added after load
// behave exactly like rows that were there at the start.

(function tasks() {
  'use strict';

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

  /* ------------------------------------------------------------- theming */

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-theme-toggle]');
    if (!toggle) return;

    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    // Remembered in a cookie rather than localStorage so the server can stamp
    // the right theme into the first byte of the page and avoid a white flash.
    document.cookie = `tasks_theme=${next}; path=/tasks; max-age=31536000; samesite=lax`;
  });

  /* --------------------------------------------------------------- saving */

  let flashTimer = null;

  function flash(message, bad) {
    let node = document.querySelector('.flash');
    if (!node) {
      node = document.createElement('div');
      node.className = 'flash';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.toggle('bad', Boolean(bad));
    node.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => node.classList.remove('show'), bad ? 4000 : 1200);
  }

  /**
   * Post JSON to the app and return the parsed reply.
   * Anything other than a clean 2xx surfaces as a message rather than silence --
   * a to-do app that quietly fails to save is worse than one that cannot save.
   */
  async function send(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      // Never send this cookie anywhere but here.
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      flash('Signed out. Reloading…', true);
      setTimeout(() => window.location.reload(), 800);
      throw new Error('signed out');
    }
    if (!response.ok) {
      let message = 'Could not save';
      try { message = (await response.json()).error || message; } catch { /* not json */ }
      flash(message, true);
      throw new Error(message);
    }
    return response.json();
  }

  function saveCell(itemId, columnId, value) {
    return send(`/tasks/item/${itemId}/cell`, { columnId, value });
  }

  /* --------------------------------------------------- status and person */

  document.addEventListener('click', async (event) => {
    const choice = event.target.closest('[data-choice]');
    if (!choice) return;

    const cell = choice.closest('[data-item][data-column]');
    if (!cell) return;

    const value = choice.dataset.choice;
    let result;
    try {
      result = await saveCell(cell.dataset.item, cell.dataset.column, value);
    } catch { return; }

    // Marking something finished can free tasks that were waiting on it, and
    // those are other rows on the page. Redrawing is the honest way to show
    // that -- patching one cell would leave the rest of the board lying.
    if (result?.released) {
      const n = result.released;
      flash(`Saved · ${n} task${n === 1 ? '' : 's'} unblocked`);
      setTimeout(() => window.location.reload(), 900);
      return;
    }

    // Redraw the closed cell from the chosen option, so the change is visible
    // immediately rather than after a reload. Classes rather than inline style:
    // the page's Content-Security-Policy forbids style attributes, and every
    // colour already has a class waiting for it in app.css.
    const face = cell.querySelector('summary .cell');
    if (face) {
      const label = choice.dataset.label || '';
      const colour = choice.dataset.colourClass || '';

      // Built with createElement and textContent rather than innerHTML, so
      // there is no path in this file that turns a string into markup.
      face.replaceChildren();

      if (face.classList.contains('person')) {
        face.className = `cell person${value ? '' : ' empty'}`;
        if (value) {
          const chip = document.createElement('span');
          chip.className = 'person-chip';
          chip.textContent = label;
          face.appendChild(chip);
        } else {
          face.textContent = label;
        }
      } else {
        face.className = `cell status${value ? ` bg-${colour}` : ' empty'}`;
        face.textContent = label;
      }
    }
    cell.querySelector('details')?.removeAttribute('open');
    if (cell.tagName === 'DETAILS') cell.removeAttribute('open');
    flash('Saved');
  });

  /* ------------------------------------------------------------- tickbox */

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-tick]');
    if (!button) return;

    const on = button.dataset.tick === '1';
    const next = on ? '' : '1';
    try {
      await saveCell(button.dataset.item, button.dataset.column, next);
    } catch { return; }

    button.dataset.tick = next ? '1' : '0';
    button.querySelector('.tick')?.classList.toggle('on', Boolean(next));
  });

  /* -------------------------------------------- free-typing cells & titles */

  // Saved when the field loses focus or Enter is pressed, not on every
  // keystroke -- one request per edit rather than one per letter.
  document.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-item]');
    if (!input) return;

    try {
      if (input.dataset.field === 'title') {
        const title = input.value.trim();
        if (!title) { input.value = input.defaultValue; return; }
        await send(`/tasks/item/${input.dataset.item}/title`, { title });
      } else {
        const saved = await saveCell(input.dataset.item, input.dataset.column, input.value);
        // Show what was actually stored, so a rejected value corrects itself
        // in front of you instead of looking saved when it was not.
        input.value = saved.value ?? '';
        // Keep the styling honest: an emptied cell has to look empty again.
        input.classList.toggle('empty', !input.value);
      }
      input.defaultValue = input.value;
      flash('Saved');
    } catch { /* already reported */ }
  });

  document.addEventListener('keydown', (event) => {
    const input = event.target.closest('input[data-item]');
    if (!input) return;
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { input.value = input.defaultValue; input.blur(); }
  });

  /* ------------------------------------------------- blocked by, on the board */

  // A Blocked by cell is filled in when it opens rather than when the page
  // loads: see the blocker-options route for why every row cannot carry a copy
  // of the whole board.
  async function fillBlockerMenu(details) {
    const panel = details.querySelector('[data-blocker-panel]');
    if (!panel) return;

    panel.replaceChildren(text('p', 'Loading…', 'muted small pad-empty'));

    let data;
    try {
      const response = await fetch(`/tasks/item/${details.dataset.item}/blocker-options`, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('could not load');
      data = await response.json();
    } catch {
      panel.replaceChildren(text('p', 'Could not load the list.', 'muted small pad-empty'));
      return;
    }

    panel.replaceChildren();

    if (data.blockers.length) {
      panel.appendChild(text('p', 'Waiting on', 'menu-heading'));
      for (const blocker of data.blockers) {
        const row = document.createElement('div');
        row.className = `blocker-row${blocker.finished ? ' finished' : ''}`;
        row.appendChild(text('span', blocker.title, 'name'));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'drop';
        remove.dataset.removeBlocker = blocker.id;
        remove.textContent = '×';
        remove.title = `Stop waiting on ${blocker.title}`;
        row.appendChild(remove);

        panel.appendChild(row);
      }
    }

    if (data.candidates.length) {
      panel.appendChild(text('p', data.blockers.length ? 'Also wait on' : 'Wait on', 'menu-heading'));
      for (const candidate of data.candidates) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'pick';
        add.dataset.addBlocker = candidate.id;
        add.textContent = candidate.title;
        panel.appendChild(add);
      }
    } else if (!data.blockers.length) {
      panel.appendChild(text('p', 'There is nothing else on this board yet.', 'muted small pad-empty'));
    }

    // The panel just changed height, so it may no longer be where it fits.
    placeMenu(details);
  }

  // Built rather than written as markup, so no string in this file is ever
  // parsed as HTML.
  function text(tag, content, className) {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  document.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add-blocker]');
    const drop = event.target.closest('[data-remove-blocker]');
    if (!add && !drop) return;

    const cell = (add ?? drop).closest('[data-blockedby]');
    if (!cell) return;

    const item = cell.dataset.item;
    const url = add
      ? `/tasks/item/${item}/blocker/add`
      : `/tasks/item/${item}/blocker/remove`;
    const blockerId = add ? add.dataset.addBlocker : drop.dataset.removeBlocker;

    try {
      await send(url, { blockerId });
    } catch { return; }

    // Linking or unlinking can change this row's status and the padlock on
    // others, so the board is redrawn rather than patched.
    flash('Saved');
    setTimeout(() => window.location.reload(), 500);
  });

  /* ----------------------------------------------------- menu positioning */

  // The cell menus are position:fixed so the board's sideways scrolling cannot
  // clip them (see .status-options in app.css). That means nothing else knows
  // where to put them, so this does.
  let openMenu = null;

  function placeMenu(details) {
    const panel = details.querySelector('.status-options');
    const anchor = details.querySelector('summary');
    if (!panel || !anchor) return;

    const cell = anchor.getBoundingClientRect();
    const menu = panel.getBoundingClientRect();
    const edge = 8;

    // Below the cell by preference, above it when there is no room below --
    // which is what was happening to the bottom row of every group.
    let top = cell.bottom + 2;
    if (top + menu.height > window.innerHeight - edge) {
      top = Math.max(edge, cell.top - menu.height - 2);
    }

    // Centred on the cell, then pulled back inside the window.
    let left = cell.left + (cell.width - menu.width) / 2;
    left = Math.min(Math.max(edge, left), window.innerWidth - menu.width - edge);

    panel.style.top = `${Math.round(top)}px`;
    panel.style.left = `${Math.round(left)}px`;
  }

  // `toggle` does not bubble, so this listens on the way down instead.
  document.addEventListener('toggle', (event) => {
    const details = event.target;
    if (!details.classList?.contains('status-menu')) return;
    if (details.open) {
      openMenu = details;
      placeMenu(details);
      if (details.hasAttribute('data-blockedby')) fillBlockerMenu(details);
    } else if (openMenu === details) {
      openMenu = null;
    }
  }, true);

  // A fixed menu does not travel with its cell, so move it when anything moves.
  // Capture again: scrolling inside the board does not bubble either.
  for (const event of ['scroll', 'resize']) {
    window.addEventListener(event, () => {
      if (openMenu?.open) placeMenu(openMenu);
    }, true);
  }

  /* ------------------------------------------------------- menu behaviour */

  // Only one popup open at a time, and Escape closes it.
  document.addEventListener('click', (event) => {
    const open = event.target.closest('details[open]');
    for (const details of document.querySelectorAll('details[open]')) {
      if (details !== open && !details.contains(event.target)) details.open = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const details of document.querySelectorAll('details[open]')) details.open = false;
  });
}());
