// Unguessable identifiers.
//
// Every id that ever appears in a URL comes from here. 12 base64url characters
// is 72 bits of randomness -- you would not find one by guessing before the
// heat death of the sun, let alone before the rate limiter noticed.

import { randomBytes } from 'node:crypto';

/** @returns {string} a fresh 12-character random id */
export function newId() {
  return randomBytes(9).toString('base64url');
}

/**
 * Is this string shaped like one of our ids?
 *
 * Checked before every database lookup so a malformed id is a clean 404 rather
 * than an odd error page. It is a sanity check, not a security control -- the
 * security control is the membership check in access.js.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{12}$/.test(value);
}
