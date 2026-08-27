// The server's own secret key.
//
// Generated once and kept on the data volume rather than passed in as an
// environment variable, so it is never in the repo, never in GitHub, and never
// visible in `docker inspect` or a process list. Losing it is harmless: it only
// means everyone has to sign in again.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';

const FILE = join(DATA_DIR, 'session.key');

function load() {
  if (existsSync(FILE)) {
    const existing = readFileSync(FILE);
    if (existing.length >= 32) return existing;
    console.warn('tasks: session.key was too short, generating a new one');
  }
  const secret = randomBytes(64);
  // Written owner-read-only. The container runs as `node`, so nothing else on
  // the box can read it without root.
  writeFileSync(FILE, secret, { mode: 0o600 });
  chmodSync(FILE, 0o600);
  return secret;
}

export const SECRET = load();
