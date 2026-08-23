// Image and GIF storage.
//
// Files are validated by their actual first bytes rather than the type the
// browser claims, because that claim is trivial to fake. They are served back
// through the login like everything else, so a direct link is useless without
// a session.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
export const UPLOAD_DIR = join(DATA_DIR, 'kb-uploads');
export const MAX_BYTES = 15 * 1024 * 1024;

mkdirSync(UPLOAD_DIR, { recursive: true });

// [extension, mime, matcher against the first bytes of the file]
const SIGNATURES = [
  ['png',  'image/png',  (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpg',  'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif',  'image/gif',  (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['webp', 'image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
                              && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

const NAME_PATTERN = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;

export const MIME_BY_EXT = Object.fromEntries(
  SIGNATURES.map(([ext, mime]) => [ext, mime])
);

/** Identify a buffer by its contents. Returns null if it is not an image. */
function identify(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  for (const [ext, mime, matches] of SIGNATURES) {
    if (matches(buffer)) return { ext, mime };
  }
  return null;
}

/**
 * Save an uploaded image.
 *
 * @returns {{name: string, url: string, mime: string, bytes: number}}
 * @throws  {Error} with a `status` property when the upload is rejected.
 */
export function saveUpload(buffer) {
  if (!buffer?.length) {
    throw Object.assign(new Error('Empty upload'), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(
      new Error(`Too large. The limit is ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`),
      { status: 413 }
    );
  }

  const kind = identify(buffer);
  if (!kind) {
    throw Object.assign(
      new Error('Only PNG, JPEG, GIF and WebP images are accepted.'),
      { status: 415 }
    );
  }

  const name = `${randomBytes(16).toString('hex')}.${kind.ext}`;
  writeFileSync(join(UPLOAD_DIR, name), buffer);
  return { name, url: `/kb/file/${name}`, mime: kind.mime, bytes: buffer.length };
}

/** Resolve a requested filename to a real file, or null. Rejects any path tricks. */
export function findUpload(name) {
  if (!NAME_PATTERN.test(String(name || ''))) return null;
  const path = join(UPLOAD_DIR, name);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return { path, mime: MIME_BY_EXT[name.split('.').pop()] };
}
