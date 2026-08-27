// Local development only. Never used on the server.
//
// Starts the app against a throwaway database in ./data with a first admin
// account, so you can poke at it without any environment set up by hand.
//
//   npm run dev
//
// The password is either whatever TASKS_ADMIN_PASSWORD already says, or a fresh
// random one printed to the terminal. Nothing is hard-coded, so this file can
// never become the reason a real deployment has a known password.

import { randomBytes } from 'node:crypto';

process.env.NODE_ENV ??= 'development';
process.env.PORT ??= '3011';
process.env.DATA_DIR ??= './.localdata';
process.env.TASKS_ADMIN_USER ??= 'admin';

if (!process.env.TASKS_ADMIN_PASSWORD) {
  process.env.TASKS_ADMIN_PASSWORD = randomBytes(12).toString('base64url');
  console.log('\n  first-run admin password:', process.env.TASKS_ADMIN_PASSWORD);
  console.log('  (only used if the database is empty)\n');
}

await import('./server.js');
