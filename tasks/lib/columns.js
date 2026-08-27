// Column types.
//
// A column's type decides three things: what the cell looks like, what counts
// as a valid value, and what happens when you click it. Keeping all three in
// one place per type is what stops the table view and the kanban view drifting
// apart.
//
// Values are always stored as text, whatever the type. `normalise` is the only
// way a value gets into the database, so a bad value is impossible rather than
// merely unlikely -- anything unrecognised becomes the empty string, which
// every type treats as "not filled in".

import { newId } from './ids.js';

// From the house palette in brand/ct.css. Mid-tones, readable against white,
// and the same colours the rest of the site uses.
//
// The list is closed on purpose. Every colour that reaches the database has to
// be one on this list, which means every colour on a page can be a CSS class
// defined up front in the stylesheet -- and that in turn is what lets the
// Content-Security-Policy forbid inline styles outright. A page that cannot
// carry a style attribute cannot be talked into carrying a hostile one.
export const PALETTE = [
  '#496DDB', // primary    blue
  '#C0BF47', // success    olive
  '#EE8434', // warning    orange
  '#C95D63', // danger     red
  '#717EC3', // info       periwinkle
  '#AE8799', // decorative mauve
  '#5B6472', // slate
  '#8A8F98', // grey
  // Not from the original Coolors palette. The house "success" colour is the
  // olive above, which reads as a warning on a status chip rather than a
  // finished one -- green is what "Done" is expected to look like, so a green
  // that sits with the other mid-tones was added for it.
  '#3E8E5F', // green
];

/**
 * Snap any incoming colour to one on the list, or to the fallback.
 * This is the only way a colour gets stored.
 *
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function paletteColour(value, fallback = PALETTE[0]) {
  const wanted = String(value ?? '').toUpperCase();
  return PALETTE.find((colour) => colour === wanted) ?? fallback;
}

/**
 * The CSS class suffix for a colour: 'c1' for the first in PALETTE, and so on.
 * Paired with .bg-c1, .bl-c1 and .tag-c1 in app.css -- add a colour above and
 * its three classes have to be added there too.
 *
 * @param {unknown} value
 */
export function colourClass(value) {
  return `c${PALETTE.indexOf(paletteColour(value)) + 1}`;
}

