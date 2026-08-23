// Nightly snapshots of the knowledge base.
//
// The entries live only on this server -- unlike the rest of the site, GitHub
// has no copy. VACUUM INTO writes a clean, consistent copy even while the
// database is in use, which a plain file copy cannot promise.

import { readdirSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
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

/**
 * Stream today's entries and every uploaded image as one .tar.gz.
 *
 * Both together, because a database of entries whose images are missing is
 * only half a backup.
 */
export function streamArchive(res, onError) {
  const snapshot = makeBackup();
  if (!snapshot) return onError(new Error('could not snapshot the database'));

  const stamp = new Date().toISOString().slice(0, 10);
  const name = basename(snapshot);

  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="knowledge-base-${stamp}.tar.gz"`
  );

  // Paths are relative to DATA_DIR so the archive unpacks somewhere sensible.
  // Written with forward slashes because that is what tar expects, whatever
  // the host platform uses.
  const tar = spawn('tar', [
    '-czf', '-', '-C', DATA_DIR, `kb-backups/${name}`, 'kb-uploads',
  ]);

  tar.stdout.pipe(res);
  tar.stderr.on('data', (chunk) => console.error('kb: tar:', String(chunk).trim()));
  tar.on('error', onError);
  tar.on('close', (code) => {
    if (code !== 0 && !res.headersSent) onError(new Error(`tar exited with ${code}`));
  });
}
