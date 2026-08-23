// Nightly snapshots of the knowledge base.
//
// The entries live only on this server -- unlike the rest of the site, GitHub
// has no copy. VACUUM INTO writes a clean, consistent copy even while the
// database is in use, which a plain file copy cannot promise.

import { readdirSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { store } from './schema.js';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
export const BACKUP_DIR = join(DATA_DIR, 'kb-backups');
const KEEP_DAYS = 14;
const EVERY_MS = 24 * 60 * 60 * 1000;

export function makeBackup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(BACKUP_DIR, `kb-${stamp}.db`);

  try {
    // Same-day reruns replace the existing snapshot rather than failing.
    try { unlinkSync(target); } catch { /* not there yet */ }
    store.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    prune();
    return target;
  } catch (err) {
    console.error('kb: backup failed:', err.message);
    return null;
  }
}

function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!name.startsWith('kb-') || !name.endsWith('.db')) continue;
    const path = join(BACKUP_DIR, name);
    if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
  }
}

export function startBackups() {
  makeBackup();
  const timer = setInterval(makeBackup, EVERY_MS);
  timer.unref();
}