export const TYPES = {
  text: {
    label: 'Text',
    hint: 'A short note',
    defaultSettings: () => ({}),
    normalise: (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
  },

  status: {
    label: 'Status',
    hint: 'Coloured labels you click to change',
    // Two settings here drive the blocked-by feature, which is a link between
    // items rather than a status of its own:
    //   done             -- reaching this label frees whatever was waiting
    //   unblockedLabelId -- the label a freed item is moved to
    defaultSettings: () => {
      const labels = [
        { id: newId(), text: 'Not started', colour: '#8A8F98', done: false },
        { id: newId(), text: 'Working on it', colour: '#EE8434', done: false },
        { id: newId(), text: 'Stuck', colour: '#C95D63', done: false },
        { id: newId(), text: 'Done', colour: '#3E8E5F', done: true },
      ];
      return { labels, unblockedLabelId: labels[1].id };
    },
    // The stored value is a label id, so renaming a label leaves every item
    // that carries it still pointing at the right thing.
    normalise: (value, settings) => {
      const wanted = String(value ?? '');
      const labels = settings?.labels ?? [];
      return labels.some((label) => label.id === wanted) ? wanted : '';
    },
  },

  // Behaves exactly like a status -- coloured labels you click -- but is kept a
  // separate type on purpose. Status drives the workflow: it is what "counts as
  // finished" is read from, what the kanban groups by, and what a freed task is
  // moved to. Priority is just a label. Merging them would mean raising a task's
  // priority could accidentally mark it done.
  priority: {
    label: 'Priority',
    hint: 'How urgent, as coloured labels',
    defaultSettings: () => ({
      labels: [
        { id: newId(), text: 'Critical', colour: '#C95D63' },
        { id: newId(), text: 'High', colour: '#EE8434' },
        { id: newId(), text: 'Medium', colour: '#717EC3' },
        { id: newId(), text: 'Low', colour: '#8A8F98' },
      ],
    }),
    normalise: (value, settings) => {
      const wanted = String(value ?? '');
      const labels = settings?.labels ?? [];
      return labels.some((label) => label.id === wanted) ? wanted : '';
    },
  },

  person: {
    label: 'Person',
    hint: 'Someone in this workspace',
    defaultSettings: () => ({}),
    // Validated properly in the route, which knows who is in the workspace.
    // Here we only insist it is shaped like a user id.
    normalise: (value) => (/^[A-Za-z0-9_-]{12}$/.test(String(value ?? '')) ? String(value) : ''),
  },

  date: {
    label: 'Date',
    hint: 'A day, for deadlines',
    defaultSettings: () => ({}),
    normalise: (value) => {
      const text = String(value ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
      // Reject 2026-02-31 and friends: the Date constructor accepts them and
      // silently rolls them over into March.
      const [y, m, d] = text.split('-').map(Number);
      const check = new Date(Date.UTC(y, m - 1, d));
      const valid = check.getUTCFullYear() === y
        && check.getUTCMonth() === m - 1
        && check.getUTCDate() === d;
      return valid ? text : '';
    },
  },

  number: {
    label: 'Number',
    hint: 'A count, a cost, an estimate',
    defaultSettings: () => ({}),
    normalise: (value) => {
      const text = String(value ?? '').trim().replace(/,/g, '');
      if (text === '') return '';
      const n = Number(text);
      return Number.isFinite(n) ? String(n) : '';
    },
  },

  checkbox: {
    label: 'Tick box',
    hint: 'Done or not done',
    defaultSettings: () => ({}),
    normalise: (value) => (value === '1' || value === true || value === 'on' ? '1' : ''),
  },

  // The odd one out. Every other column keeps its values in `cells`; this one
  // is a window onto the item_blockers table, which is a relationship between
  // two items rather than a value belonging to one. The column exists so the
  // dependency has somewhere to live on the board -- it stores nothing itself,
  // and its cells are edited through the blocker routes, not the cell route.
  blockedby: {
    label: 'Blocked by',
    hint: 'Tasks that have to finish first',
    defaultSettings: () => ({}),
    normalise: () => '',
    virtual: true,
  },
};

export const TYPE_NAMES = Object.keys(TYPES);

/** @param {unknown} type */
export function isType(type) {
  return Object.hasOwn(TYPES, String(type));
}

/** Does this column keep its values somewhere other than the cells table? */
export function isVirtual(column) {
  return TYPES[column?.type]?.virtual === true;
}

/**
 * Is this a column whose value is one of a set of coloured labels?
 *
 * Status and Priority render, edit and validate identically; they differ only
 * in what the rest of the app reads them for.
 */
export function hasLabels(column) {
  const type = typeof column === 'string' ? column : column?.type;
  return type === 'status' || type === 'priority';
}

/**
 * Read a column's settings back out of the database.
 * Bad JSON in the row must not take a whole board down, so it becomes {}.
 *
 * @param {{ settings: string, type: string }} column
 */
export function settingsOf(column) {
  try {
    const parsed = JSON.parse(column.settings || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Clean a value for storage in a cell.
 *
 * @param {{ type: string, settings: string }} column
 * @param {unknown} value
 * @returns {string}
 */
export function normaliseValue(column, value) {
  const type = TYPES[column.type];
  if (!type) return '';
  return type.normalise(value, settingsOf(column));
}

/**
 * Clean a whole settings object coming from the column editor.
 * Only the keys a type actually uses survive.
 *
 * @param {string} type
 * @param {unknown} incoming
 */
export function normaliseSettings(type, incoming) {
  if (!hasLabels(type)) return {};

  const labels = Array.isArray(incoming?.labels) ? incoming.labels : [];
  const cleaned = labels
    .slice(0, 20)
    .map((label) => ({
      // Keep the id if it is a real one -- items already point at it.
      id: /^[A-Za-z0-9_-]{12}$/.test(String(label?.id ?? '')) ? String(label.id) : newId(),
      text: String(label?.text ?? '').trim().slice(0, 40) || 'Label',
      colour: paletteColour(label?.colour, '#8A8F98'),
      done: label?.done === true || label?.done === '1',
    }));

  if (!cleaned.length) return TYPES[type].defaultSettings();

  // Only a label that still exists can be the one released items move to --
  // otherwise deleting it would leave a setting pointing at nothing.
  const wanted = String(incoming?.unblockedLabelId ?? '');
  const unblockedLabelId = cleaned.some((label) => label.id === wanted) ? wanted : '';

  return { labels: cleaned, unblockedLabelId };
}

/**
 * Find a status column's label by id.
 *
 * @param {object} column
 * @param {string} value
 */
export function labelFor(column, value) {
  return settingsOf(column).labels?.find((label) => label.id === value) ?? null;
}

/**
 * The set of label ids on a status column that mean "finished".
 *
 * Used to decide whether an item still blocks the things waiting on it. A board
 * whose labels are all unticked simply never clears a dependency by status --
 * deleting the blocking item is then the only way -- which is honest rather
 * than guessing at which label the author meant.
 *
 * @param {object|null} column a status column, or null
 * @returns {Set<string>}
 */
export function doneLabelIds(column) {
  // Status only, never Priority -- "Critical" must not mean finished.
  if (!column || column.type !== 'status') return new Set();
  const labels = settingsOf(column).labels ?? [];
  return new Set(labels.filter((label) => label.done).map((label) => label.id));
}

