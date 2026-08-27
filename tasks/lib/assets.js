// Cache-busting for the stylesheet and the script.
//
// Both are served with a long cache lifetime, because they change rarely and
// re-downloading them on every page load would be waste. The catch is that a
// deploy then has no way to reach a browser still holding the old copy -- it
// would keep running last week's JavaScript against this week's server, and the
// symptom is the worst kind: things half-working with no error.
//
// So the URL carries a hash of the file's contents. Same file, same URL, served
// from cache. Changed file, new URL, fetched fresh. No cache clearing, no
// version number anybody has to remember to bump.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');

function fingerprint(file) {
  try {
    return createHash('sha256').update(readFileSync(join(CLIENT, file))).digest('hex').slice(0, 12);
  } catch {
    // A missing asset is a broken deploy, not a reason to refuse to start.
    console.error(`tasks: could not read client/${file} to fingerprint it`);
    return 'dev';
  }
}

export const CSS_URL = `/tasks/app.css?v=${fingerprint('app.css')}`;
export const JS_URL = `/tasks/app.js?v=${fingerprint('app.js')}`;
