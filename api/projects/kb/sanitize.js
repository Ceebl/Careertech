// HTML cleaning for entry bodies.
//
// You can write anything -- iframes, inline styles, tables, embeds -- because
// you are the only person who can write. The one thing removed is script
// execution: a <script> pasted from a dodgy source would run for every reader
// and could steal their session. Nothing you have asked for needs one.

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_OPEN = /<\/?script\b[^>]*>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s(href|src|action|formaction|data)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi;
const DANGEROUS_TAG = /<\/?(object|embed|base|meta|link)\b[^>]*>/gi;

/** Strip script execution from entry HTML, leaving everything else intact. */
export function cleanHtml(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(SCRIPT_BLOCK, '')
    .replace(SCRIPT_OPEN, '')
    .replace(DANGEROUS_TAG, '')
    .replace(EVENT_ATTR, '')
    .replace(JS_URL, '');
}

/** Escape text destined for HTML output (titles, tags, form values). */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/**
 * Plain-text preview for listings.
 *
 * Entities are decoded here because the result gets escaped again on output --
 * without this, "&amp;" in the source renders as "&amp;" instead of "&".
 */
export function excerpt(html, length = 180) {
  const text = String(html ?? '')
    .replace(SCRIPT_BLOCK, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? text.slice(0, length).trimEnd() + '…' : text;
}
