// Password hashing and the password rules.
//
// Uses scrypt, which is built into Node -- no dependency to install, audit, or
// keep patched. scrypt is deliberately slow AND deliberately memory-hungry:
// slowness alone can be beaten by renting a lot of machines, but needing 64MB
// of memory per guess is what makes a graphics card useless for cracking these.
//
// The cost parameters are stored inside each hash, so raising them later is
// safe: old passwords keep verifying with their old settings, and get upgraded
// to the new ones the next time their owner signs in.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

// N=2^16 puts one hash at roughly a tenth of a second on this box. Slow enough
// to make offline guessing painful, fast enough that signing in feels instant.
const N = 65536;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 32;
// scrypt needs about 128 * N * r bytes; Node's default ceiling is 32MB, which
// is below what these settings ask for, so it has to be raised explicitly.
const MAX_MEM = 160 * 1024 * 1024;

function derive(password, salt, { n, r, p }) {
  return new Promise((resolve, reject) => {
    scrypt(
      // Normalise first: the same password typed on a phone and a laptop can
      // otherwise be two different byte sequences for accented characters.
      String(password).normalize('NFKC'),
      salt,
      KEY_BYTES,
      { N: n, r, p, maxmem: MAX_MEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/**
 * Hash a password for storage.
 *
 * @param {string} password
 * @returns {Promise<string>} `scrypt$N$r$p$salt$hash`, all base64url
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { n: N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Check a password against a stored hash.
 *
 * Always does the full scrypt work, even for a hash it cannot parse, so the
 * time taken never reveals whether the account exists.
 *
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<{ ok: boolean, needsRehash: boolean }>}
 */
export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  const usable = parts.length === 6 && parts[0] === 'scrypt';

  const n = usable ? Number(parts[1]) : N;
  const r = usable ? Number(parts[2]) : R;
  const p = usable ? Number(parts[3]) : P;
  const salt = usable ? Buffer.from(parts[4], 'base64url') : randomBytes(SALT_BYTES);
  const expected = usable ? Buffer.from(parts[5], 'base64url') : randomBytes(KEY_BYTES);

  // Refuse to honour absurd parameters from a tampered row rather than trying
  // to allocate them.
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20 || !Number.isInteger(r)
      || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
    await derive(password, randomBytes(SALT_BYTES), { n: N, r: R, p: P });
    return { ok: false, needsRehash: false };
  }

  const key = await derive(password, salt, { n, r, p });

  const ok = key.length === expected.length && timingSafeEqual(key, expected);
  return { ok: usable && ok, needsRehash: ok && (n !== N || r !== R || p !== P) };
}

// The 25 or so passwords that turn up first in every breach list. This is not a
// serious dictionary check -- the length rule does most of the work -- but it
// stops the handful of choices that would be guessed within seconds.
const OBVIOUS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456', '1234567',
  '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123', 'qwertyuiop',
  'letmein', 'welcome', 'welcome1', 'admin', 'admin123', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball',
  'abc123', 'changeme', 'trustno1', 'starwars', 'whatever', 'zaq12wsx',
]);

export const MIN_LENGTH = 12;

/**
 * Judge a proposed password.
 *
 * Length is the rule that actually matters, so it is the rule that is enforced.
 * There is deliberately no "must contain a symbol" nonsense: it pushes people
 * towards Password1! and away from four random words, which is worse on both
 * counts.
 *
 * @param {string} password
 * @param {{ username?: string }} [context]
 * @returns {string | null} the problem, or null if it is fine
 */
export function passwordProblem(password, context = {}) {
  const value = String(password ?? '');

  if (value.length < MIN_LENGTH) {
    return `Passwords must be at least ${MIN_LENGTH} characters. Three or four random words is the easiest way to get there.`;
  }
  if (value.length > 200) {
    return 'That password is longer than 200 characters.';
  }
  if (value.trim().length === 0) {
    return 'That password is only spaces.';
  }

  const flat = value.toLowerCase().replace(/\s+/g, '');
  if (OBVIOUS.has(flat)) {
    return 'That is one of the most commonly used passwords in the world. Please pick another.';
  }
  if (context.username && flat.includes(String(context.username).toLowerCase())) {
    return 'The password cannot contain your username.';
  }
  if (/^(.)\1+$/.test(flat)) {
    return 'That password is the same character repeated.';
  }

  return null;
}
