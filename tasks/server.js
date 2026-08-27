// Tasks -- a private board-and-task app.
//
// Runs in its own container, on its own port, against its own database, and
// serves every one of its own pages. nginx proxies /tasks/ here and never
// serves a byte of this app from disk, so there is no file anywhere that can be
// reached without a session.
//
// The order of the middleware below is the security model. Read it top to
// bottom: headers, then limits, then who you are, then the few pages that do
// not need an account, then the wall, then everything else.

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rateLimit } from './lib/ratelimit.js';
import { attachUser, requireUser, requireAdmin } from './lib/auth.js';
import { requireCsrf } from './lib/csrf.js';
import { refuse } from './lib/http.js';
import { startSessionSweeper } from './lib/sessions.js';
import { ensureBootstrapAdmin } from './store/users.js';
import { publicRoutes, accountRoutes } from './routes/auth.js';
import boardRoutes from './routes/boards.js';
import adminRoutes from './routes/admin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
// Binds every interface inside the container; the host publishes the port on
// 127.0.0.1 only, so nginx remains the one way in from outside.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const router = express.Router();

app.disable('x-powered-by');
// nginx is the only thing in front of us: trust exactly one proxy hop, so
// req.ip is the visitor rather than the proxy, and cannot be spoofed by adding
// extra X-Forwarded-For entries.
app.set('trust proxy', 1);
// Stop Express guessing a JSON reply is wanted just because ?callback= is set.
app.set('query parser', 'simple');

/* --------------------------------------------------------------- headers */

app.use((req, res, next) => {
  // Nothing on these pages loads from anywhere but this origin, and there is no
  // inline script or inline style anywhere in the app, so the policy can be
  // about as tight as a policy gets. If a bug ever did put attacker text into a
  // page, this is what stops it becoming attacker code.
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    // Nobody frames this app, so clickjacking has nowhere to happen.
    "frame-ancestors 'none'",
  ].join('; '));

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Belt and braces with nginx's own HSTS header: tells the browser never to
  // try this domain over plain HTTP again.
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Private pages must not be kept by any cache between here and the browser.
  // The static assets below set their own, more relaxed, caching.
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(rateLimit({ windowMs: 60_000, max: 300 }));

/* ------------------------------------------------------- unauthenticated */

// Used by the deploy to decide whether the container came up. Deliberately
// tells an anonymous caller nothing beyond "the process is running".
router.get('/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// The stylesheet, the script and the fonts are the only files served from
// disk. They are the same for everybody and reveal nothing, and the login page
// needs the stylesheet before anyone has signed in.
function asset(file, type) {
  return (req, res) => {
    res.type(type);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(join(HERE, 'client', file));
  };
}
router.get('/app.css', asset('app.css', 'text/css'));
router.get('/app.js', asset('app.js', 'application/javascript'));
router.use('/fonts', express.static(join(HERE, 'client', 'fonts'), {
  maxAge: '365d', immutable: true, index: false, redirect: false, dotfiles: 'ignore',
}));

/* ------------------------------------------------------------ the request */

router.use(express.urlencoded({ extended: false, limit: '64kb' }));
router.use(express.json({ limit: '32kb' }));

router.use(attachUser);

// Light/dark is a cookie so the server can stamp it into the page and avoid a
// flash of the wrong theme. It is display only -- nothing depends on it.
router.use((req, res, next) => {
  res.locals.theme = /(?:^|;\s*)tasks_theme=dark(?:;|$)/.test(req.headers.cookie || '')
    ? 'dark' : 'light';
  next();
});

// The login form is the one POST that cannot carry a CSRF token, because the
// session it would be derived from does not exist yet. SameSite=Lax on the
// cookie and the throttling in lib/auth.js cover it instead.
router.use(publicRoutes);

/* ------------------------------------------------------------- the wall */

router.use(requireUser);
router.use(requireCsrf);

router.use(accountRoutes);
router.use('/admin', requireAdmin, adminRoutes);
router.use(boardRoutes);

/* ------------------------------------------------------------- fallbacks */

router.use((req, res) => refuse(req, res, 404, 'Not found.'));

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
router.use((err, req, res, next) => {
  // The full error goes to the container log, where only someone with server
  // access can read it. The browser gets nothing that describes the innards.
  console.error('unhandled error:', err);
  if (res.headersSent) return;
  refuse(req, res, 500, 'Something went wrong.');
});

app.use('/tasks', router);

// In production nginx owns "/" and only ever proxies /tasks/ here, so this is
// really for `npm run dev`, where opening the root would otherwise 404 and look
// like the app had failed to start.
app.get('/', (req, res) => res.redirect('/tasks/'));

// Anything else outside /tasks is not ours.
app.use((req, res) => res.status(404).json({ error: 'not found' }));

/* ---------------------------------------------------------------- startup */

await ensureBootstrapAdmin();
startSessionSweeper();

const server = app.listen(PORT, HOST, () => {
  console.log(`tasks listening on ${HOST}:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
