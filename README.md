# Careertech

A sandbox repo for small projects on my own server. Each top-level folder is an
independent project. Push to `master` and it deploys itself.

- **Live at:** https://emaitch.co.uk/{foldername}
- **Server:** Ubuntu 26.04, 4 vCPU / 8GB RAM / 200GB

## How a deploy works

Pushing to `master` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml),
which SSHes into the server and:

1. Copies every project folder to `/var/www/html/{folder}` — nginx serves these directly.
2. **Deletes** any folder that was deployed last time but is no longer in the repo.
3. Rebuilds and restarts the shared backend container (`api/`), if present.
4. Makes sure nginx is routing `/api/` to that container, then reloads it.

If the backend fails to start or the nginx config is invalid, the deploy stops and
rolls the nginx change back, so a broken push cannot take the site down.

### About step 2

The server keeps a list at `/var/www/.careertech-manifest` of the folders this
workflow deployed. Only folders on that list are ever deleted — anything else in
the web root is left alone, including nginx's own `index.html`. So removing
`Project3/` from the repo removes it from the server on the next push, but nothing
you set up by hand gets touched.

Note the web root is `/var/www/html`, not `/var/www` — that is what nginx is
configured to serve. The manifest and the temporary clone live in `/var/www` so
they stay outside the web root and are not publicly reachable.

## Adding a project

### Static only (HTML/CSS/JS)

Make a folder, put an `index.html` in it, push. That's it.

```
MyThing/
  index.html
```

Live at `https://emaitch.co.uk/MyThing`.

### With a backend

All projects share one small Node process instead of each getting its own
container — on a 2GB box, one process is much cheaper than five. Each project
still gets its **own** router and its **own** database file, which is what keeps
them independent.

Add a folder under `api/projects/`:

```
api/projects/mything/router.js    ->  https://emaitch.co.uk/api/mything
MyThing/index.html                ->  https://emaitch.co.uk/MyThing
```

`server.js` finds any folder containing a `router.js` on startup, so there is no
list to register it in. The smallest useful version:

```js
import { Router } from 'express';
import { db } from '../../lib/db.js';

const store = db('mything', `
  CREATE TABLE IF NOT EXISTS items (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL
  );
`);

const router = Router();

router.get('/', (req, res) => {
  res.json({ items: store.prepare('SELECT * FROM items').all() });
});

router.post('/', (req, res) => {
  // Validate before it reaches the database.
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 280) {
    return res.status(400).json({ error: 'text must be 1-280 characters' });
  }
  // Parameterised -- never build SQL by concatenation.
  store.prepare('INSERT INTO items (text) VALUES (?)').run(text);
  res.status(201).json({ ok: true });
});

export default router;
```

**Anything added here is reachable by the whole internet.** There is no auth yet,
so a write endpoint is a write endpoint for everyone. Add a shared secret, or make
the URLs unguessable, before storing anything worth protecting.

## Rules worth keeping

These two are what make it cheap to give a project its own container later, if it
ever outgrows the shared process:

1. **A project only ever handles its own path.** No importing one project's code
   from another. To split one off, you point `/api/thatproject/` at a new
   container in nginx and the frontend never notices, because the URL is the same.
2. **A project only ever touches its own database.** `db('mything')` gives you
   `mything.db`. Never read another project's tables — shared tables are the one
   thing that is genuinely painful to untangle later.

Also: the shared process means all backends share a fate. If one crashes the
process, every `/api/` route goes down together (Docker restarts it, but there is
a blip). Anything long-running, memory-hungry, or genuinely important should get
its own container instead.

## Reserved names

`api`, `infra`, and `.github` are not published as static sites.

## Setting up a new server

Everything the server needs is in one script. On a fresh Ubuntu box, logged in
as your normal user (not root):

```bash
git clone https://github.com/Ceebl/Careertech.git /tmp/ct && bash /tmp/ct/infra/setup-server.sh
```

It installs nginx, Docker and the rest, sets up the firewall, creates a login key
for the deploy robot, and gets an HTTPS certificate if the domain already points
at the box. Safe to run more than once. It prints what to do next when it finishes.

**Order matters:** the domain has to point at the server, and HTTPS has to be
working, *before* the first deploy. The deploy adds a line to the secure-site
settings, so those settings have to exist first.

## Running the backend locally

```bash
cd api && npm install && npm run dev
```

Then http://localhost:3000/api/health.

## Layout

```
Project1/ Project2/          static sites -> /{name}
api/                         shared backend -> /api/{name}
  server.js                  mounts every projects/*/router.js
  lib/db.js                  per-project SQLite
  lib/ratelimit.js           120 requests/min per IP
  projects/                  one folder per backend
infra/                       server setup, nginx config, homepage generator
```
