# Careertech

A personal sandbox for small web projects. Each top-level folder is an
independent little thing, deployed automatically on push.

## Adding a project

Create a folder with an `index.html` in it and push. That is the whole process.

```
MyThing/
  index.html
```

Removing the folder removes it from the server on the next deploy.

## Backend

Projects that need a backend share one small Node service under `api/`, with a
folder per project. On a modest server one process is considerably cheaper than
one container each.

Two conventions keep them independent, and keep any one of them cheap to split
out later:

1. A project handles only its own path, and imports no other project's code.
2. A project touches only its own database. Shared tables are the one thing
   that is genuinely painful to untangle.

Some projects are private and sit behind a login.

## Running locally

```bash
cd api && npm install && npm run dev
```

## Layout

```
api/         shared backend, one folder per project
infra/       server setup and configuration
```

Deployment, server configuration and security notes are kept outside this
repository.
