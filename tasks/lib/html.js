// Escape-by-default HTML building.
//
// Cross-site scripting happens when someone's text gets treated as code. The
// usual fix is "remember to call esc() on every value", and the usual outcome
// is that one day somebody forgets.
//
// So here the default is inverted. Write templates with the `html` tag and
// every value you drop in is escaped automatically. Unescaped output is
// possible, but only by wrapping it in raw() -- which is easy to search for and
// impossible to do by accident.
//
//   html`<h1>${board.name}</h1>`            <- escaped, safe with any input
//   html`<div>${raw(renderedRows)}</div>`   <- deliberate, and visibly so
//
// Unlike the knowledge base, nothing in this app ever stores or renders
// user-supplied HTML. Task titles are text, comments are text.

const RAW = Symbol('raw html');

/**
 * Escape a value for use in HTML text or inside a double-quoted attribute.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Mark an already-safe string so `html` will not escape it again.
 * Only ever pass this output from another `html` template.
 *
 * @param {string} value
 */
export function raw(value) {
  return { [RAW]: String(value) };
}

/**
 * Tagged template that escapes every interpolated value.
 *
 * Arrays are joined with no separator, so a list of rows can be dropped
 * straight in. Values are escaped individually first.
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return esc(value);
}

/**
 * Turn an `html` result back into a plain string, for sending down the wire.
 *
 * @param {{[k: symbol]: string} | string} value
 * @returns {string}
 */
export function toString(value) {
  if (typeof value === 'string') return value;
  return value?.[RAW] ?? '';
}
