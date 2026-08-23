// Shared backend for all Careertech projects.
//
// Every folder in ./projects that contains a router.js is mounted automatically
// at /api/{foldername}. Nothing else needs editing to add a project.
//
// Keeping each project in its own router under its own path prefix means any
// one of them can later be pulled out into its own container by pointing that
// prefix at a different port in nginx -- the URLs the frontend calls don't change.

import express from 'express';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rateLimit } from './lib/ratelimit.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Bind all interfaces inside the container; the host only publishes this port
// on 127.0.0.1, so nginx is still the only way in from outside.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

app.disable('x-powered-by');
// nginx is the only thing in front of us, so trust exactly one proxy hop.
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

const mounted = [];

app.get('/api/health', (req, res) => {
  res.json({ ok: true, projects: mounted, uptime: Math.round(process.uptime()) });
});

const projectsDir = join(here, 'projects');

if (existsSync(projectsDir)) {
  const folders = readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of folders) {
    const routerPath = join(projectsDir, name, 'router.js');
    if (!existsSync(routerPath)) continue;

    // A broken project should not stop the other projects from starting.
    try {
      const mod = await import(pathToFileURL(routerPath).href);
      if (!mod.default) throw new Error('router.js has no default export');
      // A project can serve its own pages at a top-level path by exporting
      // `mountPath`. Everything else lands under /api/ as a JSON endpoint.
      const at = typeof mod.mountPath === 'string' ? mod.mountPath : `/api/${name}`;
      app.use(at, mod.default);
      mounted.push(name);
      console.log(`mounted ${at}`);
    } catch (err) {
      console.error(`FAILED to mount /api/${name}:`, err.message);
    }
  }
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

// eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  res.status(err.status || 500).json({ error: 'internal error' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`careertech-api listening on ${HOST}:${PORT} (${mounted.length} projects)`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
